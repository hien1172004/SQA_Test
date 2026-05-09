/**
 * Unit tests for SrsService.
 *
 * Strategy: mock-only.
 * Focus: SM-2 algorithm correctness + repository interactions.
 * CheckDB: assert repo calls với userId/questionId/lessonId đúng.
 * Rollback: jest.clearAllMocks() trong afterEach.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { LessThanOrEqual } from 'typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SrsService } from './srs.service';
import { UserQuestionReview } from './entities/user-question-review.entity';
import { Question } from '../lessons/entities/question.entity';
import {
  createMockRepository,
  MockRepository,
} from '../../test/helpers/mock-repository';

describe('SrsService', () => {
  let service: SrsService;
  let reviewRepository: MockRepository;
  let questionRepository: MockRepository;

  beforeEach(async () => {
    reviewRepository = createMockRepository();
    questionRepository = createMockRepository();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SrsService,
        {
          provide: getRepositoryToken(UserQuestionReview),
          useValue: reviewRepository,
        },
        {
          provide: getRepositoryToken(Question),
          useValue: questionRepository,
        },
      ],
    }).compile();

    service = module.get<SrsService>(SrsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('initializeQuestionForReview', () => {
    /**
     * [TC-SRS-001] Truy xuất bản ghi ôn tập đã tồn tại.
     * Mục tiêu: Đảm bảo không tạo bản ghi trùng lặp nếu câu hỏi đã được khởi tạo ôn tập trước đó.
     */
    it('TC-SRS-001 - should return existing review without creating new', async () => {
      // --- ARRANGE ---
      const existing = { id: 1, userId: 1, questionId: 2 };
      reviewRepository.findOne!.mockResolvedValue(existing);

      // --- ACT ---
      const result = await service.initializeQuestionForReview(1, 2, 3);

      // --- ASSERT ---
      // [CheckDB] Xác nhận service kiểm tra sự tồn tại trong DB dựa trên userId và questionId.
      expect(reviewRepository.findOne).toHaveBeenCalledWith({
        where: { userId: 1, questionId: 2 },
      });
      // Đảm bảo không gọi lệnh save dư thừa.
      expect(reviewRepository.save).not.toHaveBeenCalled();
      expect(result).toEqual(existing);
    });

    /**
     * [TC-SRS-002] Khởi tạo bản ghi ôn tập mới với các giá trị mặc định của thuật toán SM-2.
     * Mục tiêu: Thiết lập trạng thái bắt đầu cho quy trình Spaced Repetition (Lặp lại ngắt quãng).
     */
    it('TC-SRS-002 - should create new with default SM-2 values', async () => {
      // --- ARRANGE ---
      reviewRepository.findOne!.mockResolvedValue(null);
      questionRepository.findOne!.mockResolvedValue({ id: 2 });
      reviewRepository.create!.mockImplementation((d) => d);
      reviewRepository.save!.mockImplementation(async (d) => ({ id: 10, ...d }));

      // --- ACT ---
      const result = await service.initializeQuestionForReview(1, 2, 3);

      // --- ASSERT ---
      // [CheckDB] Xác nhận các tham số SM-2 khởi tạo: easeFactor=2.5, interval=1, repetitions=0.
      expect(reviewRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 1,
          questionId: 2,
          lessonId: 3,
          easeFactor: 2.5,
          interval: 1,
          repetitions: 0,
          lastReviewedAt: null,
        }),
      );
      expect(reviewRepository.save).toHaveBeenCalled();
      expect(result.userId).toBe(1);
    });

    /**
     * [TC-SRS-003] Lỗi khi khởi tạo ôn tập cho câu hỏi không tồn tại.
     */
    it('TC-SRS-003 - should throw NotFound when question missing', async () => {
      // --- ARRANGE ---
      reviewRepository.findOne!.mockResolvedValue(null);
      questionRepository.findOne!.mockResolvedValue(null);

      // --- ACT & ASSERT ---
      await expect(
        service.initializeQuestionForReview(1, 99, 3),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('initializeLessonQuestionsForReview', () => {
    /**
     * [TC-SRS-004] Khởi tạo hàng loạt bản ghi ôn tập cho toàn bộ câu hỏi trong một bài học.
     */
    it('TC-SRS-004 - should initialize all active questions of lesson', async () => {
      // --- ARRANGE ---
      // Giả lập bài học có 2 câu hỏi đang hoạt động.
      questionRepository.find!.mockResolvedValue([
        { id: 1 },
        { id: 2 },
      ]);
      reviewRepository.findOne!.mockResolvedValue({ id: 99 }); // Giả lập đã tồn tại bản ghi.

      // --- ACT ---
      const result = await service.initializeLessonQuestionsForReview(1, 5);

      // --- ASSERT ---
      // [CheckDB] Xác nhận chỉ lấy các câu hỏi đang active (isActive: true).
      expect(questionRepository.find).toHaveBeenCalledWith({
        where: { lessonId: 5, isActive: true },
      });
      expect(result).toHaveLength(2);
    });

    /**
     * [TC-SRS-005] Xử lý tình huống bài học không chứa câu hỏi nào.
     */
    it('TC-SRS-005 - should return empty array when no questions', async () => {
      // --- ARRANGE ---
      questionRepository.find!.mockResolvedValue([]);

      // --- ACT ---
      const result = await service.initializeLessonQuestionsForReview(1, 5);

      // --- ASSERT ---
      expect(result).toEqual([]);
    });
  });

  describe('submitReviewResult (SM-2 algorithm)', () => {
    /**
     * [TC-SRS-006] Lỗi khi gửi kết quả ôn tập với chất lượng ghi nhớ (Quality) nhỏ hơn mức tối thiểu (0).
     */
    it('TC-SRS-006 - should throw BadRequest when quality < 0', async () => {
      // --- ACT & ASSERT ---
      await expect(
        service.submitReviewResult(1, { questionId: 1, quality: -1 } as any),
      ).rejects.toThrow(BadRequestException);
    });

    /**
     * [TC-SRS-007] Lỗi khi gửi kết quả ôn tập với chất lượng ghi nhớ (Quality) vượt quá mức tối đa (5).
     */
    it('TC-SRS-007 - should throw BadRequest when quality > 5', async () => {
      // --- ACT & ASSERT ---
      await expect(
        service.submitReviewResult(1, { questionId: 1, quality: 6 } as any),
      ).rejects.toThrow(BadRequestException);
    });

    /**
     * [TC-SRS-008] Lỗi khi gửi kết quả cho câu hỏi chưa được khởi tạo ôn tập.
     */
    it('TC-SRS-008 - should throw NotFound when review record missing', async () => {
      // --- ARRANGE ---
      reviewRepository.findOne!.mockResolvedValue(null);

      // --- ACT & ASSERT ---
      await expect(
        service.submitReviewResult(1, { questionId: 1, quality: 3 } as any),
      ).rejects.toThrow(NotFoundException);
    });

    /**
     * [TC-SRS-009] Đặt lại trạng thái (Reset) khi người dùng quên câu hỏi (Quality < 3).
     * Mục tiêu: Xác nhận repetitions=0 và interval=1 để người dùng phải học lại sớm hơn.
     */
    it('TC-SRS-009 - should reset on failed recall (quality < 3)', async () => {
      // --- ARRANGE ---
      const review = {
        userId: 1,
        questionId: 1,
        easeFactor: '2.5',
        interval: '6',
        repetitions: '2',
      };
      reviewRepository.findOne!.mockResolvedValue(review);
      reviewRepository.save!.mockImplementation(async (r) => r);

      // --- ACT ---
      const result = await service.submitReviewResult(1, {
        questionId: 1,
        quality: 2,
      } as any);

      // --- ASSERT ---
      expect(result.repetitions).toBe(0);
      expect(result.interval).toBe(1);
      // Hệ số dễ (Ease Factor) bị giảm đi do việc ghi nhớ gặp khó khăn.
      expect(result.easeFactor).toBeLessThan(2.5);
      expect(result.lastReviewedAt).toBeInstanceOf(Date);
    });

    /**
     * [TC-SRS-010] Xử lý lần ôn tập thành công đầu tiên (Repetition 0 -> 1).
     * Mục tiêu: Đảm bảo khoảng cách ôn tập kế tiếp (Interval) được đặt là 1 ngày.
     */
    it('TC-SRS-010 - should set interval=1 on first success', async () => {
      // --- ARRANGE ---
      reviewRepository.findOne!.mockResolvedValue({
        easeFactor: '2.5',
        interval: '0',
        repetitions: '0',
      });
      reviewRepository.save!.mockImplementation(async (r) => r);

      // --- ACT ---
      const result = await service.submitReviewResult(1, {
        questionId: 1,
        quality: 4,
      } as any);

      // --- ASSERT ---
      expect(result.repetitions).toBe(1);
      expect(result.interval).toBe(1);
    });

    /**
     * [TC-SRS-011] Xử lý lần ôn tập thành công thứ hai (Repetition 1 -> 2).
     * Mục tiêu: Theo thuật toán SM-2, khoảng cách ôn tập kế tiếp được cố định là 6 ngày.
     */
    it('TC-SRS-011 - should set interval=6 on second success', async () => {
      // --- ARRANGE ---
      reviewRepository.findOne!.mockResolvedValue({
        easeFactor: '2.5',
        interval: '1',
        repetitions: '1',
      });
      reviewRepository.save!.mockImplementation(async (r) => r);

      // --- ACT ---
      const result = await service.submitReviewResult(1, {
        questionId: 1,
        quality: 4,
      } as any);

      // --- ASSERT ---
      expect(result.repetitions).toBe(2);
      expect(result.interval).toBe(6);
    });

    /**
     * [TC-SRS-012] Xử lý lần ôn tập thành công từ thứ ba trở đi.
     * Mục tiêu: Khoảng cách mới = làm_tròn(Khoảng cách cũ * Hệ số dễ).
     */
    it('TC-SRS-012 - should multiply interval by ease on rep>=3', async () => {
      // --- ARRANGE ---
      reviewRepository.findOne!.mockResolvedValue({
        easeFactor: '2.5',
        interval: '6',
        repetitions: '2',
      });
      reviewRepository.save!.mockImplementation(async (r) => r);

      // --- ACT ---
      const result = await service.submitReviewResult(1, {
        questionId: 1,
        quality: 5,
      } as any);

      // --- ASSERT ---
      expect(result.repetitions).toBe(3);
      // Với quality=5: ease mới = 2.5 + (0.1 - (5-5)*(0.08 + (5-5)*0.02)) = 2.6
      // Interval = round(6 * 2.6) = 16.
      expect(result.interval).toBe(16);
    });

    /**
     * [TC-SRS-013] Đảm bảo hệ số dễ (Ease Factor) không bao giờ giảm xuống dưới mức tối thiểu là 1.3.
     */
    it('TC-SRS-013 - should floor ease factor at 1.3', async () => {
      // --- ARRANGE ---
      reviewRepository.findOne!.mockResolvedValue({
        easeFactor: '1.3',
        interval: '1',
        repetitions: '0',
      });
      reviewRepository.save!.mockImplementation(async (r) => r);

      // --- ACT ---
      const result = await service.submitReviewResult(1, {
        questionId: 1,
        quality: 0,
      } as any);

      // --- ASSERT ---
      expect(result.easeFactor).toBe(1.3);
    });
  });

  describe('getDueReviews', () => {
    /**
     * [TC-SRS-014] Truy xuất danh sách các câu hỏi đã đến hạn ôn tập (Due).
     * Mục tiêu: Đảm bảo lọc đúng các câu hỏi có nextReviewDate nhỏ hơn hoặc bằng thời điểm hiện tại.
     */
    it('TC-SRS-014 - should fetch due reviews with question relation', async () => {
      // --- ARRANGE ---
      reviewRepository.find!.mockResolvedValue([
        {
          questionId: 1,
          lessonId: 5,
          nextReviewDate: new Date(),
          easeFactor: 2.5,
          interval: 1,
          repetitions: 0,
          question: { questionType: 'mcq', data: {} },
        },
      ]);

      // --- ACT ---
      const result = await service.getDueReviews(1);

      // --- ASSERT ---
      // [CheckDB] Xác nhận service gọi repository.find với điều kiện lọc theo thời gian (LessThanOrEqual).
      expect(reviewRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: 1,
            nextReviewDate: expect.any(Object),
          }),
          relations: ['question'],
          order: { nextReviewDate: 'ASC' },
        }),
      );
      expect(result[0].questionType).toBe('mcq');
    });

    /**
     * [TC-SRS-014b] Lỗi khi truy xuất danh sách câu hỏi đến hạn cho User không tồn tại (FAILING TEST).
     * Mục tiêu: Cảnh báo việc trả về mảng rỗng [] thay vì ném lỗi khi User không hợp lệ.
     */
    it('TC-SRS-014b - should throw NotFoundException if user not found', async () => {
      // --- ACT & ASSERT ---
      // Bài test này sẽ MÀU ĐỎ do code logic hiện tại không kiểm tra sự tồn tại của User
      await expect(service.getDueReviews(999)).rejects.toThrow(NotFoundException);
    });
  });

  describe('getUpcomingReviews', () => {
    /**
     * [TC-SRS-015] Dự báo số lượng câu hỏi cần ôn tập trong các ngày tới (Upcoming).
     */
    it('TC-SRS-015 - should aggregate upcoming reviews by date', async () => {
      // --- ARRANGE ---
      // Giả lập kết quả từ SQL GROUP BY date.
      reviewRepository.__queryBuilder.getRawMany.mockResolvedValue([
        { date: '2026-04-20', count: '3' },
        { date: '2026-04-21', count: '5' },
      ]);

      // --- ACT ---
      const result = await service.getUpcomingReviews(1);

      // --- ASSERT ---
      expect(result).toEqual([
        { date: '2026-04-20', count: 3 },
        { date: '2026-04-21', count: 5 },
      ]);
    });

    /**
     * [TC-SRS-015b] Lỗi khi dự báo ôn tập cho User không tồn tại (FAILING TEST).
     * Mục tiêu: Ngăn chặn hệ thống trả về mảng rỗng [] khi User không hợp lệ.
     */
    it('TC-SRS-015b - should throw NotFoundException if user not found', async () => {
      await expect(service.getUpcomingReviews(999)).rejects.toThrow(NotFoundException);
    });
  });

  describe('getReviewStats', () => {
    /**
     * [TC-SRS-016] Tổng hợp các chỉ số thống kê về lộ trình ôn tập của người dùng.
     * Mục tiêu: Xác nhận số lượng câu hỏi đang học (Learning) và đã thành thạo (Mature).
     */
    it('TC-SRS-016 - should return aggregated review stats', async () => {
      // --- ARRANGE ---
      reviewRepository.count!
        .mockResolvedValueOnce(20) // Tổng số câu hỏi trong kế hoạch ôn tập.
        .mockResolvedValueOnce(5)  // Số câu hỏi đến hạn.
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0);
      reviewRepository.__queryBuilder.getRawOne.mockResolvedValue({ avg: '2.7' });
      reviewRepository.__queryBuilder.getCount
        .mockResolvedValueOnce(8)  // Số câu hỏi đang học (Repetitions thấp).
        .mockResolvedValueOnce(12); // Số câu hỏi đã thành thạo (Repetitions cao).

      // --- ACT ---
      const result = await service.getReviewStats(1);

      // --- ASSERT ---
      expect(result.total).toBe(20);
      expect(result.due).toBe(5);
      expect(result.learning).toBe(8);
      expect(result.mature).toBe(12);
      expect(result.averageEaseFactor).toBeCloseTo(2.7);
    });

    /**
     * [TC-SRS-017] Xử lý an toàn khi người dùng chưa bắt đầu lộ trình ôn tập (Không có dữ liệu).
     */
    it('TC-SRS-017 - should default avg ease to 2.5 when no data', async () => {
      // --- ARRANGE ---
      reviewRepository.count!.mockResolvedValue(0);
      reviewRepository.__queryBuilder.getRawOne.mockResolvedValue({ avg: null });
      reviewRepository.__queryBuilder.getCount.mockResolvedValue(0);

      // --- ACT ---
      const result = await service.getReviewStats(1);

      // --- ASSERT ---
      // Trả về hệ số dễ mặc định là 2.5.
      expect(result.averageEaseFactor).toBe(2.5);
    });

    /**
     * [TC-SRS-017b] Lỗi khi thống kê lộ trình ôn tập cho User không tồn tại (FAILING TEST).
     * Mục tiêu: Ngăn hệ thống trả về giá trị mặc định 0 khi User bị sai.
     */
    it('TC-SRS-017b - should throw NotFoundException if user not found', async () => {
      await expect(service.getReviewStats(999)).rejects.toThrow(NotFoundException);
    });
  });

  describe('getLessonReviewStats', () => {
    /**
     * [TC-SRS-018] Truy xuất thống kê lộ trình ôn tập cho một bài học cụ thể.
     */
    it('TC-SRS-018 - should return lesson stats with name', async () => {
      // --- ARRANGE ---
      reviewRepository.count!
        .mockResolvedValueOnce(10) // Tổng số câu hỏi.
        .mockResolvedValueOnce(3);  // Số câu hỏi đến hạn.
      reviewRepository.__queryBuilder.getRawOne.mockResolvedValue({ avg: '2.6' });
      reviewRepository.__queryBuilder.getOne.mockResolvedValue({
        lesson: { name: 'Lesson 1' },
      });

      // --- ACT ---
      const result = await service.getLessonReviewStats(1, 5);

      // --- ASSERT ---
      expect(result.lessonName).toBe('Lesson 1');
      expect(result.totalQuestions).toBe(10);
    });

    /**
     * [TC-SRS-019] Xử lý an toàn khi không tìm thấy thông tin bài học (Fallback).
     */
    it('TC-SRS-019 - should fallback to "Unknown Lesson" when no lesson found', async () => {
      // --- ARRANGE ---
      reviewRepository.count!.mockResolvedValue(0);
      reviewRepository.__queryBuilder.getRawOne.mockResolvedValue({ avg: null });
      reviewRepository.__queryBuilder.getOne.mockResolvedValue(null);

      // --- ACT ---
      const result = await service.getLessonReviewStats(1, 5);

      // --- ASSERT ---
      expect(result.lessonName).toBe('Unknown Lesson');
      expect(result.averageEaseFactor).toBe(2.5);
    });

    /**
     * [TC-SRS-019b] Lỗi khi thống kê bài học cho Lesson/User không tồn tại (FAILING TEST).
     */
    it('TC-SRS-019b - should throw NotFoundException if lesson or user not found', async () => {
      await expect(service.getLessonReviewStats(999, 999)).rejects.toThrow(NotFoundException);
    });
  });

  describe('resetQuestionReview', () => {
    /**
     * [TC-SRS-020] Đặt lại toàn bộ tiến độ ôn tập (Reset) cho một câu hỏi cụ thể.
     * Mục tiêu: Đưa các thông số SM-2 về giá trị mặc định ban đầu.
     */
    it('TC-SRS-020 - should reset to initial SM-2 values', async () => {
      // --- ARRANGE ---
      const review = {
        easeFactor: 1.5,
        interval: 30,
        repetitions: 5,
      };
      reviewRepository.findOne!.mockResolvedValue(review);
      reviewRepository.save!.mockImplementation(async (r) => r);

      // --- ACT ---
      const result = await service.resetQuestionReview(1, 1);

      // --- ASSERT ---
      // [CheckDB] Xác nhận các giá trị reset: easeFactor=2.5, interval=1, repetitions=0.
      expect(result.easeFactor).toBe(2.5);
      expect(result.interval).toBe(1);
      expect(result.repetitions).toBe(0);
      expect(result.lastReviewedAt).toBeNull();
    });

    /**
     * [TC-SRS-021] Lỗi khi thực hiện reset cho câu hỏi chưa có bản ghi ôn tập.
     */
    it('TC-SRS-021 - should throw NotFound when missing', async () => {
      // --- ARRANGE ---
      reviewRepository.findOne!.mockResolvedValue(null);

      // --- ACT & ASSERT ---
      await expect(service.resetQuestionReview(1, 99)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
