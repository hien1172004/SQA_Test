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
     * TC-LSN-LSN-001
     * Objective: Tạo lesson với auto orderIndex (không có words/grammarPatterns)
     */
    it('TC-LSN-LSN-001 - should create lesson with auto orderIndex', async () => {
      const dto: any = { name: 'L1', courseId: 1 };
      lessonsRepository.__queryBuilder.getRawOne.mockResolvedValue({
        maxOrder: 2,
      });
      lessonsRepository.create!.mockReturnValue({ ...dto, orderIndex: 3 });
      lessonsRepository.save!.mockResolvedValue({
        id: 100,
        ...dto,
        orderIndex: 3,
      });
      // findOne queryBuilder for findOne method
      lessonsRepository.__queryBuilder.getOne.mockResolvedValue({ id: 100 });

      const result = await service.createLesson(dto);

      expect(lessonsRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ orderIndex: 3 }),
      );
      expect(lessonsRepository.save).toHaveBeenCalled();
      expect(result.id).toBe(100);
    });

    /**
     * TC-LSN-LSN-002
     * Objective: Tạo lesson với words + grammar patterns kèm theo
     */
    it('TC-LSN-LSN-002 - should create lesson with words and grammarPatterns', async () => {
      const dto: any = {
        name: 'L1',
        courseId: 1,
        orderIndex: 1,
        words: [{ wordSenseId: 10 }],
        grammarPatterns: [{ grammarPatternId: 20 }],
      };
      lessonsRepository.create!.mockImplementation((d) => d);
      lessonsRepository.save!.mockResolvedValue({ id: 100, ...dto });
      lessonWordRepository.create!.mockImplementation((d) => d);
      lessonWordRepository.save!.mockResolvedValue([]);
      lessonGrammarPatternRepository.create!.mockImplementation((d) => d);
      lessonGrammarPatternRepository.save!.mockResolvedValue([]);
      lessonsRepository.__queryBuilder.getOne.mockResolvedValue({ id: 100 });

      await service.createLesson(dto);

      expect(lessonWordRepository.save).toHaveBeenCalled();
      expect(lessonGrammarPatternRepository.save).toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    /**
     * TC-LSN-LSN-003
     * Objective: Pagination + filter courseId
     */
    it('TC-LSN-LSN-003 - should apply pagination and courseId filter', async () => {
      const qb = lessonsRepository.__queryBuilder;
      qb.getManyAndCount.mockResolvedValue([[{ id: 1 }], 1]);

      const result = await service.findAll({
        page: 2,
        limit: 5,
        courseId: 3,
      } as any);

      expect(qb.andWhere).toHaveBeenCalledWith('lesson.courseId = :courseId', {
        courseId: 3,
      });
      expect(qb.skip).toHaveBeenCalledWith(5);
      expect(result.total).toBe(1);
    });

    /**
     * TC-LSN-LSN-004
     * Objective: Default chỉ lấy active khi không có includeInactive/isActive
     */
    it('TC-LSN-LSN-004 - should default to active-only when no flags', async () => {
      const qb = lessonsRepository.__queryBuilder;
      qb.getManyAndCount.mockResolvedValue([[], 0]);
      await service.findAll({} as any);
      expect(qb.andWhere).toHaveBeenCalledWith('lesson.isActive = :isActive', {
        isActive: true,
      });
    });

    /**
     * TC-LSN-LSN-005
     * Objective: isActive=false thì truyền đúng vào andWhere
     */
    it('TC-LSN-LSN-005 - should respect explicit isActive=false', async () => {
      const qb = lessonsRepository.__queryBuilder;
      qb.getManyAndCount.mockResolvedValue([[], 0]);
      await service.findAll({ isActive: false } as any);
      expect(qb.andWhere).toHaveBeenCalledWith('lesson.isActive = :isActive', {
        isActive: false,
      });
    });
  });

  describe('findOne', () => {
    /**
     * TC-LSN-LSN-006
     * Objective: Throw NotFound khi không tìm thấy
     */
    it('TC-LSN-LSN-006 - should throw NotFound when not found', async () => {
      lessonsRepository.__queryBuilder.getOne.mockResolvedValue(null);
      await expect(service.findOne(99)).rejects.toThrow(NotFoundException);
    });

    /**
     * TC-LSN-LSN-007
     * Objective: includeInactive=true thì không add isActive filter
     */
    it('TC-LSN-LSN-007 - should not filter isActive when includeInactive=true', async () => {
      const qb = lessonsRepository.__queryBuilder;
      qb.getOne.mockResolvedValue({ id: 1 });
      await service.findOne(1, true);
      // andWhere with isActive should NOT be in calls
      const calls = qb.andWhere.mock.calls.filter(
        (c: any[]) => c[0] === 'lesson.isActive = :isActive',
      );
      expect(calls).toHaveLength(0);
    });
  });

  describe('update', () => {
    /**
     * TC-LSN-LSN-008
     * Objective: Update fields cơ bản trong transaction
     */
    it('TC-LSN-LSN-008 - should update inside transaction', async () => {
      const lesson = { id: 1, courseId: 1, orderIndex: 1, name: 'old' };
      lessonsRepository.__queryBuilder.getOne.mockResolvedValue(lesson);
      const manager = {
        save: jest.fn().mockImplementation(async (e) => e),
        delete: jest.fn(),
        getRepository: jest.fn(),
        create: jest.fn(),
      };
      dataSource.transaction.mockImplementation(async (cb: any) => cb(manager));

      const result = await service.update(1, { name: 'new' } as any);
      expect(manager.save).toHaveBeenCalled();
      expect(result.name).toBe('new');
    });

    /**
     * TC-LSN-LSN-009
     * Objective: Throw BadRequest khi đổi courseId sang course không tồn tại
     */
    it('TC-LSN-LSN-009 - should throw BadRequest when target course missing', async () => {
      lessonsRepository.__queryBuilder.getOne.mockResolvedValue({
        id: 1,
        courseId: 1,
      });
      courseRepository.findOne!.mockResolvedValue(null);
      await expect(
        service.update(1, { courseId: 99 } as any),
      ).rejects.toThrow(BadRequestException);
    });

    /**
     * TC-LSN-LSN-010
     * Objective: Throw BadRequest khi orderIndex đụng lesson khác
     */
    it('TC-LSN-LSN-010 - should throw BadRequest on orderIndex conflict', async () => {
      lessonsRepository.__queryBuilder.getOne.mockResolvedValue({
        id: 1,
        courseId: 1,
        orderIndex: 1,
      });
      lessonsRepository.findOne!.mockResolvedValue({ id: 5 });
      await expect(
        service.update(1, { orderIndex: 2 } as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('softDelete', () => {
    /**
     * TC-LSN-LSN-011
     * Objective: Soft delete = set isActive=false
     */
    it('TC-LSN-LSN-011 - should soft delete', async () => {
      const lesson = { id: 1, isActive: true };
      lessonsRepository.__queryBuilder.getOne.mockResolvedValue(lesson);
      lessonsRepository.save!.mockImplementation(async (l) => l);

      const result = await service.softDelete(1);
      expect(result.isActive).toBe(false);
    });
  });

  describe('hardDelete', () => {
    /**
     * TC-LSN-LSN-012
     * Objective: Hard delete = remove entity
     */
    it('TC-LSN-LSN-012 - should hard delete', async () => {
      const lesson = { id: 1 };
      lessonsRepository.__queryBuilder.getOne.mockResolvedValue(lesson);
      lessonsRepository.remove!.mockResolvedValue(lesson);
      await service.hardDelete(1);
      expect(lessonsRepository.remove).toHaveBeenCalledWith(lesson);
    });
  });

  describe('restore', () => {
    /**
     * TC-LSN-LSN-013
     * Objective: Restore = set isActive=true
     */
    it('TC-LSN-LSN-013 - should restore', async () => {
      lessonsRepository.findOne!.mockResolvedValue({ id: 1, isActive: false });
      lessonsRepository.save!.mockImplementation(async (l) => l);
      const result = await service.restore(1);
      expect(result.isActive).toBe(true);
    });

    /**
     * TC-LSN-LSN-014
     * Objective: Throw NotFound khi không tồn tại
     */
    it('TC-LSN-LSN-014 - should throw NotFound when missing', async () => {
      lessonsRepository.findOne!.mockResolvedValue(null);
      await expect(service.restore(99)).rejects.toThrow(NotFoundException);
    });
  });

  describe('findByCourseId', () => {
    /**
     * TC-LSN-LSN-015
     * Objective: Lấy lessons active của course
     */
    it('TC-LSN-LSN-015 - should fetch active lessons of course', async () => {
      lessonsRepository.find!.mockResolvedValue([]);
      await service.findByCourseId(3);
      expect(lessonsRepository.find).toHaveBeenCalledWith({
        where: { courseId: 3, isActive: true },
        relations: ['course'],
        order: { orderIndex: 'ASC' },
      });
    });
  });

  describe('findByCourseIdIncludeInactive', () => {
    /**
     * TC-LSN-LSN-016
     * Objective: Lấy tất cả lessons của course (kể cả inactive)
     */
    it('TC-LSN-LSN-016 - should fetch all lessons regardless of isActive', async () => {
      lessonsRepository.find!.mockResolvedValue([]);
      await service.findByCourseIdIncludeInactive(3);
      expect(lessonsRepository.find).toHaveBeenCalledWith({
        where: { courseId: 3 },
        relations: ['course'],
        order: { orderIndex: 'ASC' },
      });
    });
  });

  describe('findCompleteLesson', () => {
    /**
     * TC-LSN-LSN-017
     * Objective: Trộn content + questions, sort theo orderIndex
     */
    it('TC-LSN-LSN-017 - should merge content+questions sorted by orderIndex', async () => {
      lessonsRepository.__queryBuilder.getOne.mockResolvedValue({
        id: 1,
        name: 'L1',
        description: 'd',
      });
      contentService.findByLessonId.mockResolvedValue([
        { id: 10, orderIndex: 2, type: 'text', isActive: true, data: {} },
      ]);
      questionsService.findByLessonId.mockResolvedValue([
        {
          id: 20,
          orderIndex: 1,
          questionType: 'mcq',
          isActive: true,
          data: {},
        },
      ]);
      lessonWordRepository.find!.mockResolvedValue([]);
      lessonGrammarPatternRepository.find!.mockResolvedValue([]);

      const result = await service.findCompleteLesson(1);

      expect(result.content).toHaveLength(2);
      expect(result.content[0].itemType).toBe('question'); // orderIndex 1 first
      expect(result.content[1].itemType).toBe('content'); // orderIndex 2 second
    });
  });

  describe('addWordsToLesson', () => {
    /**
     * TC-LSN-LSN-018
     * Objective: Thêm words với auto orderIndex
     */
    it('TC-LSN-LSN-018 - should add words with auto orderIndex', async () => {
      lessonsRepository.__queryBuilder.getOne.mockResolvedValue({ id: 1 });
      wordSenseRepository.count!.mockResolvedValue(1);
      lessonWordRepository.find!.mockResolvedValue([]); // no existing
      lessonWordRepository.__queryBuilder.getRawOne.mockResolvedValue({
        maxOrder: 2,
      });
      lessonWordRepository.create!.mockImplementation((d) => d);
      lessonWordRepository.save!.mockImplementation(async (d) => d);

      const result = await service.addWordsToLesson(1, [{ wordSenseId: 10 }] as any);
      expect(lessonWordRepository.save).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    /**
     * TC-LSN-LSN-019
     * Objective: Throw BadRequest khi wordSenseId không tồn tại
     */
    it('TC-LSN-LSN-019 - should throw BadRequest when wordSenseId not found', async () => {
      lessonsRepository.__queryBuilder.getOne.mockResolvedValue({ id: 1 });
      wordSenseRepository.count!.mockResolvedValue(0);
      wordSenseRepository.find!.mockResolvedValue([]);
      await expect(
        service.addWordsToLesson(1, [{ wordSenseId: 99 }] as any),
      ).rejects.toThrow(BadRequestException);
    });

    /**
     * TC-LSN-LSN-020
     * Objective: Throw BadRequest khi word đã được gán cho lesson
     */
    it('TC-LSN-LSN-020 - should throw BadRequest on duplicate assignment', async () => {
      lessonsRepository.__queryBuilder.getOne.mockResolvedValue({ id: 1 });
      wordSenseRepository.count!.mockResolvedValue(1);
      lessonWordRepository.find!.mockResolvedValue([{ wordSenseId: 10 }]);
      await expect(
        service.addWordsToLesson(1, [{ wordSenseId: 10 }] as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('removeWordsFromLesson', () => {
    /**
     * TC-LSN-LSN-021
     * Objective: Xóa words assigned thành công
     */
    it('TC-LSN-LSN-021 - should remove assigned words', async () => {
      lessonsRepository.__queryBuilder.getOne.mockResolvedValue({ id: 1 });
      lessonWordRepository.find!.mockResolvedValue([{ wordSenseId: 10 }]);
      lessonWordRepository.delete!.mockResolvedValue({ affected: 1 });
      await service.removeWordsFromLesson(1, [10]);
      expect(lessonWordRepository.delete).toHaveBeenCalled();
    });

    /**
     * TC-LSN-LSN-022
     * Objective: Throw BadRequest khi wordSenseId không assigned
     */
    it('TC-LSN-LSN-022 - should throw BadRequest when word not assigned', async () => {
      lessonsRepository.__queryBuilder.getOne.mockResolvedValue({ id: 1 });
      lessonWordRepository.find!.mockResolvedValue([]);
      await expect(
        service.removeWordsFromLesson(1, [10]),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('addGrammarPatternsToLesson', () => {
    /**
     * TC-LSN-LSN-023
     * Objective: Thêm patterns với auto orderIndex
     */
    it('TC-LSN-LSN-023 - should add grammar patterns', async () => {
      lessonsRepository.__queryBuilder.getOne.mockResolvedValue({ id: 1 });
      grammarPatternRepository.count!.mockResolvedValue(1);
      lessonGrammarPatternRepository.find!.mockResolvedValue([]);
      lessonGrammarPatternRepository.__queryBuilder.getRawOne.mockResolvedValue({
        maxOrder: null,
      });
      lessonGrammarPatternRepository.create!.mockImplementation((d) => d);
      lessonGrammarPatternRepository.save!.mockImplementation(async (d) => d);

      await service.addGrammarPatternsToLesson(1, [
        { grammarPatternId: 5 },
      ] as any);
      expect(lessonGrammarPatternRepository.save).toHaveBeenCalled();
    });

    /**
     * TC-LSN-LSN-024
     * Objective: Throw BadRequest khi grammarPatternId không tồn tại
     */
    it('TC-LSN-LSN-024 - should throw BadRequest when pattern not found', async () => {
      lessonsRepository.__queryBuilder.getOne.mockResolvedValue({ id: 1 });
      grammarPatternRepository.count!.mockResolvedValue(0);
      grammarPatternRepository.find!.mockResolvedValue([]);
      await expect(
        service.addGrammarPatternsToLesson(1, [
          { grammarPatternId: 99 },
        ] as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('removeGrammarPatternsFromLesson', () => {
    /**
     * TC-LSN-LSN-025
     * Objective: Xóa patterns thành công
     */
    it('TC-LSN-LSN-025 - should remove assigned patterns', async () => {
      lessonsRepository.__queryBuilder.getOne.mockResolvedValue({ id: 1 });
      lessonGrammarPatternRepository.find!.mockResolvedValue([
        { grammarPatternId: 5 },
      ]);
      lessonGrammarPatternRepository.delete!.mockResolvedValue({ affected: 1 });
      await service.removeGrammarPatternsFromLesson(1, [5]);
      expect(lessonGrammarPatternRepository.delete).toHaveBeenCalled();
    });

    /**
     * TC-LSN-LSN-026
     * Objective: Throw BadRequest khi pattern không assigned
     */
    it('TC-LSN-LSN-026 - should throw BadRequest when pattern not assigned', async () => {
      lessonsRepository.__queryBuilder.getOne.mockResolvedValue({ id: 1 });
      lessonGrammarPatternRepository.find!.mockResolvedValue([]);
      await expect(
        service.removeGrammarPatternsFromLesson(1, [5]),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('update - words branch (transaction)', () => {
    /**
     * Helper: tạo manager mock với getRepository trả về repo với count/find/save/delete/create
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
     * TC-LSN-LSN-038
     * Objective: Update lesson kèm words array hợp lệ → xóa cũ, tạo mới với orderIndex auto
     */
    it('TC-LSN-LSN-038 - should replace lesson words inside transaction', async () => {
      lessonsRepository.__queryBuilder.getOne.mockResolvedValue({
        id: 1,
        courseId: 1,
        orderIndex: 1,
      });
      const manager = buildManager({ validCount: 1, foundIds: [{ id: 10 }] });
      dataSource.transaction.mockImplementation(async (cb: any) => cb(manager));

      await service.update(1, { words: [{ wordSenseId: 10 }] } as any);

      // CheckDB: phải xóa LessonWord cũ rồi save mới
      expect(manager.delete).toHaveBeenCalledWith(LessonWord, { lessonId: 1 });
      expect(manager.save).toHaveBeenCalled();
    });

    /**
     * TC-LSN-LSN-039
     * Objective: Throw BadRequest khi wordSenseId không tồn tại trong transaction
     */
    it('TC-LSN-LSN-039 - should throw BadRequest when wordSenseId missing', async () => {
      lessonsRepository.__queryBuilder.getOne.mockResolvedValue({
        id: 1,
        courseId: 1,
      });
      const manager = buildManager({ validCount: 0, foundIds: [] });
      dataSource.transaction.mockImplementation(async (cb: any) => cb(manager));

      await expect(
        service.update(1, { words: [{ wordSenseId: 99 }] } as any),
      ).rejects.toThrow(BadRequestException);
    });

    /**
     * TC-LSN-LSN-040
     * Objective: Truyền words = [] → xóa cũ, không tạo mới
     */
    it('TC-LSN-LSN-040 - should clear words when empty array provided', async () => {
      lessonsRepository.__queryBuilder.getOne.mockResolvedValue({
        id: 1,
        courseId: 1,
      });
      const manager = buildManager();
      dataSource.transaction.mockImplementation(async (cb: any) => cb(manager));

      await service.update(1, { words: [] } as any);
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
     * TC-LSN-LSN-041
     * Objective: Update lesson kèm grammarPatterns hợp lệ → xóa cũ, tạo mới
     */
    it('TC-LSN-LSN-041 - should replace lesson grammar patterns inside transaction', async () => {
      lessonsRepository.__queryBuilder.getOne.mockResolvedValue({
        id: 1,
        courseId: 1,
      });
      const manager = buildManager({ validCount: 1, foundIds: [{ id: 20 }] });
      dataSource.transaction.mockImplementation(async (cb: any) => cb(manager));

      await service.update(1, {
        grammarPatterns: [{ grammarPatternId: 20 }],
      } as any);

      expect(manager.delete).toHaveBeenCalledWith(LessonGrammarPattern, {
        lessonId: 1,
      });
      expect(manager.save).toHaveBeenCalled();
    });

    /**
     * TC-LSN-LSN-042
     * Objective: Throw BadRequest khi grammarPatternId không tồn tại
     */
    it('TC-LSN-LSN-042 - should throw BadRequest when grammar pattern missing', async () => {
      lessonsRepository.__queryBuilder.getOne.mockResolvedValue({
        id: 1,
        courseId: 1,
      });
      const manager = buildManager({ validCount: 0, foundIds: [] });
      dataSource.transaction.mockImplementation(async (cb: any) => cb(manager));

      await expect(
        service.update(1, {
          grammarPatterns: [{ grammarPatternId: 99 }],
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    /**
     * TC-LSN-LSN-043
     * Objective: Truyền grammarPatterns = [] → chỉ xóa cũ, không tạo mới
     */
    it('TC-LSN-LSN-043 - should clear grammar patterns when empty array provided', async () => {
      lessonsRepository.__queryBuilder.getOne.mockResolvedValue({
        id: 1,
        courseId: 1,
      });
      const manager = buildManager();
      dataSource.transaction.mockImplementation(async (cb: any) => cb(manager));

      await service.update(1, { grammarPatterns: [] } as any);
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

  describe('defensive null checks (dead-code branches)', () => {
    /**
     * Các test này cover các nhánh defensive `if (!lesson)` sau khi gọi findOne(...).
     * Trong runtime thật findOne đã throw NotFound khi không tìm thấy, nên các nhánh
     * này coi như dead code; phải spy + override findOne để force lesson = null.
     */

    /**
     * TC-LSN-LSN-047
     * Objective: addWordsToLesson defensive throw khi findOne trả null
     */
    it('TC-LSN-LSN-047 - addWordsToLesson should throw NotFound when findOne returns null', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue(null as any);
      await expect(
        service.addWordsToLesson(99, [{ wordSenseId: 1 }] as any),
      ).rejects.toThrow(NotFoundException);
    });

    /**
     * TC-LSN-LSN-048
     * Objective: removeWordsFromLesson defensive throw
     */
    it('TC-LSN-LSN-048 - removeWordsFromLesson should throw NotFound when findOne returns null', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue(null as any);
      await expect(service.removeWordsFromLesson(99, [1])).rejects.toThrow(
        NotFoundException,
      );
    });

    /**
     * TC-LSN-LSN-049
     * Objective: addGrammarPatternsToLesson defensive throw
     */
    it('TC-LSN-LSN-049 - addGrammarPatternsToLesson should throw NotFound when findOne returns null', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue(null as any);
      await expect(
        service.addGrammarPatternsToLesson(99, [
          { grammarPatternId: 1 },
        ] as any),
      ).rejects.toThrow(NotFoundException);
    });

    /**
     * TC-LSN-LSN-050
     * Objective: removeGrammarPatternsFromLesson defensive throw
     */
    it('TC-LSN-LSN-050 - removeGrammarPatternsFromLesson should throw NotFound when findOne returns null', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue(null as any);
      await expect(
        service.removeGrammarPatternsFromLesson(99, [1]),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateLessonItem - all field branches', () => {
    /**
     * TC-LSN-LSN-045
     * Objective: updateLessonItem CONTENT truyền đầy đủ lessonId/orderIndex/contentType
     *            → tất cả nhánh build updateData được cover
     */
    it('TC-LSN-LSN-045 - should pass all content fields when provided', async () => {
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
        expect.objectContaining({
          data: { x: 1 },
          lessonId: 5,
          orderIndex: 2,
          type: 'text',
        }),
      );
    });

    /**
     * TC-LSN-LSN-046
     * Objective: updateLessonItem QUESTION truyền đầy đủ lessonId/orderIndex/questionType
     */
    it('TC-LSN-LSN-046 - should pass all question fields when provided', async () => {
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
        expect.objectContaining({
          data: { x: 1 },
          lessonId: 5,
          orderIndex: 2,
          questionType: 'mcq',
        }),
      );
    });
  });

  describe('createLessonItem', () => {
    /**
     * TC-LSN-LSN-027
     * Objective: itemType=content → delegate sang ContentService.create
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
     * TC-LSN-LSN-028
     * Objective: itemType=question → delegate sang QuestionsService.create
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
     * TC-LSN-LSN-029
     * Objective: Throw BadRequest khi content nhưng thiếu contentType
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
     * TC-LSN-LSN-030
     * Objective: Throw BadRequest khi question nhưng thiếu questionType
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
     * TC-LSN-LSN-031
     * Objective: Throw BadRequest khi itemType không hợp lệ
     */
    it('TC-LSN-LSN-031 - should throw BadRequest on invalid itemType', async () => {
      await expect(
        service.createLessonItem({ itemType: 'invalid' } as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('updateLessonItem', () => {
    /**
     * TC-LSN-LSN-032
     * Objective: itemType=content → delegate sang ContentService.update
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
     * TC-LSN-LSN-033
     * Objective: itemType=question → delegate sang QuestionsService.update
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
     * TC-LSN-LSN-034
     * Objective: Throw BadRequest khi itemType invalid
     */
    it('TC-LSN-LSN-034 - should throw BadRequest on invalid itemType', async () => {
      await expect(
        service.updateLessonItem(1, { itemType: 'x' } as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('deleteLessonItem', () => {
    /**
     * TC-LSN-LSN-035
     * Objective: content → ContentService.remove
     */
    it('TC-LSN-LSN-035 - should delegate content delete', async () => {
      contentService.remove.mockResolvedValue(undefined);
      const r = await service.deleteLessonItem(1, LessonItemType.CONTENT);
      expect(contentService.remove).toHaveBeenCalledWith(1);
      expect(r.message).toMatch(/Content/);
    });

    /**
     * TC-LSN-LSN-036
     * Objective: question → QuestionsService.remove
     */
    it('TC-LSN-LSN-036 - should delegate question delete', async () => {
      questionsService.remove.mockResolvedValue(undefined);
      const r = await service.deleteLessonItem(1, LessonItemType.QUESTION);
      expect(questionsService.remove).toHaveBeenCalledWith(1);
      expect(r.message).toMatch(/Question/);
    });

    /**
     * TC-LSN-LSN-037
     * Objective: Throw BadRequest on invalid itemType
     */
    it('TC-LSN-LSN-037 - should throw BadRequest on invalid itemType', async () => {
      await expect(
        service.deleteLessonItem(1, 'x' as any),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
