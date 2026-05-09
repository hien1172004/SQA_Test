import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { WordsService } from './words.service';
import { Word } from './entities/word.entity';
import { WordSense } from './entities/word-sense.entity';
import { WordSenseTranslation } from './entities/word-sense-translation.entity';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { Repository } from 'typeorm';

describe('WordsService', () => {
  let service: WordsService;
  let wordRepository: Repository<Word>;

  const mockQueryBuilder = {
    andWhere: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    getManyAndCount: jest.fn(),
    getOne: jest.fn(),
    getRawOne: jest.fn(),
  };

  const mockWordRepo = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
    count: jest.fn(),
    remove: jest.fn(),
    delete: jest.fn(),
    createQueryBuilder: jest.fn(() => mockQueryBuilder),
  };

  const mockSenseRepo = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
    createQueryBuilder: jest.fn(() => mockQueryBuilder),
  };

  const mockTranslationRepo = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WordsService,
        {
          provide: getRepositoryToken(Word),
          useValue: mockWordRepo,
        },
        {
          provide: getRepositoryToken(WordSense),
          useValue: mockSenseRepo,
        },
        {
          provide: getRepositoryToken(WordSenseTranslation),
          useValue: mockTranslationRepo,
        },
      ],
    }).compile();

    service = module.get<WordsService>(WordsService);
    wordRepository = module.get<Repository<Word>>(getRepositoryToken(Word));
  });

  afterEach(() => {
    // --- ROLLBACK ---
    // Xóa bỏ tất cả các bản ghi cuộc gọi của Mock để tránh ảnh hưởng chéo giữa các test case.
    jest.clearAllMocks();
  });

  describe('create', () => {
    /**
     * [TC-WORD-001] Khởi tạo một từ vựng mới.
     * Mục tiêu: Xác nhận hệ thống lưu trữ thành công từ vựng khi dữ liệu đầu vào hợp lệ.
     */
    it('should create and save a new word successfully (TC-WORD-001)', async () => {
      // --- ARRANGE ---
      // Input: DTO chứa thông tin chữ Hán và phiên âm.
      const dto = { simplified: '测试', traditional: '測試', pinyin: 'cèshì' };
      // Kết quả giả lập sau khi lưu thành công (có thêm ID).
      const savedWord = { id: 1, ...dto };

      // TypeORM: create() khởi tạo entity trong memory.
      mockWordRepo.create.mockReturnValue(dto);
      // TypeORM: save() thực hiện INSERT vào cơ sở dữ liệu.
      mockWordRepo.save.mockResolvedValue(savedWord);

      // --- ACT ---
      const result = await service.create(dto);

      // --- ASSERT ---
      // Xác nhận output trả về đúng đối tượng đã lưu.
      expect(result).toEqual(savedWord);
      // [CheckDB] Đảm bảo repo.create được gọi để ánh xạ DTO.
      expect(mockWordRepo.create).toHaveBeenCalledWith(dto);
      // [CheckDB] Đảm bảo repo.save được gọi để ghi xuống DB.
      expect(mockWordRepo.save).toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    /**
     * [TC-WORD-002] Tìm kiếm và phân trang từ vựng.
     * Mục tiêu: Xác nhận hệ thống trả về danh sách dữ liệu và tổng trang chính xác.
     */
    it('should return paginated words with search filters successfully (TC-WORD-002)', async () => {
      // --- ARRANGE ---
      // Input: Tìm kiếm 'test' ở trang 2, giới hạn 5 bản ghi.
      const query = { search: 'test', page: 2, limit: 5 };
      const words = [{ id: 1, simplified: 'test' }];
      
      // Giả lập DB có tổng cộng 11 bản ghi khớp với điều kiện.
      mockQueryBuilder.getManyAndCount.mockResolvedValue([words, 11]);

      // --- ACT ---
      const result = await service.findAll(query);

      // --- ASSERT ---
      expect(result.words).toEqual(words);
      expect(result.total).toBe(11);
      expect(result.page).toBe(2);
      // Logic: Math.ceil(11 / 5) = 3 trang.
      expect(result.totalPages).toBe(3);

      // [CheckDB] Xác nhận SQL query sử dụng filter LIKE đúng cách.
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('word.simplified'),
        { search: '%test%' },
      );
    });

    /**
     * [TC-WORD-003] Phân trang mặc định.
     * Mục tiêu: Đảm bảo trang 1 và limit 10 khi người dùng không truyền tham số.
     */
    it('should return words using default pagination parameters when none provided (TC-WORD-003)', async () => {
      // --- ARRANGE ---
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      // --- ACT ---
      await service.findAll({});

      // --- ASSERT ---
      // skip = (1-1)*10 = 0.
      expect(mockQueryBuilder.skip).toHaveBeenCalledWith(0);
      // take = 10 (mặc định).
      expect(mockQueryBuilder.take).toHaveBeenCalledWith(10);
    });

    /**
     * [TC-WORD-003B] DB không có dữ liệu khớp.
     * Mục tiêu: Trả về mảng rỗng thay vì lỗi.
     */
    it('should return total=0 and empty list when no words match (TC-WORD-003B)', async () => {
      // --- ARRANGE ---
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      // --- ACT ---
      const result = await service.findAll({ search: 'none' });

      // --- ASSERT ---
      expect(result.total).toBe(0);
      expect(result.words).toEqual([]);
      expect(result.totalPages).toBe(0);
    });

    /**
     * [TC-WORD-003C] Không truyền search filter.
     * Mục tiêu: Hệ thống không được gọi lệnh andWhere vào DB.
     */
    it('should not apply search filter if search is missing (TC-WORD-003C)', async () => {
      // --- ARRANGE ---
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      // --- ACT ---
      await service.findAll({});

      // --- ASSERT ---
      expect(mockQueryBuilder.andWhere).not.toHaveBeenCalled();
    });
  });

  describe('findById', () => {
    /**
     * [TC-WORD-004] Truy vấn theo ID.
     * Mục tiêu: Đảm bảo lấy đủ thông tin từ vựng kèm quan hệ.
     */
    it('should return a word object when a valid ID is provided (TC-WORD-004)', async () => {
      // --- ARRANGE ---
      const word = { id: 1, simplified: 'test' };
      mockQueryBuilder.getOne.mockResolvedValue(word);

      // --- ACT ---
      const result = await service.findById(1);

      // --- ASSERT ---
      expect(result).toEqual(word);
      // [CheckDB] Kiểm tra filter đúng ID.
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('word.id = :id', { id: 1 });
    });

    /**
     * [TC-WORD-005] Xử lý ID không tồn tại.
     * Mục tiêu: Ném NotFoundException.
     */
    it('should throw NotFoundException when the provided ID does not exist (TC-WORD-005)', async () => {
      // --- ARRANGE ---
      mockQueryBuilder.getOne.mockResolvedValue(null);

      // --- ACT & ASSERT ---
      await expect(service.findById(99)).rejects.toThrow(NotFoundException);
    });
  });

  describe('findBySimplified', () => {
    /**
     * [TC-WORD-006] Truy vấn theo chữ Hán rút gọn.
     * Mục tiêu: Xác nhận hệ thống tìm kiếm theo thuộc tính text.
     */
    it('should return a word when matching simplified form (TC-WORD-006)', async () => {
      // --- ARRANGE ---
      const word = { id: 1, simplified: 'test' };
      mockQueryBuilder.getOne.mockResolvedValue(word);

      // --- ACT ---
      const result = await service.findBySimplified('test');

      // --- ASSERT ---
      expect(result).toEqual(word);
      // [CheckDB] Xác nhận query filter simplified.
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('word.simplified = :simplified', {
        simplified: 'test',
      });
    });

    /**
     * [TC-WORD-007] Chữ Hán không tồn tại.
     */
    it('should throw NotFoundException if simplified form is not found (TC-WORD-007)', async () => {
      // --- ARRANGE ---
      mockQueryBuilder.getOne.mockResolvedValue(null);

      // --- ACT & ASSERT ---
      await expect(service.findBySimplified('none')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    /**
     * [TC-WORD-008] Cập nhật thông tin từ vựng.
     * Mục tiêu: Xác nhận dữ liệu được lưu thay đổi thành công.
     */
    it('should update and save word changes successfully (TC-WORD-008)', async () => {
      // --- ARRANGE ---
      const word = { id: 1, simplified: 'old' };
      const dto = { simplified: 'new' };
      mockQueryBuilder.getOne.mockResolvedValue(word);
      mockWordRepo.findOne.mockResolvedValue(null);
      mockWordRepo.save.mockImplementation((w) => Promise.resolve(w));

      // --- ACT ---
      const result = await service.update(1, dto);

      // --- ASSERT ---
      expect(result.simplified).toBe('new');
      // [CheckDB] Đảm bảo repo.save được gọi để cập nhật.
      expect(mockWordRepo.save).toHaveBeenCalled();
    });

    /**
     * [TC-WORD-009] Bỏ qua kiểm tra trùng lặp nếu chữ Hán không đổi.
     * Mục tiêu: Tối ưu hóa số lượng query DB.
     */
    it('should skip duplicate check if simplified remains same (TC-WORD-009)', async () => {
      // --- ARRANGE ---
      const word = { id: 1, simplified: 'same' };
      const dto = { simplified: 'same' };
      mockQueryBuilder.getOne.mockResolvedValue(word);

      // --- ACT ---
      await service.update(1, dto);

      // --- ASSERT ---
      expect(mockWordRepo.findOne).not.toHaveBeenCalled();
    });

    /**
     * [TC-WORD-010] Xử lý xung đột chữ Hán.
     * Mục tiêu: Ngăn chặn cập nhật nếu chữ Hán mới đã tồn tại ở bản ghi khác.
     */
    it('should throw BadRequestException if simplified form already exists (TC-WORD-010)', async () => {
      // --- ARRANGE ---
      const word = { id: 1, simplified: 'old' };
      const dto = { simplified: 'exists' };
      mockQueryBuilder.getOne.mockResolvedValue(word);
      mockWordRepo.findOne.mockResolvedValue({ id: 2, simplified: 'exists' });

      // --- ACT & ASSERT ---
      await expect(service.update(1, dto)).rejects.toThrow(BadRequestException);
    });
  });

  describe('remove', () => {
    /**
     * [TC-WORD-011] Xóa từ vựng.
     * Mục tiêu: Xác nhận lệnh xóa được gửi tới repository.
     */
    it('should remove word entity successfully (TC-WORD-011)', async () => {
      // --- ARRANGE ---
      const word = { id: 1 };
      mockQueryBuilder.getOne.mockResolvedValue(word);

      // --- ACT ---
      await service.remove(1);

      // --- ASSERT ---
      expect(mockWordRepo.remove).toHaveBeenCalledWith(word);
    });

    /**
     * [TC-WORD-011B] Xóa từ không tồn tại.
     */
    it('should throw NotFoundException when removing non-existent word (TC-WORD-011B)', async () => {
      // --- ARRANGE ---
      mockQueryBuilder.getOne.mockResolvedValue(null);

      // --- ACT & ASSERT ---
      await expect(service.remove(999)).rejects.toThrow(NotFoundException);
      expect(mockWordRepo.remove).not.toHaveBeenCalled();
    });
  });

  describe('getWordStats', () => {
    /**
     * [TC-WORD-012] Thống kê từ vựng.
     */
    it('should return total count of words (TC-WORD-012)', async () => {
      // --- ARRANGE ---
      mockWordRepo.count.mockResolvedValue(50);

      // --- ACT ---
      const result = await service.getWordStats();

      // --- ASSERT ---
      expect(result.total).toBe(50);
    });

    /**
     * [TC-WORD-012B] Thống kê khi DB rỗng.
     */
    it('should return total=0 if no words exist (TC-WORD-012B)', async () => {
      // --- ARRANGE ---
      mockWordRepo.count.mockResolvedValue(0);

      // --- ACT ---
      const result = await service.getWordStats();

      // --- ASSERT ---
      expect(result.total).toBe(0);
    });
  });

  describe('search', () => {
    /**
     * [TC-WORD-013] Kiểm tra sự tồn tại của từ.
     */
    it('should return exists:true if found (TC-WORD-013)', async () => {
      // --- ARRANGE ---
      const word = { id: 1, simplified: 'test' };
      mockQueryBuilder.getOne.mockResolvedValue(word);

      // --- ACT ---
      const result = await service.search('test');

      // --- ASSERT ---
      expect(result.exists).toBe(true);
      expect(result.wordId).toBe(1);
    });

    /**
     * [TC-WORD-014] Từ không tồn tại.
     */
    it('should return exists:false if not found (TC-WORD-014)', async () => {
      // --- ARRANGE ---
      mockQueryBuilder.getOne.mockResolvedValue(null);

      // --- ACT ---
      const result = await service.search('none');

      // --- ASSERT ---
      expect(result.exists).toBe(false);
      expect(result.wordId).toBeNull();
    });
  });

  describe('getNextSenseNumber', () => {
    /**
     * [TC-WORD-015] Lấy số thứ tự nghĩa tiếp theo.
     */
    it('should return max+1 (TC-WORD-015)', async () => {
      // --- ARRANGE ---
      mockQueryBuilder.getRawOne.mockResolvedValue({ max: 5 });

      // --- ACT ---
      const result = await service.getNextSenseNumber(1);

      // --- ASSERT ---
      expect(result).toBe(6);
    });

    /**
     * [TC-WORD-016] Số thứ tự cho nghĩa đầu tiên.
     */
    it('should return 1 when no senses exist (TC-WORD-016)', async () => {
      // --- ARRANGE ---
      mockQueryBuilder.getRawOne.mockResolvedValue(null);

      // --- ACT ---
      const result = await service.getNextSenseNumber(1);

      // --- ASSERT ---
      expect(result).toBe(1);
    });
  });

  describe('createComplete', () => {
    const dto = {
      word: {
        simplified: 'new',
        traditional: 'NEW',
        pinyin: 'new',
      },
      sense: { pinyin: 'sense' },
      translation: { translation: 'trans', language: 'vn' },
    };

    /**
     * [TC-WORD-017] Tạo từ vựng trọn gói (Word + Sense + Translation).
     */
    it('should create complete word successfully (TC-WORD-017)', async () => {
      // --- ARRANGE ---
      mockWordRepo.findOne.mockResolvedValue(null);
      mockWordRepo.create.mockReturnValue({ id: 10 });
      mockWordRepo.save.mockResolvedValue({ id: 10 });
      mockSenseRepo.create.mockReturnValue({ id: 20 });
      mockSenseRepo.save.mockResolvedValue({ id: 20 });
      mockTranslationRepo.create.mockReturnValue({});
      mockQueryBuilder.getRawOne.mockResolvedValue({ max: 0 });
      mockQueryBuilder.getOne.mockResolvedValue({ id: 10 });

      // --- ACT ---
      const result = await service.createComplete(dto);

      // --- ASSERT ---
      expect(mockWordRepo.save).toHaveBeenCalled();
      expect(mockSenseRepo.save).toHaveBeenCalled();
      expect(mockTranslationRepo.save).toHaveBeenCalled();
      expect(result.id).toBe(10);
    });

    /**
     * [TC-WORD-018] Tạo nghĩa mới cho từ vựng sẵn có.
     */
    it('should use existing wordId and only create sense/translation (TC-WORD-018)', async () => {
      // --- ARRANGE ---
      const dtoWithId = { ...dto, wordId: 5 };
      mockSenseRepo.create.mockReturnValue({ id: 20 });
      mockTranslationRepo.create.mockReturnValue({});
      mockQueryBuilder.getOne.mockResolvedValue({ id: 5 });

      // --- ACT ---
      await service.createComplete(dtoWithId);

      // --- ASSERT ---
      expect(mockWordRepo.save).not.toHaveBeenCalled();
      expect(mockSenseRepo.create).toHaveBeenCalledWith(expect.objectContaining({ wordId: 5 }));
    });


    /**
     * [TC-WORD-019] Thiếu thông tin định danh từ.
     */
    it('should throw BadRequestException if word data is missing (TC-WORD-019)', async () => {
      // --- ARRANGE ---
      const badDto = { sense: {}, translation: {} } as any;

      // --- ACT & ASSERT ---
      await expect(service.createComplete(badDto)).rejects.toThrow(BadRequestException);
    });

    /**
     * [TC-WORD-020] Xung đột chữ Hán khi tạo trọn gói.
     */
    it('should throw BadRequestException if word already exists (TC-WORD-020)', async () => {
      // --- ARRANGE ---
      mockWordRepo.findOne.mockResolvedValue({ id: 1 });

      // --- ACT & ASSERT ---
      await expect(service.createComplete(dto)).rejects.toThrow(BadRequestException);
    });

    /**
     * [TC-WORD-021] Ngôn ngữ mặc định cho bản dịch.
     */
    it('should default language to vn if missing (TC-WORD-021)', async () => {
      // --- ARRANGE ---
      const dtoNoLang = { ...dto, translation: { translation: 'tr' } };
      mockWordRepo.findOne.mockResolvedValue(null);
      mockWordRepo.save.mockResolvedValue({ id: 10 });
      mockSenseRepo.save.mockResolvedValue({ id: 20 });
      mockQueryBuilder.getOne.mockResolvedValue({});

      // --- ACT ---
      await service.createComplete(dtoNoLang);

      // --- ASSERT ---
      expect(mockTranslationRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ language: 'vn' }),
      );
    });
  });

  describe('updateCompleteBySenseId', () => {
    const senseId = 100;
    const dto = {
      word: { simplified: 'upd' },
      sense: { pinyin: 'upd sense' },
      translation: { translation: 'upd trans' },
    };

    /**
     * [TC-WORD-022] Cập nhật trọn gói theo SenseID.
     */
    it('should update complete word by senseId successfully (TC-WORD-022)', async () => {
      // --- ARRANGE ---
      const word = { id: 1, simplified: 'old' };
      const wordSense = {
        id: senseId,
        wordId: 1,
        word,
        translations: [{ language: 'vn', translation: 'old tr' }],
      };
      mockSenseRepo.findOne.mockResolvedValue(wordSense);
      mockWordRepo.findOne.mockResolvedValue(null);
      mockQueryBuilder.getOne.mockResolvedValue({ id: 1 });

      // --- ACT ---
      const result = await service.updateCompleteBySenseId(senseId, dto);

      // --- ASSERT ---
      expect(mockWordRepo.save).toHaveBeenCalled();
      expect(mockSenseRepo.save).toHaveBeenCalled();
      expect(mockTranslationRepo.save).toHaveBeenCalled();
      expect(result.id).toBe(1);
    });

    /**
     * [TC-WORD-023] SenseID không hợp lệ.
     */
    it('should throw NotFoundException if senseId is invalid (TC-WORD-023)', async () => {
      // --- ARRANGE ---
      mockSenseRepo.findOne.mockResolvedValue(null);

      // --- ACT & ASSERT ---
      await expect(service.updateCompleteBySenseId(999, dto)).rejects.toThrow(NotFoundException);
    });

    /**
     * [TC-WORD-024] Giữ nguyên chữ Hán khi cập nhật trọn gói.
     */
    it('should update successfully if simplified remains unchanged (TC-WORD-024)', async () => {
      // --- ARRANGE ---
      const word = { id: 1, simplified: 'upd' };
      const wordSense = { id: senseId, word, translations: [] };
      mockSenseRepo.findOne.mockResolvedValue(wordSense);

      // --- ACT ---
      await service.updateCompleteBySenseId(senseId, dto);

      // --- ASSERT ---
      expect(mockWordRepo.findOne).not.toHaveBeenCalled();
    });

    /**
     * [TC-WORD-025] Xung đột chữ Hán khi cập nhật trọn gói.
     */
    it('should throw BadRequestException on word conflict (TC-WORD-025)', async () => {
      // --- ARRANGE ---
      const word = { id: 1, simplified: 'old' };
      const wordSense = { id: senseId, word, translations: [] };
      mockSenseRepo.findOne.mockResolvedValue(wordSense);
      mockWordRepo.findOne.mockResolvedValue({ id: 2, simplified: 'upd' });

      // --- ACT & ASSERT ---
      await expect(service.updateCompleteBySenseId(senseId, dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    /**
     * [TC-WORD-026] Tạo mới bản dịch nếu chưa tồn tại cho ngôn ngữ mục tiêu.
     */
    it('should create new translation record if missing (TC-WORD-026)', async () => {
      // --- ARRANGE ---
      const wordSense = {
        id: senseId,
        wordId: 1,
        translations: [{ language: 'en', translation: 'eng' }],
      };
      mockSenseRepo.findOne.mockResolvedValue(wordSense);
      mockQueryBuilder.getOne.mockResolvedValue({});

      // --- ACT ---
      await service.updateCompleteBySenseId(senseId, { translation: { translation: 'vn tr' } });

      // --- ASSERT ---
      expect(mockTranslationRepo.create).toHaveBeenCalled();
      expect(mockTranslationRepo.save).toHaveBeenCalled();
    });
  });
});
