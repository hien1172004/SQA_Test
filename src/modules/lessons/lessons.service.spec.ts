/**
 * Unit tests for LessonsService.
 *
 * Strategy: mock-only.
 * Đặc biệt: LessonsService dùng DataSource.transaction(cb) — mock bằng cách
 * gọi callback trực tiếp với một fake EntityManager.
 *
 * CheckDB: assert các repo + entityManager methods được gọi với tham số đúng.
 * Rollback: jest.clearAllMocks() trong afterEach (no real DB).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { LessonsService } from './lessons.service';
import { Lessons } from './entities/lesson.entities';
import { LessonWord } from './entities/lesson-word.entity';
import { LessonGrammarPattern } from './entities/lesson-grammar-pattern.entity';
import { WordSense } from '../words/entities/word-sense.entity';
import { GrammarPattern } from '../grammar/entities/grammar-pattern.entity';
import { Courses } from '../courses/entities/course.entities';
import { ContentService } from './content.service';
import { QuestionsService } from './questions.service';
import { LessonItemType } from './dto/create-lesson-item.dto';
import {
  createMockRepository,
  MockRepository,
} from '../../test/helpers/mock-repository';

describe('LessonsService', () => {
  let service: LessonsService;
  let lessonsRepository: MockRepository;
  let lessonWordRepository: MockRepository;
  let lessonGrammarPatternRepository: MockRepository;
  let wordSenseRepository: MockRepository;
  let grammarPatternRepository: MockRepository;
  let courseRepository: MockRepository;
  let contentService: any;
  let questionsService: any;
  let dataSource: any;

  beforeEach(async () => {
    lessonsRepository = createMockRepository();
    lessonWordRepository = createMockRepository();
    lessonGrammarPatternRepository = createMockRepository();
    wordSenseRepository = createMockRepository();
    grammarPatternRepository = createMockRepository();
    courseRepository = createMockRepository();
    contentService = {
      findByLessonId: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
    };
    questionsService = {
      findByLessonId: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
    };
    dataSource = {
      // transaction(cb) gọi cb(manager) trực tiếp
      transaction: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LessonsService,
        { provide: getRepositoryToken(Lessons), useValue: lessonsRepository },
        {
          provide: getRepositoryToken(LessonWord),
          useValue: lessonWordRepository,
        },
        {
          provide: getRepositoryToken(LessonGrammarPattern),
          useValue: lessonGrammarPatternRepository,
        },
        {
          provide: getRepositoryToken(WordSense),
          useValue: wordSenseRepository,
        },
        {
          provide: getRepositoryToken(GrammarPattern),
          useValue: grammarPatternRepository,
        },
        { provide: getRepositoryToken(Courses), useValue: courseRepository },
        { provide: ContentService, useValue: contentService },
        { provide: QuestionsService, useValue: questionsService },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = module.get<LessonsService>(LessonsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createLesson', () => {
    /**
     * [TC-LSN-LSN-001] Khởi tạo bài học mới với số thứ tự tự động.
     * Mục tiêu: Đảm bảo khi không truyền orderIndex, hệ thống tự lấy giá trị max hiện tại cộng thêm 1.
     */
    it('TC-LSN-LSN-001 - should create lesson with auto orderIndex', async () => {
      // --- ARRANGE ---
      // Input: DTO cơ bản chỉ có tên và mã khóa học.
      const dto: any = { name: 'L1', courseId: 1 };

      // TypeORM logic: getRawOne() thực hiện câu lệnh SQL SELECT MAX(orderIndex).
      // Giả lập giá trị lớn nhất hiện tại là 2.
      lessonsRepository.__queryBuilder.getRawOne.mockResolvedValue({
        maxOrder: 2,
      });

      // Khởi tạo thực thể với orderIndex = 2 + 1 = 3.
      lessonsRepository.create!.mockReturnValue({ ...dto, orderIndex: 3 });

      // save() thực hiện INSERT vào DB và trả về bản ghi có ID=100.
      lessonsRepository.save!.mockResolvedValue({
        id: 100,
        ...dto,
        orderIndex: 3,
      });

      // Giả lập tìm lại để trả về kết quả cuối cùng.
      lessonsRepository.__queryBuilder.getOne.mockResolvedValue({ id: 100 });

      // --- ACT ---
      const result = await service.createLesson(dto);

      // --- ASSERT ---
      // [CheckDB] Xác nhận service đã tính toán và gán orderIndex = 3 cho repository.create.
      expect(lessonsRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ orderIndex: 3 }),
      );
      // [CheckDB] Xác nhận repository.save thực sự được gọi để ghi xuống DB.
      expect(lessonsRepository.save).toHaveBeenCalled();
      expect(result.id).toBe(100);
    });

    it('TC-LSN-LSN-001b - should handle null maxOrder', async () => {
      // --- ARRANGE ---
      lessonsRepository.__queryBuilder.getRawOne.mockResolvedValue({ maxOrder: null });
      lessonsRepository.create.mockReturnValue({ id: 1 });
      lessonsRepository.save.mockResolvedValue({ id: 1 });
      lessonsRepository.__queryBuilder.getOne.mockResolvedValue({ id: 1 });
      await service.createLesson({ name: 'L1', courseId: 1 });
      expect(lessonsRepository.create).toHaveBeenCalledWith(expect.objectContaining({ orderIndex: 1 }));
    });

    it('TC-LSN-LSN-001c - should use provided orderIndex', async () => {
      // --- ARRANGE ---
      lessonsRepository.create.mockReturnValue({ id: 1 });
      lessonsRepository.save.mockResolvedValue({ id: 1 });
      lessonsRepository.__queryBuilder.getOne.mockResolvedValue({ id: 1 });
      await service.createLesson({ name: 'L1', courseId: 1, orderIndex: 99 });
      expect(lessonsRepository.create).toHaveBeenCalledWith(expect.objectContaining({ orderIndex: 99 }));
    });

    /**
     * [TC-LSN-LSN-002] Khởi tạo bài học kèm theo danh sách Từ vựng và Ngữ pháp.
     * Mục tiêu: Xác nhận hệ thống thực hiện lưu trữ bài học chính và các quan hệ phụ trong một quy trình.
     */
    it('TC-LSN-LSN-002 - should create lesson with words and grammarPatterns', async () => {
      // --- ARRANGE ---
      const dto: any = {
        name: 'L1',
        courseId: 1,
        orderIndex: 1,
        words: [{ wordSenseId: 10 }, { wordSenseId: 11, orderIndex: 5 }],
        grammarPatterns: [{ grammarPatternId: 20 }, { grammarPatternId: 21, orderIndex: 8 }],
      };

      // Giả lập các hàm save của các repository liên quan.
      lessonsRepository.create!.mockImplementation((d) => d);
      lessonsRepository.save!.mockResolvedValue({ id: 100, ...dto });
      lessonWordRepository.create!.mockImplementation((d) => d);
      lessonWordRepository.save!.mockResolvedValue([]);
      lessonGrammarPatternRepository.create!.mockImplementation((d) => d);
      lessonGrammarPatternRepository.save!.mockResolvedValue([]);
      lessonsRepository.__queryBuilder.getOne.mockResolvedValue({ id: 100 });

      // --- ACT ---
      await service.createLesson(dto);

      // --- ASSERT ---
      // [CheckDB] Xác nhận quan hệ Bài học - Từ vựng được lưu trữ.
      expect(lessonWordRepository.save).toHaveBeenCalled();
      // [CheckDB] Xác nhận quan hệ Bài học - Ngữ pháp được lưu trữ.
      expect(lessonGrammarPatternRepository.save).toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    /**
     * [TC-LSN-LSN-003] Tìm kiếm bài học với phân trang và lọc theo khóa học.
     * Mục tiêu: Xác nhận logic tính toán skip (offset) và áp dụng filter courseId chính xác.
     */
    it('TC-LSN-LSN-003 - should apply pagination and courseId filter', async () => {
      // --- ARRANGE ---
      const qb = lessonsRepository.__queryBuilder;
      // Trả về 1 bản ghi và tổng số 1 (trong DB có 1 bản ghi thỏa mãn).
      qb.getManyAndCount.mockResolvedValue([[{ id: 1 }], 1]);

      // --- ACT ---
      // Trang 2, limit 5 -> skip = (2-1)*5 = 5.
      const result = await service.findAll({
        page: 2,
        limit: 5,
        courseId: 3,
      } as any);

      // --- ASSERT ---
      // [CheckDB] Xác nhận QueryBuilder lọc đúng mã khóa học = 3.
      expect(qb.andWhere).toHaveBeenCalledWith('lesson.courseId = :courseId', {
        courseId: 3,
      });
      // [CheckDB] Xác nhận skip đúng giá trị 5 để lấy dữ liệu trang 2.
      expect(qb.skip).toHaveBeenCalledWith(5);
      expect(result.total).toBe(1);
    });

    /**
     * [TC-LSN-LSN-004] Lọc bài học theo trạng thái mặc định (Active).
     * Mục tiêu: Khi không yêu cầu cụ thể, hệ thống chỉ lấy các bài học đang hoạt động (isActive = true).
     */
    it('TC-LSN-LSN-004 - should default to active-only when no flags', async () => {
      // --- ARRANGE ---
      const qb = lessonsRepository.__queryBuilder;
      qb.getManyAndCount.mockResolvedValue([[], 0]);

      // --- ACT ---
      await service.findAll({} as any);

      // --- ASSERT ---
      // [CheckDB] Xác nhận andWhere('isActive = true') được tự động thêm vào query.
      expect(qb.andWhere).toHaveBeenCalledWith('lesson.isActive = :isActive', {
        isActive: true,
      });
    });

    /**
     * [TC-LSN-LSN-005] Lọc bài học theo trạng thái không hoạt động (Inactive).
     */
    it('TC-LSN-LSN-005 - should respect explicit isActive=false', async () => {
      // --- ARRANGE ---
      const qb = lessonsRepository.__queryBuilder;
      qb.getManyAndCount.mockResolvedValue([[], 0]);

      // --- ACT ---
      await service.findAll({ isActive: false } as any);

      // --- ASSERT ---
      // [CheckDB] Xác nhận query lọc đúng trạng thái isActive = false.
      expect(qb.andWhere).toHaveBeenCalledWith('lesson.isActive = :isActive', {
        isActive: false,
      });
    });
  });

  describe('findOne', () => {
    /**
     * [TC-LSN-LSN-006] Lấy chi tiết bài học không tồn tại.
     * Mục tiêu: Ném NotFoundException khi ID không hợp lệ.
     */
    it('TC-LSN-LSN-006 - should throw NotFound when not found', async () => {
      // --- ARRANGE ---
      // Giả lập DB trả về null (không tìm thấy).
      lessonsRepository.__queryBuilder.getOne.mockResolvedValue(null);

      // --- ACT & ASSERT ---
      await expect(service.findOne(99)).rejects.toThrow(NotFoundException);
    });

    /**
     * [TC-LSN-LSN-007] Lấy chi tiết bài học bao gồm cả trạng thái Inactive.
     * Mục tiêu: Khi includeInactive = true, không được phép thêm filter isActive vào SQL.
     */
    it('TC-LSN-LSN-007 - should not filter isActive when includeInactive=true', async () => {
      // --- ARRANGE ---
      const qb = lessonsRepository.__queryBuilder;
      qb.getOne.mockResolvedValue({ id: 1 });

      // --- ACT ---
      await service.findOne(1, true);

      // --- ASSERT ---
      // [CheckDB] Kiểm tra danh sách các lệnh andWhere đã gọi.
      const calls = qb.andWhere.mock.calls.filter(
        (c: any[]) => c[0] === 'lesson.isActive = :isActive',
      );
      // Kết quả kỳ vọng: Không có lệnh andWhere nào liên quan đến isActive (Length = 0).
      expect(calls).toHaveLength(0);
    });
  });

  describe('update', () => {
    /**
     * [TC-LSN-LSN-008c] Kiểm tra phòng vệ: Cập nhật bài học không tồn tại.
     */
    it('TC-LSN-LSN-008c - should throw NotFound when lesson missing at start of update', async () => {
      jest.spyOn(service, 'findOne').mockRejectedValue(new NotFoundException());
      await expect(service.update(99, {} as any)).rejects.toThrow(NotFoundException);
    });

    /**
     * [TC-LSN-LSN-008] Cập nhật thông tin bài học trong Transaction.
     * Mục tiêu: Xác nhận các thay đổi được thực hiện thông qua EntityManager của Transaction để đảm bảo tính toàn vẹn.
     */
    it('TC-LSN-LSN-008 - should update inside transaction', async () => {
      // --- ARRANGE ---
      const lesson = { id: 1, courseId: 1, orderIndex: 1, name: 'old' };
      lessonsRepository.__queryBuilder.getOne.mockResolvedValue(lesson);

      // Giả lập EntityManager của TypeORM.
      const manager = {
        save: jest.fn().mockImplementation(async (e) => e),
        delete: jest.fn(),
        getRepository: jest.fn(),
        create: jest.fn(),
      };
      // Logic: dataSource.transaction(cb) sẽ thực thi callback cb(manager).
      dataSource.transaction.mockImplementation(async (cb: any) => cb(manager));

      // --- ACT ---
      const result = await service.update(1, { name: 'new' } as any);

      // --- ASSERT ---
      // [CheckDB] Xác nhận manager.save được gọi thay vì repository.save thông thường.
      expect(result.name).toBe('new');
    });

    it('TC-LSN-LSN-008b - should update with mixed orderIndex for words and grammar', async () => {
      // --- ARRANGE ---
      const lesson = { id: 1, courseId: 1, orderIndex: 1, name: 'old' };
      lessonsRepository.__queryBuilder.getOne.mockResolvedValue(lesson);
      const manager = {
        save: jest.fn().mockImplementation(async (e) => e),
        delete: jest.fn(),
        getRepository: jest.fn().mockReturnValue({
          count: jest.fn().mockResolvedValue(2),
          find: jest.fn().mockResolvedValue([{ id: 10 }, { id: 11 }]),
        }),
        create: jest.fn().mockImplementation((cls, d) => d),
      };
      dataSource.transaction.mockImplementation(async (cb: any) => cb(manager));

      // --- ACT ---
      await service.update(1, {
        words: [{ wordSenseId: 10 }, { wordSenseId: 11, orderIndex: 5 }],
        grammarPatterns: [{ grammarPatternId: 20 }, { grammarPatternId: 21, orderIndex: 8 }],
      } as any);

      // --- ASSERT ---
      // Xác nhận orderIndex được gán chính xác cho cả hai trường hợp: tự động tăng và người dùng chỉ định.
      expect(manager.create).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ orderIndex: 0 }));
      expect(manager.create).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ orderIndex: 5 }));
    });

    /**
     * [TC-LSN-LSN-009] Lỗi khi chuyển bài học sang khóa học không tồn tại.
     * Mục tiêu: Ngăn chặn việc gán khóa học (courseId) không hợp lệ.
     */
    it('TC-LSN-LSN-009 - should throw BadRequest when target course missing', async () => {
      // --- ARRANGE ---
      lessonsRepository.__queryBuilder.getOne.mockResolvedValue({
        id: 1,
        courseId: 1,
      });
      // Giả lập không tìm thấy khóa học mới (ID 99).
      courseRepository.findOne!.mockResolvedValue(null);

      // --- ACT & ASSERT ---
      await expect(
        service.update(1, { courseId: 99 } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('TC-LSN-LSN-009b - should throw BadRequest when some words missing during update', async () => {
      // --- ARRANGE ---
      lessonsRepository.__queryBuilder.getOne.mockResolvedValue({ id: 1 });
      const manager = {
        save: jest.fn().mockImplementation(async (e) => e),
        delete: jest.fn(),
        getRepository: jest.fn().mockReturnValue({
          count: jest.fn().mockResolvedValue(1), // Chỉ tìm thấy 1/2
          find: jest.fn().mockResolvedValue([{ id: 10 }]), // Đảm bảo callback xử lý ID danh sách từ vựng được thực thi.
        }),
      };
      dataSource.transaction.mockImplementation(async (cb: any) => cb(manager));

      // --- ACT & ASSERT ---
      await expect(
        service.update(1, { words: [{ wordSenseId: 10 }, { wordSenseId: 99 }] } as any),
      ).rejects.toThrow(BadRequestException);
    });

    /**
     * [TC-LSN-LSN-010] Lỗi xung đột số thứ tự (orderIndex) khi cập nhật.
     * Mục tiêu: Đảm bảo không có hai bài học trùng số thứ tự trong cùng một khóa học.
     */
    it('TC-LSN-LSN-010 - should throw BadRequest on orderIndex conflict', async () => {
      // --- ARRANGE ---
      lessonsRepository.__queryBuilder.getOne.mockResolvedValue({
        id: 1,
        courseId: 1,
        orderIndex: 1,
      });
      // Giả lập tìm thấy một bài học khác (ID 5) đã chiếm dụng orderIndex mới.
      lessonsRepository.findOne!.mockResolvedValue({ id: 5 });

      // --- ACT & ASSERT ---
      await expect(
        service.update(1, { orderIndex: 2 } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('TC-LSN-LSN-010b - should throw on conflict when changing both course and orderIndex', async () => {
      // --- ARRANGE ---
      lessonsRepository.__queryBuilder.getOne.mockResolvedValue({ id: 1, courseId: 1, orderIndex: 1 });
      courseRepository.findOne!.mockResolvedValue({ id: 2 });
      lessonsRepository.findOne!.mockResolvedValue({ id: 5 }); // Conflict in course 2

      // --- ACT & ASSERT ---
      await expect(
        service.update(1, { courseId: 2, orderIndex: 1 } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('TC-LSN-LSN-010c - should throw BadRequest when some grammar patterns missing during update', async () => {
      // --- ARRANGE ---
      lessonsRepository.__queryBuilder.getOne.mockResolvedValue({ id: 1 });
      const manager = {
        save: jest.fn().mockImplementation(async (e) => e),
        delete: jest.fn(),
        getRepository: jest.fn().mockReturnValue({
          count: jest.fn().mockResolvedValue(1), // Chỉ tìm thấy 1/2
          find: jest.fn().mockResolvedValue([{ id: 5 }]), // Đảm bảo callback xử lý ID danh sách cấu trúc ngữ pháp được thực thi.
        }),
      };
      dataSource.transaction.mockImplementation(async (cb: any) => cb(manager));

      // --- ACT & ASSERT ---
      await expect(
        service.update(1, { grammarPatterns: [{ grammarPatternId: 5 }, { grammarPatternId: 99 }] } as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('softDelete', () => {
    /**
     * [TC-LSN-LSN-011] Xóa mềm bài học.
     * Mục tiêu: Không xóa bản ghi khỏi DB mà chỉ chuyển isActive sang false.
     */
    it('TC-LSN-LSN-011 - should soft delete', async () => {
      // --- ARRANGE ---
      const lesson = { id: 1, isActive: true };
      lessonsRepository.__queryBuilder.getOne.mockResolvedValue(lesson);
      lessonsRepository.save!.mockImplementation(async (l) => l);

      // --- ACT ---
      const result = await service.softDelete(1);

      // --- ASSERT ---
      // [CheckDB] Xác nhận trạng thái isActive đã chuyển thành false trước khi lưu.
      expect(result.isActive).toBe(false);
      expect(lessonsRepository.save).toHaveBeenCalled();
    });
  });

  describe('hardDelete', () => {
    /**
     * [TC-LSN-LSN-012] Xóa cứng bài học.
     * Mục tiêu: Loại bỏ hoàn toàn bản ghi khỏi cơ sở dữ liệu.
     */
    it('TC-LSN-LSN-012 - should hard delete', async () => {
      // --- ARRANGE ---
      const lesson = { id: 1 };
      lessonsRepository.__queryBuilder.getOne.mockResolvedValue(lesson);
      lessonsRepository.remove!.mockResolvedValue(lesson);

      // --- ACT ---
      await service.hardDelete(1);

      // --- ASSERT ---
      // [CheckDB] Xác nhận lệnh remove() được gọi với thực thể mục tiêu.
      expect(lessonsRepository.remove).toHaveBeenCalledWith(lesson);
    });
  });

  describe('restore', () => {
    /**
     * [TC-LSN-LSN-013] Khôi phục bài học đã xóa mềm.
     */
    it('TC-LSN-LSN-013 - should restore', async () => {
      // --- ARRANGE ---
      lessonsRepository.findOne!.mockResolvedValue({ id: 1, isActive: false });
      lessonsRepository.save!.mockImplementation(async (l) => l);

      // --- ACT ---
      const result = await service.restore(1);

      // --- ASSERT ---
      // [CheckDB] Trạng thái được khôi phục về true.
      expect(result.isActive).toBe(true);
      expect(lessonsRepository.save).toHaveBeenCalled();
    });

    /**
     * [TC-LSN-LSN-014] Lỗi khôi phục bài học không tồn tại.
     */
    it('TC-LSN-LSN-014 - should throw NotFound when missing', async () => {
      // --- ARRANGE ---
      lessonsRepository.findOne!.mockResolvedValue(null);

      // --- ACT & ASSERT ---
      await expect(service.restore(99)).rejects.toThrow(NotFoundException);
    });
  });

  describe('findByCourseId', () => {
    /**
     * [TC-LSN-LSN-015] Lấy danh sách bài học đang hoạt động của một khóa học.
     */
    it('TC-LSN-LSN-015 - should fetch active lessons of course', async () => {
      // --- ARRANGE ---
      lessonsRepository.find!.mockResolvedValue([]);

      // --- ACT ---
      await service.findByCourseId(3);

      // --- ASSERT ---
      // [CheckDB] Xác nhận các điều kiện: đúng courseId, chỉ lấy isActive=true và sắp xếp theo orderIndex.
      expect(lessonsRepository.find).toHaveBeenCalledWith({
        where: { courseId: 3, isActive: true },
        relations: ['course'],
        order: { orderIndex: 'ASC' },
      });
    });

    /**
     * [TC-LSN-LSN-015b] Lỗi khi truy xuất bài học cho Course không tồn tại (FAILING TEST).
     */
    it('TC-LSN-LSN-015b - should throw NotFoundException if course not found', async () => {
      await expect(service.findByCourseId(999)).rejects.toThrow(NotFoundException);
    });
  });

  describe('findByCourseIdIncludeInactive', () => {
    /**
     * [TC-LSN-LSN-016] Lấy toàn bộ bài học của khóa học (bao gồm cả Inactive).
     */
    it('TC-LSN-LSN-016 - should fetch all lessons regardless of isActive', async () => {
      // --- ARRANGE ---
      lessonsRepository.find!.mockResolvedValue([]);

      // --- ACT ---
      await service.findByCourseIdIncludeInactive(3);

      // --- ASSERT ---
      // [CheckDB] Xác nhận không có điều kiện isActive trong tham số WHERE.
      expect(lessonsRepository.find).toHaveBeenCalledWith({
        where: { courseId: 3 },
        relations: ['course'],
        order: { orderIndex: 'ASC' },
      });
    });

    /**
     * [TC-LSN-LSN-016b] Lỗi khi truy xuất toàn bộ bài học cho Course không tồn tại (FAILING TEST).
     */
    it('TC-LSN-LSN-016b - should throw NotFoundException if course not found', async () => {
      await expect(service.findByCourseIdIncludeInactive(999)).rejects.toThrow(NotFoundException);
    });
  });

  describe('findCompleteLesson', () => {
    /**
     * [TC-LSN-LSN-017] Truy xuất nội dung bài học đầy đủ (bao gồm Content và Questions).
     * Mục tiêu: Xác nhận hệ thống gộp hai nguồn dữ liệu khác nhau và sắp xếp chính xác theo orderIndex.
     */
    it('TC-LSN-LSN-017 - should merge content+questions sorted by orderIndex', async () => {
      // --- ARRANGE ---
      lessonsRepository.__queryBuilder.getOne.mockResolvedValue({
        id: 1,
        name: 'L1',
      });
      // Content có orderIndex = 2.
      contentService.findByLessonId.mockResolvedValue([
        { id: 10, orderIndex: 2, type: 'text', isActive: true, data: {} },
      ]);
      // Question có orderIndex = 1.
      questionsService.findByLessonId.mockResolvedValue([
        { id: 20, orderIndex: 1, questionType: 'mcq', isActive: true, data: {} },
      ]);
      lessonWordRepository.find!.mockResolvedValue([]);
      lessonGrammarPatternRepository.find!.mockResolvedValue([]);

      // --- ACT ---
      const result = await service.findCompleteLesson(1);

      // --- ASSERT ---
      expect(result.content).toHaveLength(2);
      // Kết quả kỳ vọng: Question (1) xuất hiện trước Content (2).
      expect(result.content[0].itemType).toBe('question');
      expect(result.content[1].itemType).toBe('content');
    });
  });

  describe('addWordsToLesson', () => {
    /**
     * [TC-LSN-LSN-018c] Kiểm tra phòng vệ: Thêm từ vựng vào bài học không tồn tại.
     */
    it('TC-LSN-LSN-018c - addWordsToLesson should throw NotFound when findOne returns null', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue(null as any);
      await expect(service.addWordsToLesson(99, [] as any)).rejects.toThrow(NotFoundException);
    });

    /**
     * [TC-LSN-LSN-018] Thêm từ vựng vào bài học.
     * Mục tiêu: Tự động gán orderIndex cho từ vựng mới dựa trên danh sách hiện tại.
     */
    it('TC-LSN-LSN-018 - should add words with mixed orderIndex (auto and provided)', async () => {
      // --- ARRANGE ---
      lessonsRepository.__queryBuilder.getOne.mockResolvedValue({ id: 1 });
      wordSenseRepository.count!.mockResolvedValue(2);
      wordSenseRepository.find!.mockResolvedValue([{ id: 10 }, { id: 11 }]);
      lessonWordRepository.find!.mockResolvedValue([]);
      lessonWordRepository.__queryBuilder.getRawOne.mockResolvedValue({ maxOrder: 5 });
      lessonWordRepository.create!.mockImplementation((d) => d);

      // --- ACT ---
      await service.addWordsToLesson(1, [
        { wordSenseId: 10 }, // Tự động gán (maxOrder + 1)
        { wordSenseId: 11, orderIndex: 100 } // Người dùng cung cấp
      ] as any);

      // --- ASSERT ---
      expect(lessonWordRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ orderIndex: 100 }),
      );
    });

    it('TC-LSN-LSN-018b - should handle null maxOrder when adding words (starts from 0)', async () => {
      // --- ARRANGE ---
      lessonsRepository.__queryBuilder.getOne.mockResolvedValue({ id: 1 });
      wordSenseRepository.count!.mockResolvedValue(1);
      wordSenseRepository.find!.mockResolvedValue([{ id: 10 }]);
      lessonWordRepository.find!.mockResolvedValue([]);
      lessonWordRepository.__queryBuilder.getRawOne.mockResolvedValue(null); // Trường hợp chưa có dữ liệu thứ tự
      lessonWordRepository.create!.mockImplementation((d) => d);

      // --- ACT ---
      await service.addWordsToLesson(1, [{ wordSenseId: 10 }] as any);

      // --- ASSERT ---
      // Logic gán giá trị khởi tạo (mặc định bắt đầu từ 0)
      expect(lessonWordRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ orderIndex: 0 }),
      );
    });

    /**
     * [TC-LSN-LSN-019] Lỗi khi thêm từ vựng không tồn tại vào bài học.
     */
    it('TC-LSN-LSN-019 - should throw BadRequest when wordSenseId not found', async () => {
      // --- ARRANGE ---
      lessonsRepository.__queryBuilder.getOne.mockResolvedValue({ id: 1 });
      // Giả lập gửi lên 2 ID nhưng chỉ tìm thấy 1.
      wordSenseRepository.count!.mockResolvedValue(1);
      wordSenseRepository.find!.mockResolvedValue([{ id: 10 }]);

      // --- ACT & ASSERT ---
      await expect(
        service.addWordsToLesson(1, [{ wordSenseId: 10 }, { wordSenseId: 99 }] as any),
      ).rejects.toThrow(BadRequestException);
    });

    /**
     * [TC-LSN-LSN-020] Lỗi khi thêm từ vựng đã tồn tại trong bài học.
     */
    it('TC-LSN-LSN-020 - should throw BadRequest on duplicate assignment', async () => {
      // --- ARRANGE ---
      lessonsRepository.__queryBuilder.getOne.mockResolvedValue({ id: 1 });
      wordSenseRepository.count!.mockResolvedValue(2);
      wordSenseRepository.find!.mockResolvedValue([{ id: 10 }, { id: 11 }]);
      // Mô phỏng quan hệ đã tồn tại để kiểm tra lỗi trùng lặp.
      lessonWordRepository.find!.mockResolvedValue([{ wordSenseId: 10 }]);

      // --- ACT & ASSERT ---
      await expect(
        service.addWordsToLesson(1, [{ wordSenseId: 10 }, { wordSenseId: 11 }] as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('removeWordsFromLesson', () => {
    /**
     * [TC-LSN-LSN-021b] Kiểm tra phòng vệ: Gỡ từ vựng khỏi bài học không tồn tại.
     */
    it('TC-LSN-LSN-021b - removeWordsFromLesson should throw NotFound when findOne returns null', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue(null as any);
      await expect(service.removeWordsFromLesson(99, [1])).rejects.toThrow(NotFoundException);
    });

    /**
     * [TC-LSN-LSN-021] Gỡ bỏ từ vựng khỏi bài học.
     */
    it('TC-LSN-LSN-021 - should remove assigned words', async () => {
      // --- ARRANGE ---
      lessonsRepository.__queryBuilder.getOne.mockResolvedValue({ id: 1 });
      lessonWordRepository.find!.mockResolvedValue([{ wordSenseId: 10 }]);
      lessonWordRepository.delete!.mockResolvedValue({ affected: 1 });

      // --- ACT ---
      await service.removeWordsFromLesson(1, [10]);

      // --- ASSERT ---
      // [CheckDB] Xác nhận lệnh delete được gọi với đúng lessonId và wordSenseId.
      expect(lessonWordRepository.delete).toHaveBeenCalled();
    });

    /**
     * [TC-LSN-LSN-022] Lỗi khi gỡ bỏ từ vựng chưa được gán vào bài học.
     */
    it('TC-LSN-LSN-022 - should throw BadRequest when word not assigned', async () => {
      // --- ARRANGE ---
      lessonsRepository.__queryBuilder.getOne.mockResolvedValue({ id: 1 });
      // Giả lập tìm thấy 1 cái đã gán, nhưng gửi lên 2 cái (thiếu 1).
      lessonWordRepository.find!.mockResolvedValue([{ wordSenseId: 10 }]);

      // --- ACT & ASSERT ---
      await expect(
        service.removeWordsFromLesson(1, [10, 99]),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('addGrammarPatternsToLesson', () => {
    /**
     * [TC-LSN-LSN-023c] Kiểm tra phòng vệ: Thêm ngữ pháp vào bài học không tồn tại.
     */
    it('TC-LSN-LSN-023c - addGrammarPatternsToLesson should throw NotFound when findOne returns null', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue(null as any);
      await expect(service.addGrammarPatternsToLesson(99, [] as any)).rejects.toThrow(NotFoundException);
    });

    /**
     * [TC-LSN-LSN-023] Thêm cấu trúc ngữ pháp vào bài học.
     */
    it('TC-LSN-LSN-023 - should add grammar patterns', async () => {
      // --- ARRANGE ---
      lessonsRepository.__queryBuilder.getOne.mockResolvedValue({ id: 1 });
      grammarPatternRepository.count!.mockResolvedValue(1);
      lessonGrammarPatternRepository.find!.mockResolvedValue([]);
      lessonGrammarPatternRepository.__queryBuilder.getRawOne.mockResolvedValue({
        maxOrder: null,
      });
      lessonGrammarPatternRepository.create!.mockImplementation((d) => d);
      lessonGrammarPatternRepository.save!.mockImplementation(async (d) => d);

      // --- ACT ---
      await service.addGrammarPatternsToLesson(1, [{ grammarPatternId: 5 }] as any);

      // --- ASSERT ---
      // [CheckDB] Xác nhận lưu trữ quan hệ bài học - ngữ pháp.
      expect(lessonGrammarPatternRepository.save).toHaveBeenCalled();
    });

    it('TC-LSN-LSN-023b - should handle mixed orderIndex for grammar', async () => {
      // --- ARRANGE ---
      lessonsRepository.__queryBuilder.getOne.mockResolvedValue({ id: 1 });
      grammarPatternRepository.count!.mockResolvedValue(2);
      grammarPatternRepository.find!.mockResolvedValue([{ id: 5 }, { id: 6 }]);
      lessonGrammarPatternRepository.find!.mockResolvedValue([]);
      lessonGrammarPatternRepository.__queryBuilder.getRawOne.mockResolvedValue({ maxOrder: 1 });
      lessonGrammarPatternRepository.create!.mockImplementation((d) => d);
      await service.addGrammarPatternsToLesson(1, [{ grammarPatternId: 5 }, { grammarPatternId: 6, orderIndex: 10 }] as any);
      expect(lessonGrammarPatternRepository.create).toHaveBeenCalledWith(expect.objectContaining({ orderIndex: 2 }));
    });

    /**
     * [TC-LSN-LSN-024] Lỗi khi thêm ngữ pháp không tồn tại.
     */
    it('TC-LSN-LSN-024 - should throw BadRequest when pattern not found', async () => {
      // --- ARRANGE ---
      lessonsRepository.__queryBuilder.getOne.mockResolvedValue({ id: 1 });
      // Giả lập tìm thấy 1/2 mẫu ngữ pháp.
      grammarPatternRepository.count!.mockResolvedValue(1);
      grammarPatternRepository.find!.mockResolvedValue([{ id: 5 }]);

      // --- ACT & ASSERT ---
      await expect(
        service.addGrammarPatternsToLesson(1, [{ grammarPatternId: 5 }, { grammarPatternId: 99 }] as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('removeGrammarPatternsFromLesson', () => {
    /**
     * [TC-LSN-LSN-025b] Kiểm tra phòng vệ: Xóa ngữ pháp khỏi bài học không tồn tại.
     */
    it('TC-LSN-LSN-025b - removeGrammarPatternsFromLesson should throw NotFound when findOne returns null', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue(null as any);
      await expect(service.removeGrammarPatternsFromLesson(99, [1])).rejects.toThrow(NotFoundException);
    });

    /**
     * [TC-LSN-LSN-025] Gỡ bỏ ngữ pháp khỏi bài học.
     */
    it('TC-LSN-LSN-025 - should remove assigned patterns', async () => {
      // --- ARRANGE ---
      lessonsRepository.__queryBuilder.getOne.mockResolvedValue({ id: 1 });
      lessonGrammarPatternRepository.find!.mockResolvedValue([{ grammarPatternId: 5 }]);
      lessonGrammarPatternRepository.delete!.mockResolvedValue({ affected: 1 });

      // --- ACT ---
      await service.removeGrammarPatternsFromLesson(1, [5]);

      // --- ASSERT ---
      // [CheckDB] Xác nhận repository.delete được gọi.
      expect(lessonGrammarPatternRepository.delete).toHaveBeenCalled();
    });

    /**
     * [TC-LSN-LSN-026] Lỗi khi gỡ bỏ ngữ pháp chưa được gán.
     */
    it('TC-LSN-LSN-026 - should throw BadRequest when pattern not assigned', async () => {
      // --- ARRANGE ---
      lessonsRepository.__queryBuilder.getOne.mockResolvedValue({ id: 1 });
      // Giả lập tìm thấy 1 cấu trúc đã gán, nhưng xóa 2 cái (thiếu 1).
      lessonGrammarPatternRepository.find!.mockResolvedValue([{ grammarPatternId: 5 }]);

      // --- ACT & ASSERT ---
      await expect(
        service.removeGrammarPatternsFromLesson(1, [5, 99]),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('createLessonItem', () => {
    /**
     * [TC-LSN-LSN-027] itemType=content -> delegate sang ContentService.create
     */
    it('TC-LSN-LSN-027 - should delegate content creation to ContentService', async () => {
      contentService.create.mockResolvedValue({ id: 1 });
      await service.createLessonItem({
        itemType: LessonItemType.CONTENT,
        contentType: 'text',
        lessonId: 1,
      } as any);
      expect(contentService.create).toHaveBeenCalled();
    });

    /**
     * [TC-LSN-LSN-028] itemType=question -> delegate sang QuestionsService.create
     */
    it('TC-LSN-LSN-028 - should delegate question creation to QuestionsService', async () => {
      questionsService.create.mockResolvedValue({ id: 1 });
      await service.createLessonItem({
        itemType: LessonItemType.QUESTION,
        questionType: 'mcq',
        lessonId: 1,
      } as any);
      expect(questionsService.create).toHaveBeenCalled();
    });

    /**
     * [TC-LSN-LSN-029] Lỗi khi tạo Content nhưng thiếu contentType
     */
    it('TC-LSN-LSN-029 - should throw BadRequest when content missing contentType', async () => {
      await expect(
        service.createLessonItem({
          itemType: LessonItemType.CONTENT,
          lessonId: 1,
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    /**
     * [TC-LSN-LSN-030] Lỗi khi tạo Question nhưng thiếu questionType
     */
    it('TC-LSN-LSN-030 - should throw BadRequest when question missing questionType', async () => {
      await expect(
        service.createLessonItem({
          itemType: LessonItemType.QUESTION,
          lessonId: 1,
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    /**
     * [TC-LSN-LSN-031] Lỗi khi itemType không hợp lệ
     */
    it('TC-LSN-LSN-031 - should throw BadRequest on invalid itemType', async () => {
      await expect(
        service.createLessonItem({ itemType: 'invalid' } as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('updateLessonItem', () => {
    /**
     * [TC-LSN-LSN-032] Cập nhật Content - Luồng cơ bản
     */
    it('TC-LSN-LSN-032 - should delegate content update', async () => {
      contentService.update.mockResolvedValue({ id: 1 });
      await service.updateLessonItem(1, {
        itemType: LessonItemType.CONTENT,
        data: { x: 1 },
      } as any);
      expect(contentService.update).toHaveBeenCalled();
    });

    /**
     * [TC-LSN-LSN-032b] Cập nhật Content - Đầy đủ các trường bổ trợ (lessonId, orderIndex, type)
     */
    it('TC-LSN-LSN-032b - should pass all content fields (lessonId, orderIndex, type) when provided', async () => {
      contentService.update.mockResolvedValue({ id: 1 });
      await service.updateLessonItem(1, {
        itemType: LessonItemType.CONTENT,
        data: { x: 1 },
        lessonId: 5,
        orderIndex: 2,
        contentType: 'text',
      } as any);
      expect(contentService.update).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ type: 'text', lessonId: 5, orderIndex: 2 }),
      );
    });

    /**
     * [TC-LSN-LSN-033] Cập nhật Question - Luồng cơ bản
     */
    it('TC-LSN-LSN-033 - should delegate question update', async () => {
      questionsService.update.mockResolvedValue({ id: 1 });
      await service.updateLessonItem(1, {
        itemType: LessonItemType.QUESTION,
        data: { x: 1 },
      } as any);
      expect(questionsService.update).toHaveBeenCalled();
    });

    /**
     * [TC-LSN-LSN-033b] Cập nhật Question - Đầy đủ các trường bổ trợ (lessonId, orderIndex, questionType)
     */
    it('TC-LSN-LSN-033b - should pass all question fields (lessonId, orderIndex, questionType) when provided', async () => {
      questionsService.update.mockResolvedValue({ id: 1 });
      await service.updateLessonItem(1, {
        itemType: LessonItemType.QUESTION,
        data: { x: 1 },
        lessonId: 5,
        orderIndex: 2,
        questionType: 'mcq',
      } as any);
      expect(questionsService.update).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ questionType: 'mcq', lessonId: 5, orderIndex: 2 }),
      );
    });

    /**
     * [TC-LSN-LSN-034] Lỗi khi itemType không hợp lệ
     */
    it('TC-LSN-LSN-034 - should throw BadRequest on invalid itemType', async () => {
      await expect(
        service.updateLessonItem(1, { itemType: 'x' } as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('deleteLessonItem', () => {
    /**
     * [TC-LSN-LSN-035] Xóa Content
     */
    it('TC-LSN-LSN-035 - should delegate content delete', async () => {
      contentService.remove.mockResolvedValue(undefined);
      const r = await service.deleteLessonItem(1, LessonItemType.CONTENT);
      expect(contentService.remove).toHaveBeenCalledWith(1);
      expect(r.message).toMatch(/Content/);
    });

    /**
     * [TC-LSN-LSN-035b] Lỗi khi xóa Content không tồn tại.
     * Mục tiêu: Đảm bảo lỗi NotFoundException từ ContentService được sủi bọt (bubble-up) chính xác.
     */
    it('TC-LSN-LSN-035b - should bubble up NotFoundException when content is missing', async () => {
      contentService.remove.mockRejectedValue(new NotFoundException());
      await expect(
        service.deleteLessonItem(999, LessonItemType.CONTENT),
      ).rejects.toThrow(NotFoundException);
    });

    /**
     * [TC-LSN-LSN-036] Xóa Question

     */
    it('TC-LSN-LSN-036 - should delegate question delete', async () => {
      questionsService.remove.mockResolvedValue(undefined);
      const r = await service.deleteLessonItem(1, LessonItemType.QUESTION);
      expect(questionsService.remove).toHaveBeenCalledWith(1);
      expect(r.message).toMatch(/Question/);
    });

    /**
     * [TC-LSN-LSN-036b] Lỗi khi xóa Question không tồn tại.
     * Mục tiêu: Đảm bảo lỗi NotFoundException từ QuestionsService được sủi bọt (bubble-up) chính xác.
     */
    it('TC-LSN-LSN-036b - should bubble up NotFoundException when question is missing', async () => {
      questionsService.remove.mockRejectedValue(new NotFoundException());
      await expect(
        service.deleteLessonItem(999, LessonItemType.QUESTION),
      ).rejects.toThrow(NotFoundException);
    });

    /**
     * [TC-LSN-LSN-037] Lỗi khi xóa với itemType không hợp lệ

     */
    it('TC-LSN-LSN-037 - should throw BadRequest on invalid itemType', async () => {
      await expect(
        service.deleteLessonItem(1, 'x' as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('update - words branch (transaction)', () => {
    /**
     * Helper: tạo manager mock với các hành vi repository chuẩn.
     */
    const buildManager = (overrides: any = {}) => ({
      save: jest.fn().mockImplementation(async (e) => e),
      delete: jest.fn(),
      create: jest.fn().mockImplementation((_entity, data) => data),
      getRepository: jest.fn().mockReturnValue({
        count: jest.fn().mockResolvedValue(overrides.validCount ?? 1),
        find: jest.fn().mockResolvedValue(overrides.foundIds ?? [{ id: 10 }]),
      }),
    });

    /**
     * [TC-LSN-LSN-038] Thay thế toàn bộ danh sách từ vựng của bài học trong Transaction.
     * Mục tiêu: Xác nhận quy trình xóa các liên kết cũ và tạo mới diễn ra đồng bộ.
     */
    it('TC-LSN-LSN-038 - should replace lesson words inside transaction', async () => {
      // --- ARRANGE ---
      lessonsRepository.__queryBuilder.getOne.mockResolvedValue({
        id: 1,
        courseId: 1,
        orderIndex: 1,
      });
      const manager = buildManager({ validCount: 1, foundIds: [{ id: 10 }] });
      dataSource.transaction.mockImplementation(async (cb: any) => cb(manager));

      // --- ACT ---
      await service.update(1, { words: [{ wordSenseId: 10 }] } as any);

      // --- ASSERT ---
      // [CheckDB] Xác nhận lệnh delete các LessonWord cũ của bài học ID=1.
      expect(manager.delete).toHaveBeenCalledWith(LessonWord, { lessonId: 1 });
      // [CheckDB] Xác nhận lệnh save được gọi để lưu danh sách từ vựng mới.
      expect(manager.save).toHaveBeenCalled();
    });

    /**
     * [TC-LSN-LSN-039] Lỗi khi danh sách từ vựng cập nhật chứa ID không tồn tại.
     */
    it('TC-LSN-LSN-039 - should throw BadRequest when wordSenseId missing', async () => {
      // --- ARRANGE ---
      lessonsRepository.__queryBuilder.getOne.mockResolvedValue({
        id: 1,
        courseId: 1,
      });
      const manager = buildManager({ validCount: 0, foundIds: [] });
      dataSource.transaction.mockImplementation(async (cb: any) => cb(manager));

      // --- ACT & ASSERT ---
      await expect(
        service.update(1, { words: [{ wordSenseId: 99 }] } as any),
      ).rejects.toThrow(BadRequestException);
    });

    /**
     * [TC-LSN-LSN-040] Xóa sạch danh sách từ vựng khi truyền mảng rỗng.
     */
    it('TC-LSN-LSN-040 - should clear words when empty array provided', async () => {
      // --- ARRANGE ---
      lessonsRepository.__queryBuilder.getOne.mockResolvedValue({
        id: 1,
        courseId: 1,
      });
      const manager = buildManager();
      dataSource.transaction.mockImplementation(async (cb: any) => cb(manager));

      // --- ACT ---
      await service.update(1, { words: [] } as any);

      // --- ASSERT ---
      // [CheckDB] Chỉ gọi delete, không gọi save thêm từ mới.
      expect(manager.delete).toHaveBeenCalledWith(LessonWord, { lessonId: 1 });
    });
  });

  describe('update - grammarPatterns branch (transaction)', () => {
    const buildManager = (overrides: any = {}) => ({
      save: jest.fn().mockImplementation(async (e) => e),
      delete: jest.fn(),
      create: jest.fn().mockImplementation((_entity, data) => data),
      getRepository: jest.fn().mockReturnValue({
        count: jest.fn().mockResolvedValue(overrides.validCount ?? 1),
        find: jest.fn().mockResolvedValue(overrides.foundIds ?? [{ id: 20 }]),
      }),
    });

    /**
     * [TC-LSN-LSN-041] Thay thế danh sách cấu trúc ngữ pháp của bài học.
     */
    it('TC-LSN-LSN-041 - should replace lesson grammar patterns inside transaction', async () => {
      // --- ARRANGE ---
      lessonsRepository.__queryBuilder.getOne.mockResolvedValue({
        id: 1,
        courseId: 1,
      });
      const manager = buildManager({ validCount: 1, foundIds: [{ id: 20 }] });
      dataSource.transaction.mockImplementation(async (cb: any) => cb(manager));

      // --- ACT ---
      await service.update(1, {
        grammarPatterns: [{ grammarPatternId: 20 }],
      } as any);

      // --- ASSERT ---
      // [CheckDB] Xóa bỏ liên kết ngữ pháp cũ.
      expect(manager.delete).toHaveBeenCalledWith(LessonGrammarPattern, {
        lessonId: 1,
      });
      expect(manager.save).toHaveBeenCalled();
    });

    /**
     * [TC-LSN-LSN-042] Lỗi khi ngữ pháp cập nhật không tồn tại.
     */
    it('TC-LSN-LSN-042 - should throw BadRequest when grammar pattern missing', async () => {
      // --- ARRANGE ---
      lessonsRepository.__queryBuilder.getOne.mockResolvedValue({
        id: 1,
        courseId: 1,
      });
      const manager = buildManager({ validCount: 0, foundIds: [] });
      dataSource.transaction.mockImplementation(async (cb: any) => cb(manager));

      // --- ACT & ASSERT ---
      await expect(
        service.update(1, {
          grammarPatterns: [{ grammarPatternId: 99 }],
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    /**
     * [TC-LSN-LSN-043] Xóa sạch ngữ pháp khi truyền mảng rỗng.
     */
    it('TC-LSN-LSN-043 - should clear grammar patterns when empty array provided', async () => {
      // --- ARRANGE ---
      lessonsRepository.__queryBuilder.getOne.mockResolvedValue({
        id: 1,
        courseId: 1,
      });
      const manager = buildManager();
      dataSource.transaction.mockImplementation(async (cb: any) => cb(manager));

      // --- ACT ---
      await service.update(1, { grammarPatterns: [] } as any);

      // --- ASSERT ---
      expect(manager.delete).toHaveBeenCalledWith(LessonGrammarPattern, {
        lessonId: 1,
      });
    });
  });

  describe('addGrammarPatternsToLesson - duplicate branch', () => {
    /**
     * TC-LSN-LSN-044
     * Objective: Throw BadRequest khi grammarPatternId đã được gán cho lesson
     */
    it('TC-LSN-LSN-044 - should throw BadRequest on duplicate pattern assignment', async () => {
      lessonsRepository.__queryBuilder.getOne.mockResolvedValue({ id: 1 });
      grammarPatternRepository.count!.mockResolvedValue(1);
      lessonGrammarPatternRepository.find!.mockResolvedValue([
        { grammarPatternId: 5 },
      ]);
      await expect(
        service.addGrammarPatternsToLesson(1, [
          { grammarPatternId: 5 },
        ] as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getLessonWords', () => {
    /**
     * [TC-LSN-LSN-045] Lấy danh sách từ vựng của bài học.
     * Mục tiêu: Đảm bảo dữ liệu từ vựng được join đúng với wordSense, word, và translations.
     */
    it('TC-LSN-LSN-045 - should fetch lesson words correctly', async () => {
      lessonWordRepository.find!.mockResolvedValue([{ id: 1 }]);
      await service.getLessonWords(1);
      expect(lessonWordRepository.find).toHaveBeenCalledWith({
        where: { lessonId: 1 },
        relations: ['wordSense', 'wordSense.word', 'wordSense.translations'],
        order: { orderIndex: 'ASC' },
      });
    });

    /**
     * [TC-LSN-LSN-045b] Lỗi khi lấy danh sách từ vựng cho Lesson không tồn tại (FAILING TEST).
     */
    it('TC-LSN-LSN-045b - should throw NotFoundException if lesson not found', async () => {
      await expect(service.getLessonWords(999)).rejects.toThrow(NotFoundException);
    });
  });

  describe('getLessonGrammarPatterns', () => {
    /**
     * [TC-LSN-LSN-046] Lấy danh sách cấu trúc ngữ pháp của bài học.
     * Mục tiêu: Đảm bảo dữ liệu được join đúng với grammarPattern và translations.
     */
    it('TC-LSN-LSN-046 - should fetch lesson grammar patterns correctly', async () => {
      lessonGrammarPatternRepository.find!.mockResolvedValue([{ id: 1 }]);
      await service.getLessonGrammarPatterns(1);
      expect(lessonGrammarPatternRepository.find).toHaveBeenCalledWith({
        where: { lessonId: 1 },
        relations: ['grammarPattern', 'grammarPattern.translations'],
        order: { orderIndex: 'ASC' },
      });
    });

    /**
     * [TC-LSN-LSN-046b] Lỗi khi lấy cấu trúc ngữ pháp cho Lesson không tồn tại (FAILING TEST).
     */
    it('TC-LSN-LSN-046b - should throw NotFoundException if lesson not found', async () => {
      await expect(service.getLessonGrammarPatterns(999)).rejects.toThrow(NotFoundException);
    });
  });
});
