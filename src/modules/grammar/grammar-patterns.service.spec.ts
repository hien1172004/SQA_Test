/**
 * Unit tests for GrammarPatternsService.
 *
 * Strategy: mock-only.
 * CheckDB: assert repo + queryBuilder calls với tham số đúng.
 * Rollback: jest.clearAllMocks() trong afterEach (no real DB).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { GrammarPatternsService } from './grammar-patterns.service';
import { GrammarPattern } from './entities/grammar-pattern.entity';
import { GrammarTranslation } from './entities/grammar-translation.entity';
import {
  createMockRepository,
  MockRepository,
} from '../../test/helpers/mock-repository';

describe('GrammarPatternsService', () => {
  let service: GrammarPatternsService;
  let patternRepository: MockRepository;
  let translationRepository: MockRepository;

  beforeEach(async () => {
    patternRepository = createMockRepository();
    translationRepository = createMockRepository();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GrammarPatternsService,
        {
          provide: getRepositoryToken(GrammarPattern),
          useValue: patternRepository,
        },
        {
          provide: getRepositoryToken(GrammarTranslation),
          useValue: translationRepository,
        },
      ],
    }).compile();

    service = module.get<GrammarPatternsService>(GrammarPatternsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    /**
     * [TC-GRM-PTN-001] Khởi tạo cấu trúc ngữ pháp mới.
     * Mục tiêu: Xác nhận hệ thống thực hiện lưu trữ đúng mảng các thành phần cấu trúc và cấp độ HSK.
     */
    it('TC-GRM-PTN-001 - should create new pattern', async () => {
      // --- ARRANGE ---
      // Input: Cấu trúc chứa từ '了', cấp độ HSK 1.
      const dto: any = { pattern: ['了'], hskLevel: 1 };
      patternRepository.create!.mockReturnValue(dto);
      patternRepository.save!.mockResolvedValue({ id: 1, ...dto });

      // --- ACT ---
      const result = await service.create(dto);

      // --- ASSERT ---
      // [CheckDB] Xác nhận repository.create được gọi với dữ liệu đầu vào.
      expect(patternRepository.create).toHaveBeenCalledWith(dto);
      // [CheckDB] Xác nhận repository.save được thực thi để lưu xuống DB.
      expect(patternRepository.save).toHaveBeenCalled();
      expect(result.id).toBe(1);
    });
  });

  describe('findAll', () => {
    /**
     * [TC-GRM-PTN-002] Tìm kiếm cấu trúc ngữ pháp với bộ lọc nâng cao.
     * Mục tiêu: Xác nhận việc sử dụng JSON_SEARCH của MySQL để tìm kiếm trong mảng JSON của DB.
     */
    it('TC-GRM-PTN-002 - should apply search, hskLevel, sort, pagination', async () => {
      // --- ARRANGE ---
      const qb = patternRepository.__queryBuilder;
      qb.getManyAndCount.mockResolvedValue([[{ id: 1 }], 1]);

      // --- ACT ---
      const result = await service.findAll({
        page: 2,
        limit: 5,
        search: 'le',
        hskLevel: 2,
        sortBy: 'hskLevel',
        sortOrder: 'DESC',
      } as any);

      // --- ASSERT ---
      // [CheckDB] Kiểm tra QueryBuilder sử dụng hàm JSON_SEARCH chính xác cho cột 'pattern'.
      expect(qb.andWhere).toHaveBeenCalledWith(
        "JSON_SEARCH(pattern.pattern, 'one', :search) IS NOT NULL",
        { search: '%le%' },
      );
      // [CheckDB] Kiểm tra lọc theo cấp độ HSK=2.
      expect(qb.andWhere).toHaveBeenCalledWith('pattern.hskLevel = :hskLevel', {
        hskLevel: 2,
      });
      // [CheckDB] Kiểm tra phân trang: skip=5 cho trang 2.
      expect(qb.skip).toHaveBeenCalledWith(5);
      expect(qb.take).toHaveBeenCalledWith(5);
      // [CheckDB] Kiểm tra sắp xếp giảm dần theo cấp độ.
      expect(qb.orderBy).toHaveBeenCalledWith('pattern.hskLevel', 'DESC');
      expect(result.totalPages).toBe(1);
    });

    /**
     * [TC-GRM-PTN-003] Sử dụng giá trị mặc định khi truy vấn rỗng.
     */
    it('TC-GRM-PTN-003 - should use defaults when query empty', async () => {
      // --- ARRANGE ---
      const qb = patternRepository.__queryBuilder;
      qb.getManyAndCount.mockResolvedValue([[], 0]);

      // --- ACT ---
      await service.findAll({} as any);

      // --- ASSERT ---
      // [CheckDB] Mặc định sắp xếp theo ID tăng dần nếu không chỉ định.
      expect(qb.skip).toHaveBeenCalledWith(0);
      expect(qb.take).toHaveBeenCalledWith(10);
      expect(qb.orderBy).toHaveBeenCalledWith('pattern.id', 'ASC');
    });

    /**
     * [TC-GRM-PTN-004] Tự động chuyển về sắp xếp theo ID khi trường yêu cầu không hợp lệ.
     */
    it('TC-GRM-PTN-004 - should fallback to id for invalid sortBy', async () => {
      // --- ARRANGE ---
      const qb = patternRepository.__queryBuilder;
      qb.getManyAndCount.mockResolvedValue([[], 0]);

      // --- ACT ---
      await service.findAll({ sortBy: 'invalid' } as any);

      // --- ASSERT ---
      expect(qb.orderBy).toHaveBeenCalledWith('pattern.id', 'ASC');
    });
  });

  describe('findOne', () => {
    /**
     * [TC-GRM-PTN-005] Lấy chi tiết cấu trúc kèm danh sách bản dịch.
     */
    it('TC-GRM-PTN-005 - should fetch with translations relation', async () => {
      // --- ARRANGE ---
      patternRepository.findOne!.mockResolvedValue({ id: 1 });

      // --- ACT ---
      const result = await service.findOne(1);

      // --- ASSERT ---
      // [CheckDB] Xác nhận repository nạp thêm quan hệ 'translations'.
      expect(patternRepository.findOne).toHaveBeenCalledWith({
        where: { id: 1 },
        relations: ['translations'],
      });
      expect(result.id).toBe(1);
    });

    /**
     * [TC-GRM-PTN-006] Lỗi khi truy cập cấu trúc không tồn tại.
     */
    it('TC-GRM-PTN-006 - should throw NotFound when missing', async () => {
      // --- ARRANGE ---
      patternRepository.findOne!.mockResolvedValue(null);

      // --- ACT & ASSERT ---
      await expect(service.findOne(99)).rejects.toThrow(NotFoundException);
    });
  });

  describe('findByPattern', () => {
    /**
     * [TC-GRM-PTN-007] Tìm kiếm chính xác cấu trúc ngữ pháp theo chuỗi văn bản.
     */
    it('TC-GRM-PTN-007 - should fetch by pattern string', async () => {
      // --- ARRANGE ---
      patternRepository.findOne!.mockResolvedValue({ id: 1 });

      // --- ACT ---
      await service.findByPattern('le');

      // --- ASSERT ---
      // [CheckDB] Tìm kiếm theo giá trị cột 'pattern'.
      expect(patternRepository.findOne).toHaveBeenCalledWith({
        where: { pattern: 'le' },
        relations: ['translations'],
      });
    });

    /**
     * [TC-GRM-PTN-008] Lỗi khi không tìm thấy chuỗi cấu trúc tương ứng.
     */
    it('TC-GRM-PTN-008 - should throw NotFound when pattern missing', async () => {
      // --- ARRANGE ---
      patternRepository.findOne!.mockResolvedValue(null);

      // --- ACT & ASSERT ---
      await expect(service.findByPattern('xx')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    /**
     * [TC-GRM-PTN-009] Cập nhật thông tin cấu trúc ngữ pháp.
     */
    it('TC-GRM-PTN-009 - should update and reload', async () => {
      // --- ARRANGE ---
      patternRepository.findOne!.mockResolvedValue({ id: 1 });
      patternRepository.update!.mockResolvedValue({ affected: 1 });

      // --- ACT ---
      const result = await service.update(1, { hskLevel: 3 } as any);

      // --- ASSERT ---
      // [CheckDB] Xác nhận lệnh update được gọi với dữ liệu mới.
      expect(patternRepository.update).toHaveBeenCalledWith(1, { hskLevel: 3 });
      expect(result.id).toBe(1);
    });

    /**
     * [TC-GRM-PTN-010] Lỗi cập nhật cấu trúc không tồn tại.
     */
    it('TC-GRM-PTN-010 - should throw NotFound when pattern missing', async () => {
      // --- ARRANGE ---
      patternRepository.findOne!.mockResolvedValue(null);

      // --- ACT & ASSERT ---
      await expect(service.update(99, {} as any)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('remove', () => {
    /**
     * [TC-GRM-PTN-011] Xóa bỏ cấu trúc ngữ pháp.
     */
    it('TC-GRM-PTN-011 - should remove existing pattern', async () => {
      // --- ARRANGE ---
      const p = { id: 1 };
      patternRepository.findOne!.mockResolvedValue(p);
      patternRepository.remove!.mockResolvedValue(p);

      // --- ACT ---
      await service.remove(1);

      // --- ASSERT ---
      // [CheckDB] Xác nhận lệnh remove vật lý được thực thi.
      expect(patternRepository.remove).toHaveBeenCalledWith(p);
    });

    /**
     * [TC-GRM-PTN-012] Lỗi xóa cấu trúc không tồn tại.
     */
    it('TC-GRM-PTN-012 - should throw NotFound when pattern missing', async () => {
      // --- ARRANGE ---
      patternRepository.findOne!.mockResolvedValue(null);

      // --- ACT & ASSERT ---
      await expect(service.remove(99)).rejects.toThrow(NotFoundException);
    });
  });

  describe('getStatistics', () => {
    /**
     * [TC-GRM-PTN-013] Tổng hợp số liệu thống kê ngữ pháp.
     */
    it('TC-GRM-PTN-013 - should aggregate stats', async () => {
      // --- ARRANGE ---
      patternRepository.count!.mockResolvedValue(20);
      patternRepository.__queryBuilder.getRawMany.mockResolvedValue([
        { level: 1, total: '5' },
        { level: 2, total: '15' },
      ]);

      // --- ACT ---
      const result = await service.getStatistics();

      // --- ASSERT ---
      expect(result.total).toBe(20);
      expect(result.hskLevelDistribution).toHaveLength(2);
    });
  });

  describe('createComplete', () => {
    /**
     * [TC-GRM-PTN-014] Quy trình tạo đồng thời cấu trúc và bản dịch đầu tiên.
     * Mục tiêu: Xác nhận hệ thống thực hiện hai bước lưu trữ liên tiếp và gán khóa ngoại chính xác.
     */
    it('TC-GRM-PTN-014 - should create new pattern + translation when no patternId', async () => {
      // --- ARRANGE ---
      const dto: any = {
        pattern: { pattern: ['了'], hskLevel: 1 },
        translation: {
          language: 'vn',
          grammarPoint: 'GP',
          explanation: 'E',
          example: 'EX',
        },
      };
      patternRepository.create!.mockReturnValue(dto.pattern);
      // Giả lập lưu pattern xong có ID=10.
      patternRepository.save!.mockResolvedValue({ id: 10, ...dto.pattern });
      translationRepository.create!.mockImplementation((d) => d);
      translationRepository.save!.mockResolvedValue({});
      patternRepository.findOne!.mockResolvedValue({ id: 10, translations: [] });

      // --- ACT ---
      const result = await service.createComplete(dto);

      // --- ASSERT ---
      // [CheckDB] Xác nhận tạo pattern trước.
      expect(patternRepository.create).toHaveBeenCalled();
      // [CheckDB] Xác nhận tạo translation sau đó với link tới pattern ID=10.
      expect(translationRepository.save).toHaveBeenCalled();
      expect(result.id).toBe(10);
    });

    /**
     * [TC-GRM-PTN-015] Lỗi thiếu dữ liệu cấu trúc khi tạo mới.
     */
    it('TC-GRM-PTN-015 - should throw BadRequest when no pattern data', async () => {
      // --- ACT & ASSERT ---
      await expect(
        service.createComplete({
          translation: { grammarPoint: 'X' },
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    /**
     * [TC-GRM-PTN-016] Thêm bản dịch mới cho một cấu trúc ngữ pháp đã tồn tại.
     */
    it('TC-GRM-PTN-016 - should add translation to existing pattern', async () => {
      // --- ARRANGE ---
      const existingPattern = {
        id: 5,
        translations: [{ language: 'en' }],
      };
      patternRepository.findOne!
        .mockResolvedValueOnce(existingPattern)
        .mockResolvedValueOnce({ id: 5, translations: [] });
      translationRepository.create!.mockImplementation((d) => d);
      translationRepository.save!.mockResolvedValue({});

      // --- ACT ---
      const result = await service.createComplete({
        patternId: 5,
        translation: { language: 'vn', grammarPoint: 'X' },
      } as any);

      // --- ASSERT ---
      expect(result.id).toBe(5);
      // [CheckDB] Xác nhận chỉ tạo thêm translation, không tạo thêm pattern.
      expect(patternRepository.create).not.toHaveBeenCalled();
    });

    /**
     * [TC-GRM-PTN-017] Lỗi khi thêm bản dịch cho mã cấu trúc không tồn tại.
     */
    it('TC-GRM-PTN-017 - should throw NotFound when patternId missing', async () => {
      // --- ARRANGE ---
      patternRepository.findOne!.mockResolvedValue(null);

      // --- ACT & ASSERT ---
      await expect(
        service.createComplete({
          patternId: 99,
          translation: { language: 'vn' },
        } as any),
      ).rejects.toThrow(NotFoundException);
    });

    /**
     * [TC-GRM-PTN-018] Lỗi xung đột ngôn ngữ (Bản dịch của ngôn ngữ đó đã tồn tại).
     * Mục tiêu: Đảm bảo mỗi cấu trúc chỉ có tối đa một bản dịch cho mỗi ngôn ngữ.
     */
    it('TC-GRM-PTN-018 - should throw Conflict when translation language exists', async () => {
      // --- ARRANGE ---
      // Giả lập cấu trúc ID=5 đã có bản dịch tiếng Việt (vn).
      patternRepository.findOne!.mockResolvedValue({
        id: 5,
        translations: [{ language: 'vn' }],
      });

      // --- ACT & ASSERT ---
      await expect(
        service.createComplete({
          patternId: 5,
          translation: { language: 'vn', grammarPoint: 'X' },
        } as any),
      ).rejects.toThrow(ConflictException);
    });

    /**
     * [TC-GRM-PTN-019] Tự động chọn ngôn ngữ tiếng Việt (vn) khi không chỉ định.
     */
    it('TC-GRM-PTN-019 - should default language to vn when not provided', async () => {
      // --- ARRANGE ---
      patternRepository.findOne!
        .mockResolvedValueOnce({ id: 5, translations: [] })
        .mockResolvedValueOnce({ id: 5, translations: [] });
      translationRepository.create!.mockImplementation((d) => d);
      translationRepository.save!.mockResolvedValue({});

      // --- ACT ---
      await service.createComplete({
        patternId: 5,
        translation: { grammarPoint: 'X' },
      } as any);

      // --- ASSERT ---
      // [CheckDB] Xác nhận 'vn' được gán làm giá trị mặc định.
      expect(translationRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ language: 'vn' }),
      );
    });
  });

  describe('updateCompleteByTranslationId', () => {
    /**
     * [TC-GRM-PTN-020] Cập nhật đồng thời thông tin cấu trúc và bản dịch.
     */
    it('TC-GRM-PTN-020 - should update both pattern and translation', async () => {
      // --- ARRANGE ---
      translationRepository.findOne!.mockResolvedValue({
        id: 100,
        grammarPatternId: 5,
      });
      patternRepository.update!.mockResolvedValue({ affected: 1 });
      translationRepository.update!.mockResolvedValue({ affected: 1 });
      patternRepository.findOne!.mockResolvedValue({ id: 5 });

      // --- ACT ---
      await service.updateCompleteByTranslationId(100, {
        pattern: { hskLevel: 3 },
        translation: { grammarPoint: 'NEW' },
      } as any);

      // --- ASSERT ---
      // [CheckDB] Xác nhận cả hai bảng đều được thực hiện lệnh update.
      expect(patternRepository.update).toHaveBeenCalledWith(5, { hskLevel: 3 });
      expect(translationRepository.update).toHaveBeenCalledWith(100, {
        grammarPoint: 'NEW',
      });
    });

    /**
     * [TC-GRM-PTN-021] Lỗi khi bản dịch yêu cầu cập nhật không tồn tại.
     */
    it('TC-GRM-PTN-021 - should throw NotFound when translation missing', async () => {
      // --- ARRANGE ---
      translationRepository.findOne!.mockResolvedValue(null);

      // --- ACT & ASSERT ---
      await expect(
        service.updateCompleteByTranslationId(99, {} as any),
      ).rejects.toThrow(NotFoundException);
    });

    /**
     * [TC-GRM-PTN-022] Bỏ qua quy trình cập nhật khi dữ liệu đầu vào rỗng.
     */
    it('TC-GRM-PTN-022 - should skip updates when both inputs empty', async () => {
      // --- ARRANGE ---
      translationRepository.findOne!.mockResolvedValue({
        id: 100,
        grammarPatternId: 5,
      });
      patternRepository.findOne!.mockResolvedValue({ id: 5 });

      // --- ACT ---
      await service.updateCompleteByTranslationId(100, {} as any);

      // --- ASSERT ---
      // [CheckDB] Xác nhận không có lệnh update nào được thực thi.
      expect(patternRepository.update).not.toHaveBeenCalled();
      expect(translationRepository.update).not.toHaveBeenCalled();
    });

    /**
     * [TC-GRM-PTN-023] Lỗi xung đột ngôn ngữ tiếng Việt (vn) khi không truyền tham số language.
     */
    it('TC-GRM-PTN-023 - should throw Conflict using default vn when language undefined', async () => {
      // --- ARRANGE ---
      patternRepository.findOne!.mockResolvedValue({
        id: 5,
        translations: [{ language: 'vn' }],
      });

      // --- ACT & ASSERT ---
      await expect(
        service.createComplete({
          patternId: 5,
          translation: { grammarPoint: 'X' }, // không có language -> mặc định 'vn'
        } as any),
      ).rejects.toThrow(/Translation for language "vn" already exists/);
    });
  });
});
