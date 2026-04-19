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
     * TC-SRS-001
     * Objective: Trả về record đã tồn tại, không tạo mới
     */
    it('TC-SRS-001 - should return existing review without creating new', async () => {
      const existing = { id: 1, userId: 1, questionId: 2 };
      reviewRepository.findOne!.mockResolvedValue(existing);

      const result = await service.initializeQuestionForReview(1, 2, 3);

      expect(reviewRepository.findOne).toHaveBeenCalledWith({
        where: { userId: 1, questionId: 2 },
      });
      expect(reviewRepository.save).not.toHaveBeenCalled();
      expect(result).toEqual(existing);
    });

    /**
     * TC-SRS-002
     * Objective: Tạo record mới với SM-2 default values khi chưa tồn tại
     */
    it('TC-SRS-002 - should create new with default SM-2 values', async () => {
      reviewRepository.findOne!.mockResolvedValue(null);
      questionRepository.findOne!.mockResolvedValue({ id: 2 });
      reviewRepository.create!.mockImplementation((d) => d);
      reviewRepository.save!.mockImplementation(async (d) => ({ id: 10, ...d }));

      const result = await service.initializeQuestionForReview(1, 2, 3);

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
     * TC-SRS-003
     * Objective: Throw NotFound khi question không tồn tại
     */
    it('TC-SRS-003 - should throw NotFound when question missing', async () => {
      reviewRepository.findOne!.mockResolvedValue(null);
      questionRepository.findOne!.mockResolvedValue(null);
      await expect(
        service.initializeQuestionForReview(1, 99, 3),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('initializeLessonQuestionsForReview', () => {
    /**
     * TC-SRS-004
     * Objective: Khởi tạo review cho tất cả questions của lesson
     */
    it('TC-SRS-004 - should initialize all active questions of lesson', async () => {
      questionRepository.find!.mockResolvedValue([
        { id: 1 },
        { id: 2 },
      ]);
      reviewRepository.findOne!.mockResolvedValue({ id: 99 }); // existing

      const result = await service.initializeLessonQuestionsForReview(1, 5);

      expect(questionRepository.find).toHaveBeenCalledWith({
        where: { lessonId: 5, isActive: true },
      });
      expect(result).toHaveLength(2);
    });

    /**
     * TC-SRS-005
     * Objective: Trả về [] khi lesson không có question active
     */
    it('TC-SRS-005 - should return empty array when no questions', async () => {
      questionRepository.find!.mockResolvedValue([]);
      const result = await service.initializeLessonQuestionsForReview(1, 5);
      expect(result).toEqual([]);
    });
  });

  describe('submitReviewResult (SM-2 algorithm)', () => {
    /**
     * TC-SRS-006
     * Objective: quality < 0 → throw BadRequest
     */
    it('TC-SRS-006 - should throw BadRequest when quality < 0', async () => {
      await expect(
        service.submitReviewResult(1, { questionId: 1, quality: -1 } as any),
      ).rejects.toThrow(BadRequestException);
    });

    /**
     * TC-SRS-007
     * Objective: quality > 5 → throw BadRequest
     */
    it('TC-SRS-007 - should throw BadRequest when quality > 5', async () => {
      await expect(
        service.submitReviewResult(1, { questionId: 1, quality: 6 } as any),
      ).rejects.toThrow(BadRequestException);
    });

    /**
     * TC-SRS-008
     * Objective: Throw NotFound khi không có review record
     */
    it('TC-SRS-008 - should throw NotFound when review record missing', async () => {
      reviewRepository.findOne!.mockResolvedValue(null);
      await expect(
        service.submitReviewResult(1, { questionId: 1, quality: 3 } as any),
      ).rejects.toThrow(NotFoundException);
    });

    /**
     * TC-SRS-009
     * Objective: quality < 3 → reset repetitions=0, interval=1; ease factor giảm
     */
    it('TC-SRS-009 - should reset on failed recall (quality < 3)', async () => {
      const review = {
        userId: 1,
        questionId: 1,
        easeFactor: '2.5',
        interval: '6',
        repetitions: '2',
      };
      reviewRepository.findOne!.mockResolvedValue(review);
      reviewRepository.save!.mockImplementation(async (r) => r);

      const result = await service.submitReviewResult(1, {
        questionId: 1,
        quality: 2,
      } as any);

      expect(result.repetitions).toBe(0);
      expect(result.interval).toBe(1);
      expect(result.easeFactor).toBeLessThan(2.5);
      expect(result.lastReviewedAt).toBeInstanceOf(Date);
    });

    /**
     * TC-SRS-010
     * Objective: First successful repetition (rep 0→1) → interval = 1
     */
    it('TC-SRS-010 - should set interval=1 on first success', async () => {
      reviewRepository.findOne!.mockResolvedValue({
        easeFactor: '2.5',
        interval: '0',
        repetitions: '0',
      });
      reviewRepository.save!.mockImplementation(async (r) => r);

      const result = await service.submitReviewResult(1, {
        questionId: 1,
        quality: 4,
      } as any);

      expect(result.repetitions).toBe(1);
      expect(result.interval).toBe(1);
    });

    /**
     * TC-SRS-011
     * Objective: Second successful repetition (rep 1→2) → interval = 6
     */
    it('TC-SRS-011 - should set interval=6 on second success', async () => {
      reviewRepository.findOne!.mockResolvedValue({
        easeFactor: '2.5',
        interval: '1',
        repetitions: '1',
      });
      reviewRepository.save!.mockImplementation(async (r) => r);

      const result = await service.submitReviewResult(1, {
        questionId: 1,
        quality: 4,
      } as any);

      expect(result.repetitions).toBe(2);
      expect(result.interval).toBe(6);
    });

    /**
     * TC-SRS-012
     * Objective: Third+ successful repetition → interval = round(prevInterval * easeFactor)
     */
    it('TC-SRS-012 - should multiply interval by ease on rep>=3', async () => {
      reviewRepository.findOne!.mockResolvedValue({
        easeFactor: '2.5',
        interval: '6',
        repetitions: '2',
      });
      reviewRepository.save!.mockImplementation(async (r) => r);

      const result = await service.submitReviewResult(1, {
        questionId: 1,
        quality: 5,
      } as any);

      expect(result.repetitions).toBe(3);
      // quality=5 → ease = 2.5 + (0.1 - 0) = 2.6 → interval = round(6*2.6) = 16
      expect(result.interval).toBe(16);
    });

    /**
     * TC-SRS-013
     * Objective: Ease factor floor at 1.3 (never go lower)
     */
    it('TC-SRS-013 - should floor ease factor at 1.3', async () => {
      reviewRepository.findOne!.mockResolvedValue({
        easeFactor: '1.3',
        interval: '1',
        repetitions: '0',
      });
      reviewRepository.save!.mockImplementation(async (r) => r);

      // quality=0: ease = 1.3 + (0.1 - 5*(0.08+5*0.02)) = 1.3 + (0.1 - 0.9) = 0.5 → floored to 1.3
      const result = await service.submitReviewResult(1, {
        questionId: 1,
        quality: 0,
      } as any);
      expect(result.easeFactor).toBe(1.3);
    });
  });

  describe('getDueReviews', () => {
    /**
     * TC-SRS-014
     * Objective: Lấy review due (nextReviewDate <= today end), kèm question relation
     */
    it('TC-SRS-014 - should fetch due reviews with question relation', async () => {
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

      const result = await service.getDueReviews(1);

      expect(reviewRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: 1,
            nextReviewDate: expect.any(Object), // LessThanOrEqual
          }),
          relations: ['question'],
          order: { nextReviewDate: 'ASC' },
        }),
      );
      expect(result[0].questionType).toBe('mcq');
    });
  });

  describe('getUpcomingReviews', () => {
    /**
     * TC-SRS-015
     * Objective: Trả về group by date trong 30 ngày tới
     */
    it('TC-SRS-015 - should aggregate upcoming reviews by date', async () => {
      reviewRepository.__queryBuilder.getRawMany.mockResolvedValue([
        { date: '2026-04-20', count: '3' },
        { date: '2026-04-21', count: '5' },
      ]);

      const result = await service.getUpcomingReviews(1);
      expect(result).toEqual([
        { date: '2026-04-20', count: 3 },
        { date: '2026-04-21', count: 5 },
      ]);
    });
  });

  describe('getReviewStats', () => {
    /**
     * TC-SRS-016
     * Objective: Trả về stats với learning/mature counts từ query builder
     */
    it('TC-SRS-016 - should return aggregated review stats', async () => {
      reviewRepository.count!
        .mockResolvedValueOnce(20) // total
        .mockResolvedValueOnce(5) // due
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0);
      reviewRepository.__queryBuilder.getRawOne.mockResolvedValue({ avg: '2.7' });
      reviewRepository.__queryBuilder.getCount
        .mockResolvedValueOnce(8) // learning
        .mockResolvedValueOnce(12); // mature

      const result = await service.getReviewStats(1);

      expect(result.total).toBe(20);
      expect(result.due).toBe(5);
      expect(result.learning).toBe(8);
      expect(result.mature).toBe(12);
      expect(result.averageEaseFactor).toBeCloseTo(2.7);
    });

    /**
     * TC-SRS-017
     * Objective: averageEaseFactor mặc định 2.5 khi không có data
     */
    it('TC-SRS-017 - should default avg ease to 2.5 when no data', async () => {
      reviewRepository.count!.mockResolvedValue(0);
      reviewRepository.__queryBuilder.getRawOne.mockResolvedValue({ avg: null });
      reviewRepository.__queryBuilder.getCount.mockResolvedValue(0);

      const result = await service.getReviewStats(1);
      expect(result.averageEaseFactor).toBe(2.5);
    });
  });

  describe('getLessonReviewStats', () => {
    /**
     * TC-SRS-018
     * Objective: Trả về stats kèm tên lesson
     */
    it('TC-SRS-018 - should return lesson stats with name', async () => {
      reviewRepository.count!
        .mockResolvedValueOnce(10) // total
        .mockResolvedValueOnce(3); // due
      reviewRepository.__queryBuilder.getRawOne.mockResolvedValue({ avg: '2.6' });
      reviewRepository.__queryBuilder.getOne.mockResolvedValue({
        lesson: { name: 'Lesson 1' },
      });

      const result = await service.getLessonReviewStats(1, 5);
      expect(result.lessonName).toBe('Lesson 1');
      expect(result.totalQuestions).toBe(10);
    });

    /**
     * TC-SRS-019
     * Objective: lessonName = 'Unknown Lesson' khi không có lesson
     */
    it('TC-SRS-019 - should fallback to "Unknown Lesson" when no lesson found', async () => {
      reviewRepository.count!.mockResolvedValue(0);
      reviewRepository.__queryBuilder.getRawOne.mockResolvedValue({ avg: null });
      reviewRepository.__queryBuilder.getOne.mockResolvedValue(null);

      const result = await service.getLessonReviewStats(1, 5);
      expect(result.lessonName).toBe('Unknown Lesson');
      expect(result.averageEaseFactor).toBe(2.5);
    });
  });

  describe('resetQuestionReview', () => {
    /**
     * TC-SRS-020
     * Objective: Reset review về initial values
     */
    it('TC-SRS-020 - should reset to initial SM-2 values', async () => {
      const review = {
        easeFactor: 1.5,
        interval: 30,
        repetitions: 5,
      };
      reviewRepository.findOne!.mockResolvedValue(review);
      reviewRepository.save!.mockImplementation(async (r) => r);

      const result = await service.resetQuestionReview(1, 1);
      expect(result.easeFactor).toBe(2.5);
      expect(result.interval).toBe(1);
      expect(result.repetitions).toBe(0);
      expect(result.lastReviewedAt).toBeNull();
    });

    /**
     * TC-SRS-021
     * Objective: Throw NotFound khi không có review
     */
    it('TC-SRS-021 - should throw NotFound when missing', async () => {
      reviewRepository.findOne!.mockResolvedValue(null);
      await expect(service.resetQuestionReview(1, 99)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
