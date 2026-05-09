/**
 * Unit tests for GrammarTranslationsService.
 *
 * Strategy: mock-only.
 * CheckDB: assert repo methods (findOne/findAndCount/save/update/remove) gọi đúng tham số.
 * Rollback: jest.clearAllMocks() trong afterEach.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Like } from 'typeorm';
import { GrammarTranslationsService } from './grammar-translations.service';
import { GrammarTranslation } from './entities/grammar-translation.entity';
import {
  createMockRepository,
  MockRepository,
} from '../../test/helpers/mock-repository';

describe('GrammarTranslationsService', () => {
  let service: GrammarTranslationsService;
  let repository: MockRepository;

  beforeEach(async () => {
    repository = createMockRepository();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GrammarTranslationsService,
        {
          provide: getRepositoryToken(GrammarTranslation),
          useValue: repository,
        },
      ],
    }).compile();

    service = module.get<GrammarTranslationsService>(
      GrammarTranslationsService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    /**
     * [TC-GRM-TRN-001] Khởi tạo bản dịch ngữ pháp mới.
     * Mục tiêu: Xác nhận hệ thống kiểm tra sự tồn tại của cặp (Cấu trúc, Ngôn ngữ) trước khi lưu.
     */
    it('TC-GRM-TRN-001 - should create when no duplicate exists', async () => {
      // --- ARRANGE ---
      const dto: any = {
        grammarPatternId: 1,
        language: 'en',
        grammarPoint: 'X',
      };
      // Giả lập chưa có bản dịch tiếng Anh cho cấu trúc này.
      repository.findOne!.mockResolvedValue(null);
      repository.create!.mockReturnValue(dto);
      repository.save!.mockResolvedValue({ id: 10, ...dto });

      // --- ACT ---
      const result = await service.create(dto);

      // --- ASSERT ---
      // [CheckDB] Xác nhận service thực hiện kiểm tra trùng lặp trước khi tạo.
      expect(repository.findOne).toHaveBeenCalledWith({
        where: { grammarPatternId: 1, language: 'en' },
      });
      // [CheckDB] Xác nhận lệnh save được gọi thành công.
      expect(repository.save).toHaveBeenCalled();
      expect(result.id).toBe(10);
    });

    /**
     * [TC-GRM-TRN-002] Lỗi xung đột khi bản dịch cho ngôn ngữ đó đã tồn tại.
     */
    it('TC-GRM-TRN-002 - should throw Conflict when duplicate exists', async () => {
      // --- ARRANGE ---
      // Giả lập đã tồn tại bản dịch.
      repository.findOne!.mockResolvedValue({ id: 1 });

      // --- ACT & ASSERT ---
      await expect(
        service.create({ grammarPatternId: 1, language: 'en' } as any),
      ).rejects.toThrow(ConflictException);
      // [CheckDB] Xác nhận lệnh save KHÔNG được gọi để tránh dữ liệu rác.
      expect(repository.save).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    /**
     * [TC-GRM-TRN-003] Tìm kiếm bản dịch với đầy đủ tiêu chí lọc.
     */
    it('TC-GRM-TRN-003 - should apply filters, search, sort, pagination', async () => {
      // --- ARRANGE ---
      repository.findAndCount!.mockResolvedValue([[{ id: 1 }], 1]);

      // --- ACT ---
      const result = await service.findAll({
        page: 2,
        limit: 5,
        grammarPatternId: 3,
        language: 'en',
        search: 'hello',
        sortBy: 'language',
        sortOrder: 'DESC',
      } as any);

      // --- ASSERT ---
      // [CheckDB] Xác nhận repository.findAndCount được gọi với đúng tham số WHERE và LIKE.
      expect(repository.findAndCount).toHaveBeenCalledWith({
        where: {
          grammarPatternId: 3,
          language: 'en',
          grammarPoint: Like('%hello%'),
        },
        relations: ['grammarPattern'],
        skip: 5,
        take: 5,
        order: { language: 'DESC' },
      });
      expect(result.totalPages).toBe(1);
    });

    /**
     * [TC-GRM-TRN-004] Tự động chuyển về sắp xếp mặc định khi tham số không hợp lệ.
     */
    it('TC-GRM-TRN-004 - should fallback to id ASC for invalid sortBy', async () => {
      // --- ARRANGE ---
      repository.findAndCount!.mockResolvedValue([[], 0]);

      // --- ACT ---
      await service.findAll({ sortBy: 'invalid', sortOrder: 'WRONG' } as any);

      // --- ASSERT ---
      expect(repository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          order: { id: 'ASC' },
          skip: 0,
          take: 10,
        }),
      );
    });
  });

  describe('findAll - default sort', () => {
    /**
     * [TC-GRM-TRN-015] Sử dụng sắp xếp mặc định theo ID khi không truyền tham số.
     */
    it('TC-GRM-TRN-015 - should use default sortBy=id ASC when not provided', async () => {
      // --- ARRANGE ---
      repository.findAndCount!.mockResolvedValue([[], 0]);

      // --- ACT ---
      await service.findAll({} as any);

      // --- ASSERT ---
      expect(repository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ order: { id: 'ASC' } }),
      );
    });
  });

  describe('findOne', () => {
    /**
     * [TC-GRM-TRN-005] Lấy chi tiết bản dịch theo ID.
     */
    it('TC-GRM-TRN-005 - should return translation when found', async () => {
      // --- ARRANGE ---
      const t = { id: 1 };
      repository.findOne!.mockResolvedValue(t);

      // --- ACT ---
      const result = await service.findOne(1);

      // --- ASSERT ---
      expect(result).toEqual(t);
    });

    /**
     * [TC-GRM-TRN-006] Lỗi khi bản dịch không tồn tại.
     */
    it('TC-GRM-TRN-006 - should throw NotFound when missing', async () => {
      // --- ARRANGE ---
      repository.findOne!.mockResolvedValue(null);

      // --- ACT & ASSERT ---
      await expect(service.findOne(99)).rejects.toThrow(NotFoundException);
    });
  });

  describe('findByGrammarPatternId', () => {
    /**
     * [TC-GRM-TRN-007] Lấy danh sách bản dịch của một cấu trúc ngữ pháp cụ thể.
     */
    it('TC-GRM-TRN-007 - should query by grammarPatternId', async () => {
      // --- ARRANGE ---
      repository.find!.mockResolvedValue([]);

      // --- ACT ---
      await service.findByGrammarPatternId(5);

      // --- ASSERT ---
      // [CheckDB] Xác nhận lọc theo ID cấu trúc và sắp xếp theo ngôn ngữ.
      expect(repository.find).toHaveBeenCalledWith({
        where: { grammarPatternId: 5 },
        relations: ['grammarPattern'],
        order: { language: 'ASC' },
      });
    });
  });

  describe('findByLanguage', () => {
    /**
     * [TC-GRM-TRN-008] Lấy toàn bộ các bản dịch của một ngôn ngữ nhất định.
     */
    it('TC-GRM-TRN-008 - should query by language', async () => {
      // --- ARRANGE ---
      repository.find!.mockResolvedValue([]);

      // --- ACT ---
      await service.findByLanguage('vi');

      // --- ASSERT ---
      // [CheckDB] Xác nhận lọc theo cột 'language'.
      expect(repository.find).toHaveBeenCalledWith({
        where: { language: 'vi' },
        relations: ['grammarPattern'],
        order: { id: 'ASC' },
      });
    });
  });

  describe('update', () => {
    /**
     * [TC-GRM-TRN-009] Cập nhật ngôn ngữ cho bản dịch.
     * Mục tiêu: Xác nhận việc kiểm tra trùng lặp khi người dùng thay đổi ngôn ngữ của bản dịch hiện có.
     */
    it('TC-GRM-TRN-009 - should update language when no conflict', async () => {
      // --- ARRANGE ---
      repository.findOne!
        .mockResolvedValueOnce({ id: 1, grammarPatternId: 1, language: 'en' }) // Lần 1: findOne ban đầu
        .mockResolvedValueOnce(null) // Lần 2: kiểm tra trùng lặp (không trùng)
        .mockResolvedValueOnce({ id: 1, language: 'vi' }); // Lần 3: reload sau khi cập nhật
      repository.update!.mockResolvedValue({ affected: 1 });

      // --- ACT ---
      const result = await service.update(1, { language: 'vi' } as any);

      // --- ASSERT ---
      // [CheckDB] Xác nhận lệnh update được gọi với ngôn ngữ mới.
      expect(repository.update).toHaveBeenCalledWith(1, { language: 'vi' });
      expect(result.language).toBe('vi');
    });

    /**
     * [TC-GRM-TRN-010] Lỗi xung đột khi cập nhật sang ngôn ngữ đã tồn tại bản dịch.
     */
    it('TC-GRM-TRN-010 - should throw Conflict when new language duplicates', async () => {
      // --- ARRANGE ---
      repository.findOne!
        .mockResolvedValueOnce({ id: 1, grammarPatternId: 1, language: 'en' })
        .mockResolvedValueOnce({ id: 9 }); // Tìm thấy bản dịch khác đã dùng ngôn ngữ này
      
      // --- ACT & ASSERT ---
      await expect(
        service.update(1, { language: 'vi' } as any),
      ).rejects.toThrow(ConflictException);
      // [CheckDB] Xác nhận không gọi lệnh update để bảo vệ dữ liệu.
      expect(repository.update).not.toHaveBeenCalled();
    });

    /**
     * [TC-GRM-TRN-011] Tối ưu hóa quy trình: Bỏ qua kiểm tra trùng lặp khi không thay đổi ngôn ngữ.
     */
    it('TC-GRM-TRN-011 - should skip duplicate check when language not changed', async () => {
      // --- ARRANGE ---
      repository.findOne!
        .mockResolvedValueOnce({ id: 1, grammarPatternId: 1, language: 'en' })
        .mockResolvedValueOnce({ id: 1, grammarPoint: 'NEW' });
      repository.update!.mockResolvedValue({ affected: 1 });

      // --- ACT ---
      await service.update(1, { grammarPoint: 'NEW' } as any);

      // --- ASSERT ---
      // [CheckDB] Chỉ gọi findOne 2 lần (tìm ban đầu + reload), không gọi lần check trùng lặp.
      expect(repository.findOne).toHaveBeenCalledTimes(2);
    });
  });

  describe('remove', () => {
    /**
     * [TC-GRM-TRN-012] Xóa bỏ bản dịch ngữ pháp.
     */
    it('TC-GRM-TRN-012 - should remove when exists', async () => {
      // --- ARRANGE ---
      const t = { id: 1 };
      repository.findOne!.mockResolvedValue(t);
      repository.remove!.mockResolvedValue(t);

      // --- ACT ---
      await service.remove(1);

      // --- ASSERT ---
      // [CheckDB] Xác nhận lệnh remove vật lý được thực thi.
      expect(repository.remove).toHaveBeenCalledWith(t);
    });

    /**
     * [TC-GRM-TRN-013] Lỗi xóa bản dịch không tồn tại.
     */
    it('TC-GRM-TRN-013 - should throw NotFound when missing', async () => {
      // --- ARRANGE ---
      repository.findOne!.mockResolvedValue(null);

      // --- ACT & ASSERT ---
      await expect(service.remove(99)).rejects.toThrow(NotFoundException);
    });
  });

  describe('getStatistics', () => {
    /**
     * [TC-GRM-TRN-014] Tổng hợp số liệu thống kê bản dịch.
     */
    it('TC-GRM-TRN-014 - should aggregate statistics', async () => {
      // --- ARRANGE ---
      repository.count!.mockResolvedValue(15);
      repository.__queryBuilder.getRawMany.mockResolvedValue([
        { language: 'en', total: '10' },
        { language: 'vi', total: '5' },
      ]);

      // --- ACT ---
      const result = await service.getStatistics();

      // --- ASSERT ---
      expect(result.total).toBe(15);
      expect(result.languageDistribution).toHaveLength(2);
    });
  });
});
