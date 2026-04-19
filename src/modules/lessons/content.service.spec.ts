/**
 * Unit tests for ContentService.
 *
 * Strategy: mock-only.
 * CheckDB: assert repo methods (find/findOne/save/delete) được gọi đúng.
 * Rollback: jest.clearAllMocks() trong afterEach (no real DB).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { ContentService } from './content.service';
import { Content } from './entities/content.entity';
import { OrderIndexService } from './order-index.service';
import {
  createMockRepository,
  MockRepository,
} from '../../test/helpers/mock-repository';

describe('ContentService', () => {
  let service: ContentService;
  let contentRepository: MockRepository;
  let orderIndexService: { getNextOrderIndex: jest.Mock };

  beforeEach(async () => {
    contentRepository = createMockRepository();
    orderIndexService = { getNextOrderIndex: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContentService,
        { provide: getRepositoryToken(Content), useValue: contentRepository },
        { provide: OrderIndexService, useValue: orderIndexService },
      ],
    }).compile();

    service = module.get<ContentService>(ContentService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    /**
     * TC-LSN-CNT-001
     * Objective: Tự sinh orderIndex khi DTO không có
     */
    it('TC-LSN-CNT-001 - should auto-generate orderIndex when not provided', async () => {
      const dto: any = { lessonId: 5, type: 'text', data: {} };
      orderIndexService.getNextOrderIndex.mockResolvedValue(3);
      contentRepository.create!.mockReturnValue({ ...dto, orderIndex: 3 });
      contentRepository.save!.mockResolvedValue({ id: 1, ...dto, orderIndex: 3 });

      await service.create(dto);

      expect(orderIndexService.getNextOrderIndex).toHaveBeenCalledWith(5);
      expect(contentRepository.create).toHaveBeenCalledWith({
        ...dto,
        orderIndex: 3,
      });
      expect(contentRepository.save).toHaveBeenCalled();
    });

    /**
     * TC-LSN-CNT-002
     * Objective: Giữ nguyên orderIndex nếu DTO có
     */
    it('TC-LSN-CNT-002 - should keep provided orderIndex', async () => {
      const dto: any = { lessonId: 5, orderIndex: 7, type: 'text' };
      contentRepository.create!.mockReturnValue(dto);
      contentRepository.save!.mockResolvedValue({ id: 1, ...dto });

      await service.create(dto);
      expect(orderIndexService.getNextOrderIndex).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    /**
     * TC-LSN-CNT-003
     * Objective: Lấy content active sort theo orderIndex ASC
     */
    it('TC-LSN-CNT-003 - should fetch only active contents', async () => {
      contentRepository.find!.mockResolvedValue([{ id: 1 }]);
      const result = await service.findAll();
      expect(contentRepository.find).toHaveBeenCalledWith({
        where: { isActive: true },
        order: { orderIndex: 'ASC' },
      });
      expect(result).toHaveLength(1);
    });
  });

  describe('findByLessonId', () => {
    /**
     * TC-LSN-CNT-004
     * Objective: Filter theo lessonId + active
     */
    it('TC-LSN-CNT-004 - should fetch active contents by lessonId', async () => {
      contentRepository.find!.mockResolvedValue([]);
      await service.findByLessonId(7);
      expect(contentRepository.find).toHaveBeenCalledWith({
        where: { lessonId: 7, isActive: true },
        order: { orderIndex: 'ASC' },
      });
    });
  });

  describe('findOne', () => {
    /**
     * TC-LSN-CNT-005
     * Objective: Trả về content khi tồn tại (active)
     */
    it('TC-LSN-CNT-005 - should return active content when found', async () => {
      const c = { id: 1, isActive: true };
      contentRepository.findOne!.mockResolvedValue(c);
      const result = await service.findOne(1);
      expect(contentRepository.findOne).toHaveBeenCalledWith({
        where: { id: 1, isActive: true },
      });
      expect(result).toEqual(c);
    });

    /**
     * TC-LSN-CNT-006
     * Objective: includeInactive=true thì không filter
     */
    it('TC-LSN-CNT-006 - should not filter isActive when includeInactive=true', async () => {
      contentRepository.findOne!.mockResolvedValue({ id: 1 });
      await service.findOne(1, true);
      expect(contentRepository.findOne).toHaveBeenCalledWith({
        where: { id: 1 },
      });
    });

    /**
     * TC-LSN-CNT-007
     * Objective: Throw NotFoundException khi không tìm thấy
     */
    it('TC-LSN-CNT-007 - should throw NotFoundException when not found', async () => {
      contentRepository.findOne!.mockResolvedValue(null);
      await expect(service.findOne(99)).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    /**
     * TC-LSN-CNT-008
     * Objective: Merge fields rồi save (cho phép cập nhật cả inactive)
     */
    it('TC-LSN-CNT-008 - should merge and save', async () => {
      const existing = { id: 1, isActive: true, data: { x: 1 } };
      contentRepository.findOne!.mockResolvedValue(existing);
      contentRepository.save!.mockImplementation(async (c) => c);

      const result = await service.update(1, { data: { x: 2 } } as any);
      expect(contentRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 1, data: { x: 2 } }),
      );
      expect(result.data).toEqual({ x: 2 });
    });
  });

  describe('remove (soft delete)', () => {
    /**
     * TC-LSN-CNT-009
     * Objective: Soft delete = set isActive=false
     */
    it('TC-LSN-CNT-009 - should soft delete by setting isActive=false', async () => {
      const existing = { id: 1, isActive: true };
      contentRepository.findOne!.mockResolvedValue(existing);
      contentRepository.save!.mockResolvedValue({ ...existing, isActive: false });
      await service.remove(1);
      expect(contentRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ isActive: false }),
      );
    });
  });

  describe('hardDelete', () => {
    /**
     * TC-LSN-CNT-010
     * Objective: Xóa cứng thành công
     */
    it('TC-LSN-CNT-010 - should delete when affected > 0', async () => {
      contentRepository.delete!.mockResolvedValue({ affected: 1 });
      await service.hardDelete(1);
      expect(contentRepository.delete).toHaveBeenCalledWith(1);
    });

    /**
     * TC-LSN-CNT-011
     * Objective: Throw NotFound khi affected=0
     */
    it('TC-LSN-CNT-011 - should throw NotFound when nothing deleted', async () => {
      contentRepository.delete!.mockResolvedValue({ affected: 0 });
      await expect(service.hardDelete(99)).rejects.toThrow(NotFoundException);
    });
  });

  describe('restore', () => {
    /**
     * TC-LSN-CNT-012
     * Objective: Đặt isActive=true rồi save
     */
    it('TC-LSN-CNT-012 - should restore inactive content', async () => {
      contentRepository.findOne!.mockResolvedValue({ id: 1, isActive: false });
      contentRepository.save!.mockImplementation(async (c) => c);
      const result = await service.restore(1);
      expect(result.isActive).toBe(true);
    });

    /**
     * TC-LSN-CNT-013
     * Objective: Throw NotFound khi không có content
     */
    it('TC-LSN-CNT-013 - should throw NotFound when restoring missing content', async () => {
      contentRepository.findOne!.mockResolvedValue(null);
      await expect(service.restore(99)).rejects.toThrow(NotFoundException);
    });
  });
});
