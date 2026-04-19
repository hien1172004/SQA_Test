/**
 * Unit tests for QuestionsService.
 *
 * Strategy: mock-only.
 * - Question repository: mock đầy đủ method TypeORM.
 * - OrderIndexService: mock chỉ phương thức getNextOrderIndex.
 * CheckDB: assert repository methods (find/findOne/save/delete) được gọi đúng tham số.
 * Rollback: jest.clearAllMocks() trong afterEach (no real DB).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { QuestionsService } from './questions.service';
import { Question } from './entities/question.entity';
import { OrderIndexService } from './order-index.service';
import {
  createMockRepository,
  MockRepository,
} from '../../test/helpers/mock-repository';

describe('QuestionsService', () => {
  let service: QuestionsService;
  let questionRepository: MockRepository;
  let orderIndexService: { getNextOrderIndex: jest.Mock };

  beforeEach(async () => {
    questionRepository = createMockRepository();
    orderIndexService = { getNextOrderIndex: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QuestionsService,
        { provide: getRepositoryToken(Question), useValue: questionRepository },
        { provide: OrderIndexService, useValue: orderIndexService },
      ],
    }).compile();

    service = module.get<QuestionsService>(QuestionsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    /**
     * TC-LSN-QST-001
     * Objective: Tạo question với orderIndex tự sinh khi không truyền vào
     * Input:    DTO không có orderIndex; lessonId=10
     * Expected: gọi getNextOrderIndex(10), gọi repo.create + repo.save với orderIndex được set
     */
    it('TC-LSN-QST-001 - should auto-generate orderIndex when not provided', async () => {
      const dto: any = { lessonId: 10, questionType: 'mcq', data: {} };
      const createdEntity = { ...dto, orderIndex: 5 };
      const savedEntity = { id: 1, ...createdEntity };
      orderIndexService.getNextOrderIndex.mockResolvedValue(5);
      questionRepository.create!.mockReturnValue(createdEntity);
      questionRepository.save!.mockResolvedValue(savedEntity);

      const result = await service.create(dto);

      expect(orderIndexService.getNextOrderIndex).toHaveBeenCalledWith(10);
      expect(questionRepository.create).toHaveBeenCalledWith({
        ...dto,
        orderIndex: 5,
      });
      expect(questionRepository.save).toHaveBeenCalledWith(createdEntity);
      expect(result).toEqual(savedEntity);
    });

    /**
     * TC-LSN-QST-002
     * Objective: Không gọi getNextOrderIndex khi orderIndex đã được truyền
     * Input:    DTO có orderIndex = 9
     * Expected: orderIndexService không được gọi; save dùng orderIndex=9
     */
    it('TC-LSN-QST-002 - should keep provided orderIndex', async () => {
      const dto: any = {
        lessonId: 10,
        orderIndex: 9,
        questionType: 'mcq',
        data: {},
      };
      questionRepository.create!.mockReturnValue(dto);
      questionRepository.save!.mockResolvedValue({ id: 2, ...dto });

      await service.create(dto);

      expect(orderIndexService.getNextOrderIndex).not.toHaveBeenCalled();
      expect(questionRepository.create).toHaveBeenCalledWith(dto);
    });

    /**
     * TC-LSN-QST-003
     * Objective: Coi orderIndex = null như chưa có và auto-generate
     * Input:    DTO có orderIndex = null
     * Expected: getNextOrderIndex được gọi
     */
    it('TC-LSN-QST-003 - should treat null orderIndex as missing', async () => {
      const dto: any = { lessonId: 4, orderIndex: null };
      orderIndexService.getNextOrderIndex.mockResolvedValue(2);
      questionRepository.create!.mockReturnValue({});
      questionRepository.save!.mockResolvedValue({});

      await service.create(dto);
      expect(orderIndexService.getNextOrderIndex).toHaveBeenCalledWith(4);
    });
  });

  describe('findAll', () => {
    /**
     * TC-LSN-QST-004
     * Objective: Trả về danh sách question đang active, sort theo orderIndex ASC
     * Expected: repo.find được gọi với { isActive: true } + order ASC
     */
    it('TC-LSN-QST-004 - should return only active questions', async () => {
      const list = [{ id: 1 }, { id: 2 }];
      questionRepository.find!.mockResolvedValue(list);

      const result = await service.findAll();

      expect(questionRepository.find).toHaveBeenCalledWith({
        where: { isActive: true },
        order: { orderIndex: 'ASC' },
      });
      expect(result).toEqual(list);
    });
  });

  describe('findByLessonId', () => {
    /**
     * TC-LSN-QST-005
     * Objective: Trả về question theo lessonId, chỉ lấy active
     */
    it('TC-LSN-QST-005 - should query by lessonId and isActive', async () => {
      questionRepository.find!.mockResolvedValue([]);
      await service.findByLessonId(7);
      expect(questionRepository.find).toHaveBeenCalledWith({
        where: { lessonId: 7, isActive: true },
        order: { orderIndex: 'ASC' },
      });
    });
  });

  describe('findOne', () => {
    /**
     * TC-LSN-QST-006
     * Objective: Trả về question khi tồn tại; chỉ filter active mặc định
     */
    it('TC-LSN-QST-006 - should return question when found (active only)', async () => {
      const q = { id: 1, isActive: true };
      questionRepository.findOne!.mockResolvedValue(q);

      const result = await service.findOne(1);

      expect(questionRepository.findOne).toHaveBeenCalledWith({
        where: { id: 1, isActive: true },
      });
      expect(result).toEqual(q);
    });

    /**
     * TC-LSN-QST-007
     * Objective: includeInactive=true thì không filter isActive
     */
    it('TC-LSN-QST-007 - should not filter isActive when includeInactive=true', async () => {
      questionRepository.findOne!.mockResolvedValue({ id: 1 });
      await service.findOne(1, true);
      expect(questionRepository.findOne).toHaveBeenCalledWith({
        where: { id: 1 },
      });
    });

    /**
     * TC-LSN-QST-008
     * Objective: Throw NotFoundException khi không tìm thấy
     */
    it('TC-LSN-QST-008 - should throw NotFoundException when not found', async () => {
      questionRepository.findOne!.mockResolvedValue(null);
      await expect(service.findOne(999)).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    /**
     * TC-LSN-QST-009
     * Objective: Update merge fields rồi save
     */
    it('TC-LSN-QST-009 - should merge fields and save', async () => {
      const existing = { id: 1, isActive: true, data: { a: 1 } };
      questionRepository.findOne!.mockResolvedValue(existing);
      questionRepository.save!.mockImplementation(async (q) => q);

      const result = await service.update(1, { data: { a: 2 } } as any);

      // findOne được gọi với includeInactive=true (no isActive filter)
      expect(questionRepository.findOne).toHaveBeenCalledWith({
        where: { id: 1 },
      });
      expect(questionRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 1, data: { a: 2 } }),
      );
      expect(result.data).toEqual({ a: 2 });
    });
  });

  describe('remove (soft delete)', () => {
    /**
     * TC-LSN-QST-010
     * Objective: Soft delete = set isActive=false rồi save
     */
    it('TC-LSN-QST-010 - should set isActive=false and save', async () => {
      const existing = { id: 1, isActive: true };
      questionRepository.findOne!.mockResolvedValue(existing);
      questionRepository.save!.mockResolvedValue({ ...existing, isActive: false });

      await service.remove(1);
      expect(questionRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 1, isActive: false }),
      );
    });
  });

  describe('hardDelete', () => {
    /**
     * TC-LSN-QST-011
     * Objective: Xóa cứng thành công khi affected > 0
     */
    it('TC-LSN-QST-011 - should hard delete successfully', async () => {
      questionRepository.delete!.mockResolvedValue({ affected: 1 });
      await service.hardDelete(1);
      expect(questionRepository.delete).toHaveBeenCalledWith(1);
    });

    /**
     * TC-LSN-QST-012
     * Objective: Throw NotFound khi affected=0
     */
    it('TC-LSN-QST-012 - should throw NotFound when nothing deleted', async () => {
      questionRepository.delete!.mockResolvedValue({ affected: 0 });
      await expect(service.hardDelete(99)).rejects.toThrow(NotFoundException);
    });
  });

  describe('restore', () => {
    /**
     * TC-LSN-QST-013
     * Objective: Restore = set isActive=true rồi save
     */
    it('TC-LSN-QST-013 - should restore inactive question', async () => {
      const existing = { id: 1, isActive: false };
      questionRepository.findOne!.mockResolvedValue(existing);
      questionRepository.save!.mockImplementation(async (q) => q);

      const result = await service.restore(1);

      expect(questionRepository.findOne).toHaveBeenCalledWith({
        where: { id: 1 },
      });
      expect(result.isActive).toBe(true);
    });

    /**
     * TC-LSN-QST-014
     * Objective: Throw NotFound khi không tồn tại
     */
    it('TC-LSN-QST-014 - should throw NotFound when restoring missing question', async () => {
      questionRepository.findOne!.mockResolvedValue(null);
      await expect(service.restore(99)).rejects.toThrow(NotFoundException);
    });
  });
});
