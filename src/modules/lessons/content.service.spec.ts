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
     * [TC-LSN-CNT-001] Khởi tạo nội dung mới với số thứ tự tự động.
     * Mục tiêu: Đảm bảo khi DTO thiếu orderIndex, hệ thống gọi OrderIndexService để lấy số tiếp theo.
     */
    it('TC-LSN-CNT-001 - should auto-generate orderIndex when not provided', async () => {
      // --- ARRANGE ---
      const dto: any = { lessonId: 5, type: 'text', data: {} };
      // Giả lập OrderIndexService trả về số 3.
      orderIndexService.getNextOrderIndex.mockResolvedValue(3);
      contentRepository.create!.mockReturnValue({ ...dto, orderIndex: 3 });
      contentRepository.save!.mockResolvedValue({ id: 1, ...dto, orderIndex: 3 });

      // --- ACT ---
      await service.create(dto);

      // --- ASSERT ---
      // [CheckDB] Xác nhận service đã yêu cầu cấp số thứ tự mới cho lessonId=5.
      expect(orderIndexService.getNextOrderIndex).toHaveBeenCalledWith(5);
      // [CheckDB] Xác nhận repository lưu trữ đối tượng với orderIndex=3.
      expect(contentRepository.create).toHaveBeenCalledWith({
        ...dto,
        orderIndex: 3,
      });
      expect(contentRepository.save).toHaveBeenCalled();
    });

    /**
     * [TC-LSN-CNT-002] Khởi tạo nội dung với số thứ tự được chỉ định.
     * Mục tiêu: Nếu DTO đã có orderIndex, hệ thống không được gọi OrderIndexService để tránh ghi đè.
     */
    it('TC-LSN-CNT-002 - should keep provided orderIndex', async () => {
      // --- ARRANGE ---
      const dto: any = { lessonId: 5, orderIndex: 7, type: 'text' };
      contentRepository.create!.mockReturnValue(dto);
      contentRepository.save!.mockResolvedValue({ id: 1, ...dto });

      // --- ACT ---
      await service.create(dto);

      // --- ASSERT ---
      // [CheckDB] Xác nhận OrderIndexService KHÔNG được gọi.
      expect(orderIndexService.getNextOrderIndex).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    /**
     * [TC-LSN-CNT-003] Lấy danh sách nội dung đang hoạt động.
     * Mục tiêu: Đảm bảo dữ liệu trả về chỉ gồm các bản ghi Active và được sắp xếp đúng thứ tự hiển thị.
     */
    it('TC-LSN-CNT-003 - should fetch only active contents', async () => {
      // --- ARRANGE ---
      contentRepository.find!.mockResolvedValue([{ id: 1 }]);

      // --- ACT ---
      const result = await service.findAll();

      // --- ASSERT ---
      // [CheckDB] Xác nhận filter isActive=true và sắp xếp ASC theo orderIndex.
      expect(contentRepository.find).toHaveBeenCalledWith({
        where: { isActive: true },
        order: { orderIndex: 'ASC' },
      });
      expect(result).toHaveLength(1);
    });
  });

  describe('findByLessonId', () => {
    /**
     * [TC-LSN-CNT-004] Truy xuất nội dung theo mã bài học.
     */
    it('TC-LSN-CNT-004 - should fetch active contents by lessonId', async () => {
      // --- ARRANGE ---
      contentRepository.find!.mockResolvedValue([]);

      // --- ACT ---
      await service.findByLessonId(7);

      // --- ASSERT ---
      // [CheckDB] Xác nhận lọc đúng lessonId=7.
      expect(contentRepository.find).toHaveBeenCalledWith({
        where: { lessonId: 7, isActive: true },
        order: { orderIndex: 'ASC' },
      });
    });
  });

  describe('findOne', () => {
    /**
     * [TC-LSN-CNT-005] Lấy chi tiết một nội dung đang hoạt động.
     */
    it('TC-LSN-CNT-005 - should return active content when found', async () => {
      // --- ARRANGE ---
      const c = { id: 1, isActive: true };
      contentRepository.findOne!.mockResolvedValue(c);

      // --- ACT ---
      const result = await service.findOne(1);

      // --- ASSERT ---
      // [CheckDB] Xác nhận tìm kiếm theo ID kèm điều kiện Active.
      expect(contentRepository.findOne).toHaveBeenCalledWith({
        where: { id: 1, isActive: true },
      });
      expect(result).toEqual(c);
    });

    /**
     * [TC-LSN-CNT-006] Lấy chi tiết nội dung (bao gồm cả trạng thái Inactive).
     */
    it('TC-LSN-CNT-006 - should not filter isActive when includeInactive=true', async () => {
      // --- ARRANGE ---
      contentRepository.findOne!.mockResolvedValue({ id: 1 });

      // --- ACT ---
      await service.findOne(1, true);

      // --- ASSERT ---
      // [CheckDB] Xác nhận không có điều kiện isActive trong query SQL.
      expect(contentRepository.findOne).toHaveBeenCalledWith({
        where: { id: 1 },
      });
    });

    /**
     * [TC-LSN-CNT-007] Lỗi khi không tìm thấy nội dung bài học.
     */
    it('TC-LSN-CNT-007 - should throw NotFoundException when not found', async () => {
      // --- ARRANGE ---
      contentRepository.findOne!.mockResolvedValue(null);

      // --- ACT & ASSERT ---
      await expect(service.findOne(99)).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    /**
     * [TC-LSN-CNT-008] Cập nhật thông tin nội dung bài học.
     * Mục tiêu: Xác nhận hệ thống gộp dữ liệu mới vào thực thể hiện tại và thực hiện lưu trữ.
     */
    it('TC-LSN-CNT-008 - should merge and save', async () => {
      // --- ARRANGE ---
      const existing = { id: 1, isActive: true, data: { x: 1 } };
      contentRepository.findOne!.mockResolvedValue(existing);
      contentRepository.save!.mockImplementation(async (c) => c);

      // --- ACT ---
      const result = await service.update(1, { data: { x: 2 } } as any);

      // --- ASSERT ---
      // [CheckDB] Xác nhận repository.save được gọi với dữ liệu đã gộp (x: 2).
      expect(contentRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 1, data: { x: 2 } }),
      );
      expect(result.data).toEqual({ x: 2 });
    });
  });

  describe('remove (soft delete)', () => {
    /**
     * [TC-LSN-CNT-009] Xóa mềm nội dung.
     * Mục tiêu: Thay đổi trạng thái isActive về false để ẩn nội dung khỏi giao diện người dùng.
     */
    it('TC-LSN-CNT-009 - should soft delete by setting isActive=false', async () => {
      // --- ARRANGE ---
      const existing = { id: 1, isActive: true };
      contentRepository.findOne!.mockResolvedValue(existing);
      contentRepository.save!.mockResolvedValue({ ...existing, isActive: false });

      // --- ACT ---
      await service.remove(1);

      // --- ASSERT ---
      // [CheckDB] Xác nhận thực thể được lưu với trạng thái isActive = false.
      expect(contentRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ isActive: false }),
      );
    });
  });

  describe('hardDelete', () => {
    /**
     * [TC-LSN-CNT-010] Xóa cứng bản ghi khỏi cơ sở dữ liệu.
     */
    it('TC-LSN-CNT-010 - should delete when affected > 0', async () => {
      // --- ARRANGE ---
      contentRepository.delete!.mockResolvedValue({ affected: 1 });

      // --- ACT ---
      await service.hardDelete(1);

      // --- ASSERT ---
      // [CheckDB] Xác nhận repository.delete thực thi lệnh xóa vật lý.
      expect(contentRepository.delete).toHaveBeenCalledWith(1);
    });

    /**
     * [TC-LSN-CNT-011] Lỗi khi xóa bản ghi không tồn tại.
     */
    it('TC-LSN-CNT-011 - should throw NotFound when nothing deleted', async () => {
      // --- ARRANGE ---
      contentRepository.delete!.mockResolvedValue({ affected: 0 });

      // --- ACT & ASSERT ---
      await expect(service.hardDelete(99)).rejects.toThrow(NotFoundException);
    });
  });

  describe('restore', () => {
    /**
     * [TC-LSN-CNT-012] Khôi phục nội dung đã xóa mềm.
     */
    it('TC-LSN-CNT-012 - should restore inactive content', async () => {
      // --- ARRANGE ---
      contentRepository.findOne!.mockResolvedValue({ id: 1, isActive: false });
      contentRepository.save!.mockImplementation(async (c) => c);

      // --- ACT ---
      const result = await service.restore(1);

      // --- ASSERT ---
      // [CheckDB] Xác nhận trạng thái được cập nhật lại thành true.
      expect(result.isActive).toBe(true);
      expect(contentRepository.save).toHaveBeenCalled();
    });

    /**
     * [TC-LSN-CNT-013] Lỗi khôi phục nội dung không tồn tại.
     */
    it('TC-LSN-CNT-013 - should throw NotFound when restoring missing content', async () => {
      // --- ARRANGE ---
      contentRepository.findOne!.mockResolvedValue(null);

      // --- ACT & ASSERT ---
      await expect(service.restore(99)).rejects.toThrow(NotFoundException);
    });
  });
});
