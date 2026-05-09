import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { WordSenseTranslationsService } from './word-sense-translations.service';
import { WordSenseTranslation } from './entities/word-sense-translation.entity';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { Repository } from 'typeorm';

describe('WordSenseTranslationsService', () => {
  let service: WordSenseTranslationsService;
  let repository: Repository<WordSenseTranslation>;

  const mockQueryBuilder = {
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    getManyAndCount: jest.fn(),
    getRawMany: jest.fn(),
  };

  const mockTranslationRepo = {
    create: jest.fn(),
    save: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    count: jest.fn(),
    remove: jest.fn(),
    createQueryBuilder: jest.fn(() => mockQueryBuilder),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WordSenseTranslationsService,
        {
          provide: getRepositoryToken(WordSenseTranslation),
          useValue: mockTranslationRepo,
        },
      ],
    }).compile();

    service = module.get<WordSenseTranslationsService>(WordSenseTranslationsService);
    repository = module.get<Repository<WordSenseTranslation>>(getRepositoryToken(WordSenseTranslation));
  });

  afterEach(() => {
    // --- ROLLBACK ---
    // Xóa bỏ tất cả các bản ghi cuộc gọi của Mock để tránh ảnh hưởng chéo giữa các test case.
    jest.clearAllMocks();
  });

  describe('create', () => {
    const dto = { wordSenseId: 1, language: 'en', translation: 'Hello' };

    /**
     * [TC-TRANS-001] Đăng ký bản dịch mới.
     * Mục tiêu: Xác nhận hệ thống tạo và lưu trữ bản dịch thành công khi ngôn ngữ chưa tồn tại.
     */
    it('should create and save a new translation successfully (TC-TRANS-001)', async () => {
      // --- ARRANGE ---
      mockTranslationRepo.findOne.mockResolvedValue(null);
      mockTranslationRepo.create.mockReturnValue(dto);
      mockTranslationRepo.save.mockResolvedValue({ id: 1, ...dto });

      // --- ACT ---
      const result = await service.create(dto);

      // --- ASSERT ---
      expect(result.id).toBe(1);
      // [CheckDB] Đảm bảo repo.save được gọi để thực hiện INSERT.
      expect(mockTranslationRepo.save).toHaveBeenCalled();
    });

    /**
     * [TC-TRANS-002] Xác thực tính duy nhất của ngôn ngữ bản dịch.
     * Mục tiêu: Ngăn chặn tạo 2 bản dịch cùng ngôn ngữ cho 1 nghĩa của từ.
     */
    it('should throw BadRequestException if language already exists for the sense (TC-TRANS-002)', async () => {
      // --- ARRANGE ---
      // Giả lập đã tồn tại bản dịch tiếng Anh (en) cho nghĩa này.
      mockTranslationRepo.findOne.mockResolvedValue({ id: 5, language: 'en' });

      // --- ACT & ASSERT ---
      await expect(service.create(dto)).rejects.toThrow(BadRequestException);
    });
  });

  describe('findAll', () => {
    /**
     * [TC-TRANS-003] Tìm kiếm bản dịch với bộ lọc.
     */
    it('should apply filters for wordSenseId and language correctly (TC-TRANS-003)', async () => {
      // --- ARRANGE ---
      const query = { wordSenseId: 10, language: 'vn', search: 'xin chao' };
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      // --- ACT ---
      await service.findAll(query);

      // --- ASSERT ---
      // [CheckDB] Xác nhận QueryBuilder áp dụng các điều kiện lọc.
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(expect.stringContaining('wordSenseId'), expect.anything());
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(expect.stringContaining('language'), expect.anything());
    });
  });

  describe('findById', () => {
    /**
     * [TC-TRANS-004] Truy vấn bản dịch theo ID thành công.
     */
    it('nên trả về translation khi id hợp lệ (TC-TRANS-004)', async () => {
      // --- ARRANGE ---
      const translation = { id: 1, translation: 'test' };
      mockTranslationRepo.findOne.mockResolvedValue(translation);

      // --- ACT ---
      const result = await service.findById(1);

      // --- ASSERT ---
      expect(result.id).toBe(1);
      expect(result).toEqual(translation);
      expect(mockTranslationRepo.findOne).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 1 } }));
    });

    /**
     * [TC-TRANS-005] Lỗi truy vấn bản dịch không tồn tại.
     */
    it('nên throw NotFoundException khi id không tồn tại (TC-TRANS-005)', async () => {
      // --- ARRANGE ---
      mockTranslationRepo.findOne.mockResolvedValue(null);

      // --- ACT & ASSERT ---
      await expect(service.findById(999)).rejects.toThrow(NotFoundException);
    });
  });

  describe('findByWordSenseId', () => {
    /**
     * [TC-TRANS-006] Truy xuất danh sách bản dịch theo Sense ID.
     */
    it('nên gọi repo.find với wordSenseId (TC-TRANS-006)', async () => {
      // --- ARRANGE ---
      mockTranslationRepo.find.mockResolvedValue([]);

      // --- ACT ---
      await service.findByWordSenseId(1);

      // --- ASSERT ---
      expect(mockTranslationRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { wordSenseId: 1 } }),
      );
    });

    /**
     * [TC-TRANS-006b] Lỗi khi truy vấn danh sách bản dịch của nghĩa không tồn tại (FAILING TEST).
     * Mục tiêu: Đảm bảo trả về lỗi 404 thay vì mảng rỗng [] khi truy cập sai ID thực thể cha.
     */
    it('should throw NotFoundException if wordSenseId does not exist (TC-TRANS-006b)', async () => {
      // --- ARRANGE ---
      mockTranslationRepo.find.mockResolvedValue([]);

      // --- ACT & ASSERT ---
      // BÀI TEST NÀY SẼ FAIL: Hàm hiện tại return [] thay vì throw NotFoundException
      await expect(service.findByWordSenseId(999)).rejects.toThrow(NotFoundException);
    });
  });

  describe('findByLanguage', () => {
    /**
     * [TC-TRANS-007] Truy xuất danh sách bản dịch theo ngôn ngữ.
     */
    it('nên gọi repo.find với language (TC-TRANS-007)', async () => {
      // --- ARRANGE ---
      mockTranslationRepo.find.mockResolvedValue([]);

      // --- ACT ---
      await service.findByLanguage('en');

      // --- ASSERT ---
      expect(mockTranslationRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { language: 'en' } }),
      );
    });
  });

  describe('update', () => {
    /**
     * [TC-TRANS-008] Cập nhật bản dịch thành công.
     */
    it('nên cập nhật thành công (TC-TRANS-008)', async () => {
      // --- ARRANGE ---
      const existing = { id: 1, language: 'vn' };
      mockTranslationRepo.findOne.mockResolvedValueOnce(existing); // findById
      mockTranslationRepo.save.mockResolvedValue({ ...existing, translation: 'new' });

      // --- ACT ---
      const result = await service.update(1, { translation: 'new' });

      // --- ASSERT ---
      expect(result.translation).toBe('new');
      expect(mockTranslationRepo.save).toHaveBeenCalled();
    });

    /**
     * [TC-TRANS-009] Xung đột ngôn ngữ khi cập nhật bản dịch.
     */
    it('nên throw BadRequestException nếu đổi sang ngôn ngữ đã tồn tại (TC-TRANS-009)', async () => {
      // --- ARRANGE ---
      const existing = { id: 1, language: 'vn', wordSenseId: 10 };
      mockTranslationRepo.findOne
        .mockResolvedValueOnce(existing) // findById
        .mockResolvedValueOnce({ id: 2 }); // conflict check findOne

      // --- ACT & ASSERT ---
      await expect(service.update(1, { language: 'en' })).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('remove', () => {
    /**
     * [TC-TRANS-010] Xóa bỏ bản dịch.
     */
    it('should remove translation entity when it exists (TC-TRANS-010)', async () => {
      // --- ARRANGE ---
      const translation = { id: 1 };
      mockTranslationRepo.findOne.mockResolvedValue(translation);
      
      // --- ACT ---
      await service.remove(1);

      // --- ASSERT ---
      // [CheckDB] Xác nhận lệnh remove được gửi tới repository.
      expect(mockTranslationRepo.remove).toHaveBeenCalledWith(translation);
    });
  });

  describe('getTranslationStats', () => {
    /**
     * [TC-TRANS-011] Thống kê ngôn ngữ bản dịch.
     */
    it('should return total count and language distribution (TC-TRANS-011)', async () => {
      // --- ARRANGE ---
      mockTranslationRepo.count.mockResolvedValue(500);
      mockQueryBuilder.getRawMany.mockResolvedValue([
        { language: 'vn', total: 300 },
        { language: 'en', total: 200 }
      ]);

      // --- ACT ---
      const result = await service.getTranslationStats();

      // --- ASSERT ---
      expect(result.total).toBe(500);
      expect(result.languageDistribution).toHaveLength(2);
      expect(mockTranslationRepo.count).toHaveBeenCalled();
    });
  });
});
