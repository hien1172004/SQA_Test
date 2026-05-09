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
     * [TC-CRS-001] Khởi tạo khóa học mới với điều kiện tiên quyết hợp lệ.
     * Mục tiêu: Xác nhận hệ thống gán đúng orderIndex tự động và kiểm tra sự tồn tại của khóa học tiên quyết.
     */
    it('TC-CRS-001 - should create with valid prerequisite and auto orderIndex', async () => {
      // --- ARRANGE ---
      // Input: Khóa học C1 yêu cầu hoàn thành khóa học ID=1 trước.
      const dto: any = { name: 'C1', prerequisiteCourseId: 1 };
      
      // Giả lập khóa học tiên quyết (prerequisiteCourseId: 1) đang hoạt động.
      coursesRepository.findOne!
        .mockResolvedValueOnce({ id: 1, isActive: true });
        
      // Giả lập giá trị MAX(orderIndex) hiện tại là 4.
      coursesRepository.__queryBuilder.getRawOne.mockResolvedValue({
        maxOrder: 4,
      });
      
      // Service sẽ gán orderIndex = 4 + 1 = 5.
      coursesRepository.create!.mockReturnValue({ ...dto, orderIndex: 5 });
      coursesRepository.save!.mockResolvedValue({ id: 10, ...dto, orderIndex: 5 });

      // --- ACT ---
      const result = await service.create(dto);

      // --- ASSERT ---
      // [CheckDB] Xác nhận repository.save được gọi để lưu khóa học mới.
      expect(coursesRepository.save).toHaveBeenCalled();
      expect(result.orderIndex).toBe(5);
    });

    /**
     * [TC-CRS-002] Lỗi khi khóa học tiên quyết không tồn tại.
     * Mục tiêu: Đảm bảo tính toàn vẹn dữ liệu, không cho phép gán khóa học tiên quyết ảo.
     */
    it('TC-CRS-002 - should throw BadRequest when prerequisite not found', async () => {
      // --- ARRANGE ---
      // Giả lập DB không tìm thấy khóa học ID=99.
      coursesRepository.findOne!.mockResolvedValueOnce(null);

      // --- ACT & ASSERT ---
      await expect(
        service.create({ prerequisiteCourseId: 99 } as any),
      ).rejects.toThrow(BadRequestException);
    });

    /**
     * [TC-CRS-003] Lỗi xung đột số thứ tự hiển thị (orderIndex).
     * Mục tiêu: Ngăn chặn việc tạo khóa học có orderIndex trùng với khóa học đã có.
     */
    it('TC-CRS-003 - should throw BadRequest when orderIndex conflicts', async () => {
      // --- ARRANGE ---
      const dto: any = { orderIndex: 3 };
      // Giả lập tìm thấy một khóa học khác (ID 99) đã sử dụng orderIndex 3.
      coursesRepository.findOne!.mockResolvedValueOnce({ id: 99 });

      // --- ACT & ASSERT ---
      await expect(service.create(dto)).rejects.toThrow(BadRequestException);
      // [CheckDB] Xác nhận service đã truy vấn kiểm tra orderIndex trước khi tạo.
      expect(coursesRepository.findOne).toHaveBeenCalledWith({
        where: { orderIndex: 3 },
      });
    });

    /**
     * [TC-CRS-004] Gán số thứ tự mặc định là 1 khi cơ sở dữ liệu trống.
     */
    it('TC-CRS-004 - should default orderIndex to 1 when DB empty', async () => {
      // --- ARRANGE ---
      const dto: any = { name: 'first' };
      // Giả lập SELECT MAX(orderIndex) trả về null.
      coursesRepository.__queryBuilder.getRawOne.mockResolvedValue({
        maxOrder: null,
      });
      coursesRepository.create!.mockImplementation((d) => d);
      coursesRepository.save!.mockImplementation(async (d) => d);

      // --- ACT ---
      const result = await service.create(dto);

      // --- ASSERT ---
      expect(result.orderIndex).toBe(1);
    });
  });

  describe('findAll', () => {
    /**
     * [TC-CRS-005] Tìm kiếm khóa học với bộ lọc đa điều kiện.
     * Mục tiêu: Đảm bảo các filter HSK Level, Trạng thái và Khóa học tiên quyết được áp dụng đồng thời.
     */
    it('TC-CRS-005 - should apply all filters', async () => {
      // --- ARRANGE ---
      const qb = coursesRepository.__queryBuilder;
      qb.getManyAndCount.mockResolvedValue([[{ id: 1 }], 1]);

      // --- ACT ---
      // Trang 2, limit 5 -> skip = (2-1)*5 = 5.
      const result = await service.findAll({
        page: 2,
        limit: 5,
        hskLevel: HskLevel.HSK1,
        isActive: true,
        prerequisiteCourseId: 3,
      } as any);

      // --- ASSERT ---
      // [CheckDB] Xác nhận QueryBuilder áp dụng đúng các tham số lọc.
      expect(qb.andWhere).toHaveBeenCalledWith('course.hskLevel = :hskLevel', {
        hskLevel: HskLevel.HSK1,
      });
      expect(qb.andWhere).toHaveBeenCalledWith('course.isActive = :isActive', {
        isActive: true,
      });
      expect(qb.skip).toHaveBeenCalledWith(5);
      expect(qb.take).toHaveBeenCalledWith(5);
      expect(result.total).toBe(1);
    });

    /**
     * [TC-CRS-006] Phân trang mặc định khi không truyền tham số.
     */
    it('TC-CRS-006 - should use default pagination when query empty', async () => {
      // --- ARRANGE ---
      const qb = coursesRepository.__queryBuilder;
      qb.getManyAndCount.mockResolvedValue([[], 0]);

      // --- ACT ---
      await service.findAll({} as any);

      // --- ASSERT ---
      // [CheckDB] Mặc định skip=0 (trang 1) và take=10.
      expect(qb.skip).toHaveBeenCalledWith(0);
      expect(qb.take).toHaveBeenCalledWith(10);
    });
  });

  describe('findById', () => {
    /**
     * [TC-CRS-007] Truy xuất chi tiết khóa học kèm thông tin liên quan.
     */
    it('TC-CRS-007 - should load with prerequisite relation', async () => {
      // --- ARRANGE ---
      coursesRepository.findOne!.mockResolvedValue({ id: 1 });

      // --- ACT ---
      await service.findById(1);

      // --- ASSERT ---
      // [CheckDB] Xác nhận repository thực hiện JOIN với bảng prerequisiteCourse.
      expect(coursesRepository.findOne).toHaveBeenCalledWith({
        where: { id: 1 },
        relations: ['prerequisiteCourse'],
      });
    });
  });

  describe('update', () => {
    /**
     * [TC-CRS-008] Cập nhật thông tin khóa học thành công.
     */
    it('TC-CRS-008 - should update successfully', async () => {
      // --- ARRANGE ---
      coursesRepository.findOne!.mockResolvedValue({ id: 1, title: 'old' });
      coursesRepository.save!.mockImplementation(async (c) => c);

      // --- ACT ---
      const result = await service.update(1, { title: 'new' } as any);

      // --- ASSERT ---
      // [CheckDB] Xác nhận dữ liệu mới đã được lưu trữ.
      expect(result.title).toBe('new');
    });

    /**
     * [TC-CRS-009] Lỗi khi cập nhật khóa học không tồn tại.
     */
    it('TC-CRS-009 - should throw NotFound when course missing', async () => {
      // --- ARRANGE ---
      coursesRepository.findOne!.mockResolvedValue(null);

      // --- ACT & ASSERT ---
      await expect(service.update(99, {} as any)).rejects.toThrow(
        NotFoundException,
      );
    });

    /**
     * [TC-CRS-010] Lỗi khi gán chính khóa học làm điều kiện tiên quyết của chính nó.
     * Mục tiêu: Ngăn chặn lỗi vòng lặp logic (Circular Dependency).
     */
    it('TC-CRS-010 - should throw BadRequest when prereq is self', async () => {
      // --- ARRANGE ---
      coursesRepository.findOne!.mockResolvedValue({
        id: 1,
        prerequisiteCourseId: null,
      });

      // --- ACT & ASSERT ---
      await expect(
        service.update(1, { prerequisiteCourseId: 1 } as any),
      ).rejects.toThrow(BadRequestException);
    });

    /**
     * [TC-CRS-011] Lỗi khi cập nhật điều kiện tiên quyết sang một khóa học ảo.
     */
    it('TC-CRS-011 - should throw BadRequest when new prereq not found', async () => {
      // --- ARRANGE ---
      coursesRepository.findOne!
        .mockResolvedValueOnce({ id: 1, prerequisiteCourseId: null }) // Lần 1: tìm khóa học hiện tại
        .mockResolvedValueOnce(null); // Lần 2: không tìm thấy khóa học tiên quyết mới

      // --- ACT & ASSERT ---
      await expect(
        service.update(1, { prerequisiteCourseId: 99 } as any),
      ).rejects.toThrow(BadRequestException);
    });

    /**
     * [TC-CRS-012] Lỗi xung đột số thứ tự khi cập nhật.
     */
    it('TC-CRS-012 - should throw BadRequest on orderIndex conflict', async () => {
      // --- ARRANGE ---
      coursesRepository.findOne!
        .mockResolvedValueOnce({ id: 1, orderIndex: 1 })
        .mockResolvedValueOnce({ id: 5, orderIndex: 3 });

      // --- ACT & ASSERT ---
      await expect(
        service.update(1, { orderIndex: 3 } as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('delete (soft)', () => {
    /**
     * [TC-CRS-013] Xóa mềm khóa học.
     * Mục tiêu: Đảm bảo khóa học chỉ được ẩn đi (isActive=false) khi không có khóa học nào khác đang phụ thuộc vào nó.
     */
    it('TC-CRS-013 - should soft delete when no dependents', async () => {
      // --- ARRANGE ---
      coursesRepository.findOne!.mockResolvedValue({ id: 1, isActive: true });
      // Không có khóa học nào dùng khóa học 1 làm tiên quyết.
      coursesRepository.find!.mockResolvedValue([]);
      coursesRepository.save!.mockImplementation(async (c) => c);

      // --- ACT ---
      await service.delete(1);

      // --- ASSERT ---
      // [CheckDB] Trạng thái được chuyển sang false.
      expect(coursesRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ isActive: false }),
      );
    });

    /**
     * [TC-CRS-014] Lỗi khi xóa khóa học không tồn tại.
     */
    it('TC-CRS-014 - should throw NotFound when course missing', async () => {
      // --- ARRANGE ---
      coursesRepository.findOne!.mockResolvedValue(null);

      // --- ACT & ASSERT ---
      await expect(service.delete(99)).rejects.toThrow(NotFoundException);
    });

    /**
     * [TC-CRS-015] Lỗi khi xóa khóa học đang là điều kiện tiên quyết của khóa học khác.
     * Mục tiêu: Bảo vệ tính liên kết của dữ liệu (Referential Integrity).
     */
    it('TC-CRS-015 - should throw BadRequest when has dependents', async () => {
      // --- ARRANGE ---
      coursesRepository.findOne!.mockResolvedValue({ id: 1 });
      // Tìm thấy khóa học ID=2 đang phụ thuộc vào khóa học 1.
      coursesRepository.find!.mockResolvedValue([{ id: 2 }]);

      // --- ACT & ASSERT ---
      await expect(service.delete(1)).rejects.toThrow(BadRequestException);
    });
  });

  describe('hardDelete', () => {
    /**
     * [TC-CRS-016] Xóa cứng bản ghi khóa học.
     */
    it('TC-CRS-016 - should hard delete when no dependents', async () => {
      // --- ARRANGE ---
      coursesRepository.findOne!.mockResolvedValue({ id: 1 });
      coursesRepository.find!.mockResolvedValue([]);
      coursesRepository.delete!.mockResolvedValue({ affected: 1 });

      // --- ACT ---
      await service.hardDelete(1);

      // --- ASSERT ---
      // [CheckDB] Thực thi lệnh DELETE vật lý trong SQL.
      expect(coursesRepository.delete).toHaveBeenCalledWith(1);
    });

    /**
     * [TC-CRS-017] Lỗi xóa cứng khóa học không tồn tại.
     */
    it('TC-CRS-017 - should throw NotFound when course missing', async () => {
      // --- ARRANGE ---
      coursesRepository.findOne!.mockResolvedValue(null);

      // --- ACT & ASSERT ---
      await expect(service.hardDelete(99)).rejects.toThrow(NotFoundException);
    });

    /**
     * [TC-CRS-018] Lỗi xóa cứng khóa học có ràng buộc.
     */
    it('TC-CRS-018 - should throw BadRequest when has dependents', async () => {
      // --- ARRANGE ---
      coursesRepository.findOne!.mockResolvedValue({ id: 1 });
      coursesRepository.find!.mockResolvedValue([{ id: 2 }]);

      // --- ACT & ASSERT ---
      await expect(service.hardDelete(1)).rejects.toThrow(BadRequestException);
    });

    /**
     * [TC-CRS-019] Lỗi khi lệnh xóa không tác động đến bản ghi nào.
     */
    it('TC-CRS-019 - should throw NotFound when delete affected=0', async () => {
      // --- ARRANGE ---
      coursesRepository.findOne!.mockResolvedValue({ id: 1 });
      coursesRepository.find!.mockResolvedValue([]);
      coursesRepository.delete!.mockResolvedValue({ affected: 0 });

      // --- ACT & ASSERT ---
      await expect(service.hardDelete(1)).rejects.toThrow(NotFoundException);
    });
  });

  describe('restore', () => {
    /**
     * [TC-CRS-020] Khôi phục khóa học đã bị ẩn.
     */
    it('TC-CRS-020 - should restore', async () => {
      // --- ARRANGE ---
      coursesRepository.findOne!.mockResolvedValue({ id: 1, isActive: false });
      coursesRepository.save!.mockImplementation(async (c) => c);

      // --- ACT ---
      const result = await service.restore(1);

      // --- ASSERT ---
      // [CheckDB] Trạng thái được khôi phục thành true.
      expect(result.isActive).toBe(true);
    });
    /**
     * [TC-CRS-021] Lỗi khi khôi phục khóa học không tồn tại.
     */
    it('TC-CRS-021 - should throw NotFound when restore invalid id', async () => {
      // --- ARRANGE ---
      coursesRepository.findOne!.mockResolvedValue(null);

      // --- ACT & ASSERT ---
      await expect(service.restore(999)).rejects.toThrow(NotFoundException);
    });
  });

  describe('findByHskLevel', () => {
    /**
     * [TC-CRS-022] Truy xuất danh sách khóa học theo cấp độ HSK.
     */
    it('TC-CRS-022 - should query by HSK level and active', async () => {
      // --- ARRANGE ---
      coursesRepository.find!.mockResolvedValue([]);

      // --- ACT ---
      await service.findByHskLevel(HskLevel.HSK2);

      // --- ASSERT ---
      // [CheckDB] Lọc theo đúng Level và trạng thái đang hoạt động, sắp xếp theo orderIndex.
      expect(coursesRepository.find).toHaveBeenCalledWith({
        where: { hskLevel: HskLevel.HSK2, isActive: true },
        relations: ['prerequisiteCourse'],
        order: { orderIndex: 'ASC' },
      });
    });
  });

  describe('getCourseStats', () => {
    /**
     * [TC-CRS-023] Tổng hợp số liệu thống kê về các khóa học.
     * Mục tiêu: Xác nhận logic đếm tổng số, số đang hoạt động và phân loại theo từng cấp độ HSK.
     */
    it('TC-CRS-023 - should aggregate course statistics', async () => {
      // --- ARRANGE ---
      // Giả lập các hàm count của TypeORM.
      coursesRepository.count!
        .mockResolvedValueOnce(10) // Tổng
        .mockResolvedValueOnce(7)  // Đang hoạt động
        .mockResolvedValueOnce(3); // Đã bị ẩn
        
      // Giả lập QueryBuilder đếm số lượng khóa học theo từng Level.
      coursesRepository.__queryBuilder.getRawMany.mockResolvedValue([
        { level: HskLevel.HSK1, count: '4' },
        { level: HskLevel.HSK2, count: '3' },
      ]);

      // --- ACT ---
      const stats = await service.getCourseStats();

      // --- ASSERT ---
      expect(stats.totalCourses).toBe(10);
      expect(stats.activeCourses).toBe(7);
      expect(stats.inactiveCourses).toBe(3);
      // Kiểm tra tính toán phân cấp.
      expect(stats.coursesByLevel[HskLevel.HSK1]).toBe(4);
      expect(stats.coursesByLevel[HskLevel.HSK2]).toBe(3);
    });
  });
});
