import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { WordsService } from './words.service';
import { Word } from './entities/word.entity';
import { WordSense } from './entities/word-sense.entity';
import { WordSenseTranslation } from './entities/word-sense-translation.entity';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { Repository, SelectQueryBuilder } from 'typeorm';

describe('WordsService', () => {
  let service: WordsService;
  let wordRepo: Repository<Word>;
  let senseRepo: Repository<WordSense>;
  let translationRepo: Repository<WordSenseTranslation>;

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
    wordRepo = module.get<Repository<Word>>(getRepositoryToken(Word));
    senseRepo = module.get<Repository<WordSense>>(getRepositoryToken(WordSense));
    translationRepo = module.get<Repository<WordSenseTranslation>>(
      getRepositoryToken(WordSenseTranslation),
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    /**
     * [TC-WORD-001] Kiểm tra chức năng khởi tạo một từ vựng mới trong hệ thống.
     * Kịch bản này xác nhận rằng khi dữ liệu đầu vào hợp lệ, service sẽ gọi repository để lưu trữ 
     * và trả về đối tượng từ vựng đã được gán ID thành công.
     */
    it('should create and save a new word successfully (TC-WORD-001)', async () => {
      const dto = { simplified: '测试', traditional: '測試', pinyin: 'cèshì' };
      const savedWord = { id: 1, ...dto };
      mockWordRepo.create.mockReturnValue(dto);
      mockWordRepo.save.mockResolvedValue(savedWord);

      const result = await service.create(dto);

      expect(result).toEqual(savedWord);
      expect(mockWordRepo.create).toHaveBeenCalledWith(dto);
      expect(mockWordRepo.save).toHaveBeenCalled(); // CheckDB
    });
  });

  describe('findAll', () => {
    /**
     * [TC-WORD-002] Kiểm tra chức năng tìm kiếm và phân trang từ vựng.
     * Xác nhận rằng khi truyền từ khóa tìm kiếm và các tham số phân trang, 
     * hệ thống trả về đúng danh sách dữ liệu, tổng số bản ghi và tính toán số trang chính xác.
     */
    it('should return paginated words with search filters successfully (TC-WORD-002)', async () => {
      const query = { search: 'test', page: 2, limit: 5 };
      const words = [{ id: 1, simplified: 'test' }];
      mockQueryBuilder.getManyAndCount.mockResolvedValue([words, 11]);

      const result = await service.findAll(query);

      expect(result.words).toEqual(words);
      expect(result.total).toBe(11);
      expect(result.page).toBe(2);
      expect(result.totalPages).toBe(3);
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('word.simplified'),
        { search: '%test%' },
      ); // CheckDB
    });

    /**
     * [TC-WORD-003] Kiểm tra tính năng phân trang mặc định của hệ thống.
     * Đảm bảo rằng khi người dùng không truyền tham số phân trang, 
     * hệ thống sẽ tự động áp dụng các giá trị mặc định (trang 1, giới hạn 10 bản ghi).
     */
    it('should return words using default pagination parameters when none provided (TC-WORD-003)', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);
      await service.findAll({});
      expect(mockQueryBuilder.skip).toHaveBeenCalledWith(0);
      expect(mockQueryBuilder.take).toHaveBeenCalledWith(10);
    });
  });

  describe('findById', () => {
    /**
     * [TC-WORD-004] Kiểm tra chức năng tìm kiếm từ vựng theo mã định danh (ID) duy nhất.
     * Đảm bảo hệ thống trả về đúng dữ liệu khi ID tồn tại trong cơ sở dữ liệu.
     */
    it('should return a word object when a valid ID is provided (TC-WORD-004)', async () => {
      const word = { id: 1, simplified: 'test' };
      mockQueryBuilder.getOne.mockResolvedValue(word);

      const result = await service.findById(1);

      expect(result).toEqual(word);
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('word.id = :id', { id: 1 });
    });

    /**
     * [TC-WORD-005] Kiểm tra xử lý ngoại lệ khi tra cứu từ vựng bằng ID không tồn tại.
     * Hệ thống phải ném ra lỗi NotFoundException để thông báo cho người dùng/API Client.
     */
    it('should throw NotFoundException when the provided ID does not exist (TC-WORD-005)', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(null);
      await expect(service.findById(99)).rejects.toThrow(NotFoundException);
    });
  });

  describe('findBySimplified', () => {
    /**
     * [TC-WORD-006] Truy vấn thông tin từ vựng dựa trên chữ Hán rút gọn (Simplified Chinese).
     * Kỳ vọng hệ thống trả về đúng thực thể từ vựng tương ứng khi tìm thấy trong cơ sở dữ liệu.
     */
    it('should return a word object when matching the simplified form (TC-WORD-006)', async () => {
      const word = { id: 1, simplified: 'test' };
      mockQueryBuilder.getOne.mockResolvedValue(word);

      const result = await service.findBySimplified('test');

      expect(result).toEqual(word);
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('word.simplified = :simplified', {
        simplified: 'test',
      });
    });

    /**
     * [TC-WORD-007] Kiểm tra xử lý khi tra cứu một chữ Hán không tồn tại trong hệ thống.
     * Hệ thống phải ném ra lỗi NotFoundException để bảo vệ tính nhất quán của dữ liệu.
     */
    it('should throw NotFoundException if the simplified form is not found (TC-WORD-007)', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(null);
      await expect(service.findBySimplified('none')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    /**
     * [TC-WORD-008] Kiểm tra chức năng cập nhật thông tin cho một từ vựng đã tồn tại.
     * Xác nhận rằng dữ liệu mới được ánh xạ đúng và hệ thống thực hiện lưu thay đổi vào repository.
     */
    it('should update and save the word changes successfully (TC-WORD-008)', async () => {
      const word = { id: 1, simplified: 'old' };
      const dto = { simplified: 'new' };
      mockQueryBuilder.getOne.mockResolvedValue(word);
      mockWordRepo.findOne.mockResolvedValue(null); // No conflict
      mockWordRepo.save.mockImplementation((w) => Promise.resolve(w));

      const result = await service.update(1, dto);

      expect(result.simplified).toBe('new');
      expect(mockWordRepo.save).toHaveBeenCalled(); // CheckDB
    });

    /**
     * [TC-WORD-009] Kiểm tra logic cập nhật khi người dùng giữ nguyên nội dung chữ Hán (Simplified).
     * Hệ thống không nên thực hiện kiểm tra trùng lặp (conflict check) nếu chữ Hán mới khớp với chữ Hán hiện tại.
     */
    it('should skip duplicate check when the simplified form remains unchanged (TC-WORD-009)', async () => {
      const word = { id: 1, simplified: 'same' };
      const dto = { simplified: 'same' };
      mockQueryBuilder.getOne.mockResolvedValue(word);

      await service.update(1, dto);
      expect(mockWordRepo.findOne).not.toHaveBeenCalled();
    });

    /**
     * [TC-WORD-010] Kiểm tra xử lý xung đột dữ liệu khi cập nhật chữ Hán bị trùng lặp với từ khác.
     * Nếu chữ Hán mới đã được dùng bởi một từ có ID khác, hệ thống phải ném lỗi BadRequestException.
     */
    it('should throw BadRequestException if the new simplified form already exists for another word (TC-WORD-010)', async () => {
      const word = { id: 1, simplified: 'old' };
      const dto = { simplified: 'exists' };
      mockQueryBuilder.getOne.mockResolvedValue(word);
      mockWordRepo.findOne.mockResolvedValue({ id: 2, simplified: 'exists' });

      await expect(service.update(1, dto)).rejects.toThrow(BadRequestException);
    });
  });

  describe('remove', () => {
    /**
     * [TC-WORD-011] Kiểm tra chức năng xóa một bản ghi từ vựng khỏi hệ thống.
     * Xác nhận rằng lệnh xóa thực sự được gọi thông qua repository khi tìm thấy thực thể hợp lệ.
     */
    it('should remove the word entity successfully when it exists (TC-WORD-011)', async () => {
      const word = { id: 1 };
      mockQueryBuilder.getOne.mockResolvedValue(word);
      await service.remove(1);
      expect(mockWordRepo.remove).toHaveBeenCalledWith(word); // CheckDB
    });
  });

  describe('getWordStats', () => {
    /**
     * [TC-WORD-012] Kiểm tra chức năng thống kê cơ bản của module từ vựng.
     * Xác nhận hệ thống trả về chính xác tổng số lượng từ vựng hiện có trong cơ sở dữ liệu.
     */
    it('should return the accurate total count of words in the system (TC-WORD-012)', async () => {
      mockWordRepo.count.mockResolvedValue(50);
      const result = await service.getWordStats();
      expect(result.total).toBe(50);
    });
  });

  describe('search', () => {
    /**
     * [TC-WORD-013] Kiểm tra logic tra cứu nhanh tình trạng tồn tại của một từ vựng.
     * Trường hợp từ vựng đã có trong hệ thống, kỳ vọng trả về trạng thái báo đã tồn tại.
     */
    it('should indicate that the word exists when it is found in the database (TC-WORD-013)', async () => {
      const word = { id: 1, simplified: 'test' };
      mockQueryBuilder.getOne.mockResolvedValue(word);
      const result = await service.search('test');
      expect(result.exists).toBe(true);
      expect(result.wordId).toBe(1);
    });

    /**
     * [TC-WORD-014] Kiểm tra logic tra cứu nhanh khi từ vựng hoàn toàn mới.
     * Kỳ vọng trả về trạng thái chưa tồn tại để có thể thực hiện quy trình tạo mới.
     */
    it('should indicate that the word does not exist when it is not found (TC-WORD-014)', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(null);
      const result = await service.search('none');
      expect(result.exists).toBe(false);
      expect(result.wordId).toBeNull();
    });
  });

  describe('getNextSenseNumber', () => {
    // [TC-WORD-015] Get next number when senses exist
    it('should return max+1 (TC-WORD-015)', async () => {
      mockQueryBuilder.getRawOne.mockResolvedValue({ max: 5 });
      const result = await service.getNextSenseNumber(1);
      expect(result).toBe(6);
    });

    // [TC-WORD-016] Get 1 when no senses exist
    it('should return 1 when no senses exist (TC-WORD-016)', async () => {
      mockQueryBuilder.getRawOne.mockResolvedValue(null);
      const result = await service.getNextSenseNumber(1);
      expect(result).toBe(1);
    });
  });

  describe('createComplete', () => {
    const dto = {
      word: { simplified: 'new' },
      sense: { pinyin: 'xin' },
      translation: { translation: 'tr', language: 'vn' },
    };

    /**
     * [TC-WORD-017] Kiểm tra chức năng khởi tạo từ vựng "trọn gói" lần đầu tiên.
     * Quy trình bao gồm tạo mới Word, sau đó tạo Sense tương ứng mẫu và cuối cùng là bản dịch.
     * Xác nhận tất cả các thành phần được lưu trữ đồng bộ.
     */
    it('should create a complete new word with sense and translation successfully (TC-WORD-017)', async () => {
      mockWordRepo.findOne.mockResolvedValue(null);
      mockWordRepo.create.mockReturnValue({ id: 10 });
      mockWordRepo.save.mockResolvedValue({ id: 10 });
      mockSenseRepo.create.mockReturnValue({ id: 20 });
      mockSenseRepo.save.mockResolvedValue({ id: 20 });
      mockTranslationRepo.create.mockReturnValue({});
      mockQueryBuilder.getRawOne.mockResolvedValue({ max: 0 });
      // Final findById call
      mockQueryBuilder.getOne.mockResolvedValue({ id: 10 });

      const result = await service.createComplete(dto);

      expect(mockWordRepo.save).toHaveBeenCalled();
      expect(mockSenseRepo.save).toHaveBeenCalled();
      expect(mockTranslationRepo.save).toHaveBeenCalled();
      expect(result.id).toBe(10);
    });

    /**
     * [TC-WORD-018] Kiểm tra tạo nghĩa mới trọn gói cho một từ vựng đã có sẵn trong hệ thống thông qua ID.
     * Trong kịch bản này, hệ thống sẽ bỏ qua bước tạo Word và chỉ tạo thêm Sense + Translation mới.
     */
    it('should use the existing wordId and only create sense/translation (TC-WORD-018)', async () => {
      const dtoWithId = { ...dto, wordId: 5 };
      mockSenseRepo.create.mockReturnValue({ id: 20 });
      mockTranslationRepo.create.mockReturnValue({});
      mockQueryBuilder.getOne.mockResolvedValue({ id: 5 });

      await service.createComplete(dtoWithId);

      expect(mockWordRepo.save).not.toHaveBeenCalled();
      expect(mockSenseRepo.create).toHaveBeenCalledWith(expect.objectContaining({ wordId: 5 }));
    });

    /**
     * [TC-WORD-019] Kiểm tra tính hợp lệ của dữ liệu đầu vào cho quy trình tạo trọn gói.
     * Hệ thống phải ném lỗi BadRequestException nếu thiếu hoàn toàn cả mã ID từ vựng và dữ liệu chữ Hán để tạo mới.
     */
    it('should throw BadRequestException if both wordId and word data are missing (TC-WORD-019)', async () => {
      const badDto = { sense: {}, translation: {} } as any;
      await expect(service.createComplete(badDto)).rejects.toThrow(BadRequestException);
    });

    /**
     * [TC-WORD-020] Kiểm tra xung đột chữ Hán khi thực hiện tạo mới trọn gói.
     * Nếu chữ Hán định tạo đã tồn tại, hệ thống phải ngăn chặn và báo lỗi để tránh trùng lặp dư thừa.
     */
    it('should throw BadRequestException if trying to create a word with an existing simplified form (TC-WORD-020)', async () => {
      mockWordRepo.findOne.mockResolvedValue({ id: 1 });
      await expect(service.createComplete(dto)).rejects.toThrow(BadRequestException);
    });

    /**
     * [TC-WORD-021] Kiểm tra cơ chế tự động gán ngôn ngữ mặc định trong quy trình tạo trọn gói.
     * Nếu bản dịch không khai báo ngôn ngữ, hệ thống sẽ mặc định gán là tiếng Việt ('vn').
     */
    it('should default the translation language to "vn" if not explicitly provided (TC-WORD-021)', async () => {
      const dtoNoLang = { ...dto, translation: { translation: 'tr' } };
      mockWordRepo.findOne.mockResolvedValue(null);
      mockWordRepo.save.mockResolvedValue({ id: 10 });
      mockSenseRepo.save.mockResolvedValue({ id: 20 });
      mockQueryBuilder.getOne.mockResolvedValue({});

      await service.createComplete(dtoNoLang);
      expect(mockTranslationRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ language: 'vn' }),
      );
    });
  });

  describe('updateCompleteBySenseId', () => {
    const senseId = 100;
    const dto = {
      word: { simplified: 'upd' },
      sense: { pinyin: 'upd pinyin' },
      translation: { translation: 'new tr' },
    };

    /**
     * [TC-WORD-022] Kiểm tra quy trình cập nhật đồng thời (All-in-one) thông qua mã ID nghĩa của từ.
     * Quy trình này cho phép thực hiện nhiều thay đổi (Word, Sense và cả Translation) chỉ bằng một lần gọi API.
     * Xác nhận tính đồng bộ của dữ liệu sau cập nhật.
     */
    it('should update word, sense and existing translation successfully via senseId (TC-WORD-022)', async () => {
      const word = { id: 1, simplified: 'old' };
      const wordSense = {
        id: senseId,
        wordId: 1,
        word,
        translations: [{ language: 'vn', translation: 'old tr' }],
      };
      mockSenseRepo.findOne.mockResolvedValue(wordSense);
      mockWordRepo.findOne.mockResolvedValue(null); // No word conflict
      mockQueryBuilder.getOne.mockResolvedValue({ id: 1 }); // Final findById

      const result = await service.updateCompleteBySenseId(senseId, dto);

      expect(mockWordRepo.save).toHaveBeenCalled();
      expect(mockSenseRepo.save).toHaveBeenCalled();
      expect(mockTranslationRepo.save).toHaveBeenCalled();
      expect(result.id).toBe(1);
    });

    /**
     * [TC-WORD-023] Kiểm tra xử lý ngoại lệ khi cung cấp mã nghĩa không tồn tại để cập nhật trọn gói.
     * Hệ thống phải ném lỗi NotFoundException để bảo vệ quy trình nghiệp vụ.
     */
    it('should throw NotFoundException during complete update if the senseId is invalid (TC-WORD-023)', async () => {
      mockSenseRepo.findOne.mockResolvedValue(null);
      await expect(service.updateCompleteBySenseId(999, dto)).rejects.toThrow(NotFoundException);
    });

    /**
     * [TC-WORD-024] Kiểm tra logic cập nhật "Word" thông qua quy trình trọn gói mà không làm thay đổi chữ Hán.
     * Đảm bảo hệ thống không báo lỗi xung đột nếu nội dung cập nhật trùng khớp với dữ liệu gốc của từ vựng đó.
     */
    it('should successfully update the word if the simplified form remains unchanged in the complete update (TC-WORD-024)', async () => {
      const word = { id: 1, simplified: 'upd' };
      const wordSense = { id: senseId, word, translations: [] };
      mockSenseRepo.findOne.mockResolvedValue(wordSense);

      await service.updateCompleteBySenseId(senseId, dto);
      expect(mockWordRepo.findOne).not.toHaveBeenCalled();
    });

    /**
     * [TC-WORD-025] Kiểm tra xử lý xung đột chữ Hán trong quy trình cập nhật trọn gói.
     * Nếu thay đổi chữ Hán bị trùng lặp với một từ vựng khác sẵn có, hệ thống phải ngăn chặn hành động cập nhật.
     */
    it('should throw BadRequestException if updating the word form leads to a conflict during complete update (TC-WORD-025)', async () => {
      const word = { id: 1, simplified: 'old' };
      const wordSense = { id: senseId, word, translations: [] };
      mockSenseRepo.findOne.mockResolvedValue(wordSense);
      mockWordRepo.findOne.mockResolvedValue({ id: 2, simplified: 'upd' });

      await expect(service.updateCompleteBySenseId(senseId, dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    /**
     * [TC-WORD-026] Kiểm tra khả năng tạo mới thành phần thiếu sót trong quá trình cập nhật trọn gói.
     * Trường hợp bản dịch cho ngôn ngữ mục tiêu (ví dụ 'vn') chưa tồn tại, hệ thống phải tự động tạo mới thay vì báo lỗi.
     */
    it('should create a new translation record if it does not exist for the target language (TC-WORD-026)', async () => {
      const wordSense = {
        id: senseId,
        wordId: 1,
        translations: [{ language: 'en', translation: 'eng' }],
      };
      mockSenseRepo.findOne.mockResolvedValue(wordSense);
      mockQueryBuilder.getOne.mockResolvedValue({});

      await service.updateCompleteBySenseId(senseId, { translation: { translation: 'vn tr' } });
      expect(mockTranslationRepo.create).toHaveBeenCalled();
      expect(mockTranslationRepo.save).toHaveBeenCalled();
    });
  });
});
