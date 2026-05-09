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
     * [TC-LSN-QST-001] Tạo câu hỏi mới với số thứ tự tự động.
     * Mục tiêu: Xác nhận hệ thống tự tính toán orderIndex khi DTO không cung cấp.
     */
    it('TC-LSN-QST-001 - should auto-generate orderIndex when not provided', async () => {
      // --- ARRANGE ---
      const dto: any = { lessonId: 10, questionType: 'mcq', data: {} };
      const createdEntity = { ...dto, orderIndex: 5 };
      const savedEntity = { id: 1, ...createdEntity };
      
      // Giả lập OrderIndexService trả về số thứ tự 5.
      orderIndexService.getNextOrderIndex.mockResolvedValue(5);
      questionRepository.create!.mockReturnValue(createdEntity);
      questionRepository.save!.mockResolvedValue(savedEntity);

      // --- ACT ---
      const result = await service.create(dto);

      // --- ASSERT ---
      // [CheckDB] Xác nhận yêu cầu cấp số thứ tự mới cho bài học ID=10.
      expect(orderIndexService.getNextOrderIndex).toHaveBeenCalledWith(10);
      // [CheckDB] Xác nhận repository lưu câu hỏi với orderIndex=5.
      expect(questionRepository.create).toHaveBeenCalledWith({
        ...dto,
        orderIndex: 5,
      });
      expect(questionRepository.save).toHaveBeenCalledWith(createdEntity);
      expect(result).toEqual(savedEntity);
    });

    /**
     * [TC-LSN-QST-002] Tạo câu hỏi với số thứ tự được chỉ định sẵn.
     */
    it('TC-LSN-QST-002 - should keep provided orderIndex', async () => {
      // --- ARRANGE ---
      const dto: any = {
        lessonId: 10,
        orderIndex: 9,
        questionType: 'mcq',
        data: {},
      };
      questionRepository.create!.mockReturnValue(dto);
      questionRepository.save!.mockResolvedValue({ id: 2, ...dto });

      // --- ACT ---
      await service.create(dto);

      // --- ASSERT ---
      // [CheckDB] Xác nhận OrderIndexService KHÔNG được gọi.
      expect(orderIndexService.getNextOrderIndex).not.toHaveBeenCalled();
      expect(questionRepository.create).toHaveBeenCalledWith(dto);
    });

    /**
     * [TC-LSN-QST-003] Xử lý trường hợp orderIndex truyền vào là null.
     * Mục tiêu: Coi null tương đương với chưa có và thực hiện tự động sinh.
     */
    it('TC-LSN-QST-003 - should treat null orderIndex as missing', async () => {
      // --- ARRANGE ---
      const dto: any = { lessonId: 4, orderIndex: null };
      orderIndexService.getNextOrderIndex.mockResolvedValue(2);
      questionRepository.create!.mockReturnValue({});
      questionRepository.save!.mockResolvedValue({});

      // --- ACT ---
      await service.create(dto);

      // --- ASSERT ---
      expect(orderIndexService.getNextOrderIndex).toHaveBeenCalledWith(4);
    });
  });

  describe('findAll', () => {
    /**
     * [TC-LSN-QST-004] Lấy danh sách câu hỏi đang hoạt động.
     */
    it('TC-LSN-QST-004 - should return only active questions', async () => {
      // --- ARRANGE ---
      const list = [{ id: 1 }, { id: 2 }];
      questionRepository.find!.mockResolvedValue(list);

      // --- ACT ---
      const result = await service.findAll();

      // --- ASSERT ---
      // [CheckDB] Xác nhận chỉ lấy các câu hỏi Active và sắp xếp theo orderIndex.
      expect(questionRepository.find).toHaveBeenCalledWith({
        where: { isActive: true },
        order: { orderIndex: 'ASC' },
      });
      expect(result).toEqual(list);
    });
  });

  describe('findByLessonId', () => {
    /**
     * [TC-LSN-QST-005] Truy xuất câu hỏi của bài học cụ thể.
     */
    it('TC-LSN-QST-005 - should query by lessonId and isActive', async () => {
      // --- ARRANGE ---
      questionRepository.find!.mockResolvedValue([]);

      // --- ACT ---
      await service.findByLessonId(7);

      // --- ASSERT ---
      // [CheckDB] Xác nhận lọc theo đúng lessonId và trạng thái Active.
      expect(questionRepository.find).toHaveBeenCalledWith({
        where: { lessonId: 7, isActive: true },
        order: { orderIndex: 'ASC' },
      });
    });
  });

  describe('findOne', () => {
    /**
     * [TC-LSN-QST-006] Lấy chi tiết câu hỏi đang hoạt động.
     */
    it('TC-LSN-QST-006 - should return question when found (active only)', async () => {
      // --- ARRANGE ---
      const q = { id: 1, isActive: true };
      questionRepository.findOne!.mockResolvedValue(q);

      // --- ACT ---
      const result = await service.findOne(1);

      // --- ASSERT ---
      // [CheckDB] Tìm kiếm theo ID kèm isActive=true.
      expect(questionRepository.findOne).toHaveBeenCalledWith({
        where: { id: 1, isActive: true },
      });
      expect(result).toEqual(q);
    });

    /**
     * [TC-LSN-QST-007] Lấy chi tiết câu hỏi bất kể trạng thái.
     */
    it('TC-LSN-QST-007 - should not filter isActive when includeInactive=true', async () => {
      // --- ARRANGE ---
      questionRepository.findOne!.mockResolvedValue({ id: 1 });

      // --- ACT ---
      await service.findOne(1, true);

      // --- ASSERT ---
      // [CheckDB] Xác nhận không có isActive trong tham số query.
      expect(questionRepository.findOne).toHaveBeenCalledWith({
        where: { id: 1 },
      });
    });

    /**
     * [TC-LSN-QST-008] Lỗi khi truy cập câu hỏi không tồn tại.
     */
    it('TC-LSN-QST-008 - should throw NotFoundException when not found', async () => {
      // --- ARRANGE ---
      questionRepository.findOne!.mockResolvedValue(null);

      // --- ACT & ASSERT ---
      await expect(service.findOne(999)).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    /**
     * [TC-LSN-QST-009] Cập nhật thông tin câu hỏi.
     */
    it('TC-LSN-QST-009 - should merge fields and save', async () => {
      // --- ARRANGE ---
      const existing = { id: 1, isActive: true, data: { a: 1 } };
      questionRepository.findOne!.mockResolvedValue(existing);
      questionRepository.save!.mockImplementation(async (q) => q);

      // --- ACT ---
      const result = await service.update(1, { data: { a: 2 } } as any);

      // --- ASSERT ---
      // [CheckDB] findOne được gọi không có filter Active để cho phép cập nhật cả bản ghi Inactive.
      expect(questionRepository.findOne).toHaveBeenCalledWith({
        where: { id: 1 },
      });
      // [CheckDB] Xác nhận repository lưu dữ liệu mới (a: 2).
      expect(questionRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 1, data: { a: 2 } }),
      );
      expect(result.data).toEqual({ a: 2 });
    });
  });

  describe('remove (soft delete)', () => {
    /**
     * [TC-LSN-QST-010] Xóa mềm câu hỏi.
     */
    it('TC-LSN-QST-010 - should set isActive=false and save', async () => {
      // --- ARRANGE ---
      const existing = { id: 1, isActive: true };
      questionRepository.findOne!.mockResolvedValue(existing);
      questionRepository.save!.mockResolvedValue({ ...existing, isActive: false });

      // --- ACT ---
      await service.remove(1);

      // --- ASSERT ---
      // [CheckDB] Trạng thái được chuyển sang false trước khi lưu.
      expect(questionRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 1, isActive: false }),
      );
    });
  });

  describe('hardDelete', () => {
    /**
     * [TC-LSN-QST-011] Xóa cứng câu hỏi khỏi DB.
     */
    it('TC-LSN-QST-011 - should hard delete successfully', async () => {
      // --- ARRANGE ---
      questionRepository.delete!.mockResolvedValue({ affected: 1 });

      // --- ACT ---
      await service.hardDelete(1);

      // --- ASSERT ---
      // [CheckDB] Xác nhận repository.delete được gọi.
      expect(questionRepository.delete).toHaveBeenCalledWith(1);
    });

    /**
     * [TC-LSN-QST-012] Lỗi xóa câu hỏi không tồn tại.
     */
    it('TC-LSN-QST-012 - should throw NotFound when nothing deleted', async () => {
      // --- ARRANGE ---
      questionRepository.delete!.mockResolvedValue({ affected: 0 });

      // --- ACT & ASSERT ---
      await expect(service.hardDelete(99)).rejects.toThrow(NotFoundException);
    });
  });

  describe('restore', () => {
    /**
     * [TC-LSN-QST-013] Khôi phục câu hỏi đã xóa mềm.
     */
    it('TC-LSN-QST-013 - should restore inactive question', async () => {
      // --- ARRANGE ---
      const existing = { id: 1, isActive: false };
      questionRepository.findOne!.mockResolvedValue(existing);
      questionRepository.save!.mockImplementation(async (q) => q);

      // --- ACT ---
      const result = await service.restore(1);

      // --- ASSERT ---
      // [CheckDB] Trạng thái được khôi phục thành true.
      expect(result.isActive).toBe(true);
    });

    /**
     * [TC-LSN-QST-014] Lỗi khôi phục khi câu hỏi không tồn tại.
     */
    it('TC-LSN-QST-014 - should throw NotFound when restoring missing question', async () => {
      // --- ARRANGE ---
      questionRepository.findOne!.mockResolvedValue(null);

      // --- ACT & ASSERT ---
      await expect(service.restore(99)).rejects.toThrow(NotFoundException);
    });
  });
});
