/**
 * Unit tests for CoursesService.
 *
 * Strategy: mock-only.
 * CheckDB: assert repo & queryBuilder calls với tham số đúng.
 * Rollback: jest.clearAllMocks() trong afterEach.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CoursesService } from './courses.service';
import { Courses } from './entities/course.entities';
import { HskLevel } from './enums/hsk-level.enum';
import {
  createMockRepository,
  MockRepository,
} from '../../test/helpers/mock-repository';

describe('CoursesService', () => {
  let service: CoursesService;
  let coursesRepository: MockRepository;

  beforeEach(async () => {
    coursesRepository = createMockRepository();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CoursesService,
        { provide: getRepositoryToken(Courses), useValue: coursesRepository },
      ],
    }).compile();

    service = module.get<CoursesService>(CoursesService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    /**
     * TC-CRS-001
     * Objective: Tạo course mới với prerequisite hợp lệ + auto orderIndex
     */
    it('TC-CRS-001 - should create with valid prerequisite and auto orderIndex', async () => {
      const dto: any = { name: 'C1', prerequisiteCourseId: 1 };
      // findById -> tồn tại
      coursesRepository.findOne!
        .mockResolvedValueOnce({ id: 1, isActive: true }); // prerequisite check
      // queryBuilder MAX
      coursesRepository.__queryBuilder.getRawOne.mockResolvedValue({
        maxOrder: 4,
      });
      coursesRepository.create!.mockReturnValue({ ...dto, orderIndex: 5 });
      coursesRepository.save!.mockResolvedValue({ id: 10, ...dto, orderIndex: 5 });

      const result = await service.create(dto);

      expect(coursesRepository.save).toHaveBeenCalled();
      expect(result.orderIndex).toBe(5);
    });

    /**
     * TC-CRS-002
     * Objective: Throw BadRequest khi prerequisite không tồn tại
     */
    it('TC-CRS-002 - should throw BadRequest when prerequisite not found', async () => {
      coursesRepository.findOne!.mockResolvedValueOnce(null);
      await expect(
        service.create({ prerequisiteCourseId: 99 } as any),
      ).rejects.toThrow(BadRequestException);
    });

    /**
     * TC-CRS-003
     * Objective: Throw BadRequest khi orderIndex đã tồn tại
     */
    it('TC-CRS-003 - should throw BadRequest when orderIndex conflicts', async () => {
      const dto: any = { orderIndex: 3 };
      coursesRepository.findOne!.mockResolvedValueOnce({ id: 99 }); // existing with same orderIndex
      await expect(service.create(dto)).rejects.toThrow(BadRequestException);
      expect(coursesRepository.findOne).toHaveBeenCalledWith({
        where: { orderIndex: 3 },
      });
    });

    /**
     * TC-CRS-004
     * Objective: orderIndex=1 khi DB rỗng (maxOrder=null) và không có prereq
     */
    it('TC-CRS-004 - should default orderIndex to 1 when DB empty', async () => {
      const dto: any = { name: 'first' };
      coursesRepository.__queryBuilder.getRawOne.mockResolvedValue({
        maxOrder: null,
      });
      coursesRepository.create!.mockImplementation((d) => d);
      coursesRepository.save!.mockImplementation(async (d) => d);

      const result = await service.create(dto);
      expect(result.orderIndex).toBe(1);
    });
  });

  describe('findAll', () => {
    /**
     * TC-CRS-005
     * Objective: Áp dụng đầy đủ filter hskLevel + isActive + prerequisiteCourseId
     */
    it('TC-CRS-005 - should apply all filters', async () => {
      const qb = coursesRepository.__queryBuilder;
      qb.getManyAndCount.mockResolvedValue([[{ id: 1 }], 1]);

      const result = await service.findAll({
        page: 2,
        limit: 5,
        hskLevel: HskLevel.HSK1,
        isActive: true,
        prerequisiteCourseId: 3,
      } as any);

      expect(qb.andWhere).toHaveBeenCalledWith('course.hskLevel = :hskLevel', {
        hskLevel: HskLevel.HSK1,
      });
      expect(qb.andWhere).toHaveBeenCalledWith('course.isActive = :isActive', {
        isActive: true,
      });
      expect(qb.skip).toHaveBeenCalledWith(5); // (2-1)*5
      expect(qb.take).toHaveBeenCalledWith(5);
      expect(result.total).toBe(1);
    });

    /**
     * TC-CRS-006
     * Objective: Default page=1, limit=10 khi query rỗng
     */
    it('TC-CRS-006 - should use default pagination when query empty', async () => {
      const qb = coursesRepository.__queryBuilder;
      qb.getManyAndCount.mockResolvedValue([[], 0]);
      await service.findAll({} as any);
      expect(qb.skip).toHaveBeenCalledWith(0);
      expect(qb.take).toHaveBeenCalledWith(10);
    });
  });

  describe('findById', () => {
    /**
     * TC-CRS-007
     * Objective: Lấy course kèm prerequisite relation
     */
    it('TC-CRS-007 - should load with prerequisite relation', async () => {
      coursesRepository.findOne!.mockResolvedValue({ id: 1 });
      await service.findById(1);
      expect(coursesRepository.findOne).toHaveBeenCalledWith({
        where: { id: 1 },
        relations: ['prerequisiteCourse'],
      });
    });
  });

  describe('update', () => {
    /**
     * TC-CRS-008
     * Objective: Update thành công khi không đổi prereq/orderIndex
     */
    it('TC-CRS-008 - should update successfully', async () => {
      coursesRepository.findOne!.mockResolvedValue({ id: 1, title: 'old' });
      coursesRepository.save!.mockImplementation(async (c) => c);

      const result = await service.update(1, { title: 'new' } as any);
      expect(result.title).toBe('new');
    });

    /**
     * TC-CRS-009
     * Objective: Throw NotFound khi course không tồn tại
     */
    it('TC-CRS-009 - should throw NotFound when course missing', async () => {
      coursesRepository.findOne!.mockResolvedValue(null);
      await expect(service.update(99, {} as any)).rejects.toThrow(
        NotFoundException,
      );
    });

    /**
     * TC-CRS-010
     * Objective: Throw BadRequest khi prereq trỏ về chính mình
     */
    it('TC-CRS-010 - should throw BadRequest when prereq is self', async () => {
      coursesRepository.findOne!.mockResolvedValue({
        id: 1,
        prerequisiteCourseId: null,
      });
      await expect(
        service.update(1, { prerequisiteCourseId: 1 } as any),
      ).rejects.toThrow(BadRequestException);
    });

    /**
     * TC-CRS-011
     * Objective: Throw BadRequest khi prereq mới không tồn tại
     */
    it('TC-CRS-011 - should throw BadRequest when new prereq not found', async () => {
      coursesRepository.findOne!
        .mockResolvedValueOnce({ id: 1, prerequisiteCourseId: null }) // findById(1)
        .mockResolvedValueOnce(null); // findById(prereq)
      await expect(
        service.update(1, { prerequisiteCourseId: 99 } as any),
      ).rejects.toThrow(BadRequestException);
    });

    /**
     * TC-CRS-012
     * Objective: Throw BadRequest khi orderIndex mới đụng course khác
     */
    it('TC-CRS-012 - should throw BadRequest on orderIndex conflict', async () => {
      coursesRepository.findOne!
        .mockResolvedValueOnce({ id: 1, orderIndex: 1 }) // findById
        .mockResolvedValueOnce({ id: 5, orderIndex: 3 }); // existing
      await expect(
        service.update(1, { orderIndex: 3 } as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('delete (soft)', () => {
    /**
     * TC-CRS-013
     * Objective: Soft delete thành công khi không có dependent
     */
    it('TC-CRS-013 - should soft delete when no dependents', async () => {
      coursesRepository.findOne!.mockResolvedValue({ id: 1, isActive: true });
      coursesRepository.find!.mockResolvedValue([]); // no dependents
      coursesRepository.save!.mockImplementation(async (c) => c);

      await service.delete(1);
      expect(coursesRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ isActive: false }),
      );
    });

    /**
     * TC-CRS-014
     * Objective: Throw NotFound khi course không tồn tại
     */
    it('TC-CRS-014 - should throw NotFound when course missing', async () => {
      coursesRepository.findOne!.mockResolvedValue(null);
      await expect(service.delete(99)).rejects.toThrow(NotFoundException);
    });

    /**
     * TC-CRS-015
     * Objective: Throw BadRequest khi có dependent course
     */
    it('TC-CRS-015 - should throw BadRequest when has dependents', async () => {
      coursesRepository.findOne!.mockResolvedValue({ id: 1 });
      coursesRepository.find!.mockResolvedValue([{ id: 2 }]);
      await expect(service.delete(1)).rejects.toThrow(BadRequestException);
    });
  });

  describe('hardDelete', () => {
    /**
     * TC-CRS-016
     * Objective: Hard delete thành công
     */
    it('TC-CRS-016 - should hard delete when no dependents', async () => {
      coursesRepository.findOne!.mockResolvedValue({ id: 1 });
      coursesRepository.find!.mockResolvedValue([]);
      coursesRepository.delete!.mockResolvedValue({ affected: 1 });
      await service.hardDelete(1);
      expect(coursesRepository.delete).toHaveBeenCalledWith(1);
    });

    /**
     * TC-CRS-017
     * Objective: Throw NotFound khi course missing
     */
    it('TC-CRS-017 - should throw NotFound when course missing', async () => {
      coursesRepository.findOne!.mockResolvedValue(null);
      await expect(service.hardDelete(99)).rejects.toThrow(NotFoundException);
    });

    /**
     * TC-CRS-018
     * Objective: Throw BadRequest khi có dependent
     */
    it('TC-CRS-018 - should throw BadRequest when has dependents', async () => {
      coursesRepository.findOne!.mockResolvedValue({ id: 1 });
      coursesRepository.find!.mockResolvedValue([{ id: 2 }]);
      await expect(service.hardDelete(1)).rejects.toThrow(BadRequestException);
    });

    /**
     * TC-CRS-019
     * Objective: Throw NotFound khi delete affected=0
     */
    it('TC-CRS-019 - should throw NotFound when delete affected=0', async () => {
      coursesRepository.findOne!.mockResolvedValue({ id: 1 });
      coursesRepository.find!.mockResolvedValue([]);
      coursesRepository.delete!.mockResolvedValue({ affected: 0 });
      await expect(service.hardDelete(1)).rejects.toThrow(NotFoundException);
    });
  });

  describe('restore', () => {
    /**
     * TC-CRS-020
     * Objective: Restore success
     */
    it('TC-CRS-020 - should restore', async () => {
      coursesRepository.findOne!.mockResolvedValue({ id: 1, isActive: false });
      coursesRepository.save!.mockImplementation(async (c) => c);
      const result = await service.restore(1);
      expect(result.isActive).toBe(true);
    });

    /**
     * TC-CRS-021
     * Objective: Throw NotFound when missing
     */
    it('TC-CRS-021 - should throw NotFound when missing', async () => {
      coursesRepository.findOne!.mockResolvedValue(null);
      await expect(service.restore(99)).rejects.toThrow(NotFoundException);
    });
  });

  describe('findByHskLevel', () => {
    /**
     * TC-CRS-022
     * Objective: Lấy course theo HSK level + active
     */
    it('TC-CRS-022 - should query by HSK level and active', async () => {
      coursesRepository.find!.mockResolvedValue([]);
      await service.findByHskLevel(HskLevel.HSK2);
      expect(coursesRepository.find).toHaveBeenCalledWith({
        where: { hskLevel: HskLevel.HSK2, isActive: true },
        relations: ['prerequisiteCourse'],
        order: { orderIndex: 'ASC' },
      });
    });
  });

  describe('getCourseStats', () => {
    /**
     * TC-CRS-023
     * Objective: Tổng hợp stats: count tổng/active/inactive + theo level
     */
    it('TC-CRS-023 - should aggregate course statistics', async () => {
      coursesRepository.count!
        .mockResolvedValueOnce(10) // total
        .mockResolvedValueOnce(7) // active
        .mockResolvedValueOnce(3); // inactive
      coursesRepository.__queryBuilder.getRawMany.mockResolvedValue([
        { level: HskLevel.HSK1, count: '4' },
        { level: HskLevel.HSK2, count: '3' },
      ]);

      const stats = await service.getCourseStats();
      expect(stats.totalCourses).toBe(10);
      expect(stats.activeCourses).toBe(7);
      expect(stats.inactiveCourses).toBe(3);
      expect(stats.coursesByLevel[HskLevel.HSK1]).toBe(4);
      expect(stats.coursesByLevel[HskLevel.HSK2]).toBe(3);
    });
  });
});
