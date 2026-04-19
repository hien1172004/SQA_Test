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
    // [TC-WORD-001] Verify successful creation of a word
    it('should create and save a new word (TC-WORD-001)', async () => {
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
    // [TC-WORD-002] Get all words with pagination and filters
    it('should return paginated words with search term (TC-WORD-002)', async () => {
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

    // [TC-WORD-003] Get all words with default parameters
    it('should return words with default pagination (TC-WORD-003)', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);
      await service.findAll({});
      expect(mockQueryBuilder.skip).toHaveBeenCalledWith(0);
      expect(mockQueryBuilder.take).toHaveBeenCalledWith(10);
    });
  });

  describe('findById', () => {
    // [TC-WORD-004] Find word by valid ID
    it('should return a word when found (TC-WORD-004)', async () => {
      const word = { id: 1, simplified: 'test' };
      mockQueryBuilder.getOne.mockResolvedValue(word);

      const result = await service.findById(1);

      expect(result).toEqual(word);
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('word.id = :id', { id: 1 });
    });

    // [TC-WORD-005] Throw NotFoundException if word does not exist
    it('should throw NotFoundException when word not found (TC-WORD-005)', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(null);
      await expect(service.findById(99)).rejects.toThrow(NotFoundException);
    });
  });

  describe('findBySimplified', () => {
    // [TC-WORD-006] Find word by simplified form
    it('should return a word by simplified form (TC-WORD-006)', async () => {
      const word = { id: 1, simplified: 'test' };
      mockQueryBuilder.getOne.mockResolvedValue(word);

      const result = await service.findBySimplified('test');

      expect(result).toEqual(word);
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('word.simplified = :simplified', {
        simplified: 'test',
      });
    });

    // [TC-WORD-007] Throw NotFoundException if simplified form not found
    it('should throw NotFoundException when word by simplified not found (TC-WORD-007)', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(null);
      await expect(service.findBySimplified('none')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    // [TC-WORD-008] Successfully update a word
    it('should update and save the word (TC-WORD-008)', async () => {
      const word = { id: 1, simplified: 'old' };
      const dto = { simplified: 'new' };
      mockQueryBuilder.getOne.mockResolvedValue(word);
      mockWordRepo.findOne.mockResolvedValue(null); // No conflict
      mockWordRepo.save.mockImplementation((w) => Promise.resolve(w));

      const result = await service.update(1, dto);

      expect(result.simplified).toBe('new');
      expect(mockWordRepo.save).toHaveBeenCalled(); // CheckDB
    });

    // [TC-WORD-009] Update without simplified conflict
    it('should update when simplified is same as current (TC-WORD-009)', async () => {
      const word = { id: 1, simplified: 'same' };
      const dto = { simplified: 'same' };
      mockQueryBuilder.getOne.mockResolvedValue(word);

      await service.update(1, dto);
      expect(mockWordRepo.findOne).not.toHaveBeenCalled();
    });

    // [TC-WORD-010] Throw BadRequestException on conflict
    it('should throw BadRequestException if simplified exists (TC-WORD-010)', async () => {
      const word = { id: 1, simplified: 'old' };
      const dto = { simplified: 'exists' };
      mockQueryBuilder.getOne.mockResolvedValue(word);
      mockWordRepo.findOne.mockResolvedValue({ id: 2, simplified: 'exists' });

      await expect(service.update(1, dto)).rejects.toThrow(BadRequestException);
    });
  });

  describe('remove', () => {
    // [TC-WORD-011] Successfully remove a word
    it('should remove the word when found (TC-WORD-011)', async () => {
      const word = { id: 1 };
      mockQueryBuilder.getOne.mockResolvedValue(word);
      await service.remove(1);
      expect(mockWordRepo.remove).toHaveBeenCalledWith(word); // CheckDB
    });
  });

  describe('getWordStats', () => {
    // [TC-WORD-012] Get word statistics
    it('should return total word count (TC-WORD-012)', async () => {
      mockWordRepo.count.mockResolvedValue(50);
      const result = await service.getWordStats();
      expect(result.total).toBe(50);
    });
  });

  describe('search', () => {
    // [TC-WORD-013] Search when word exists
    it('should return exists: true when word found (TC-WORD-013)', async () => {
      const word = { id: 1, simplified: 'test' };
      mockQueryBuilder.getOne.mockResolvedValue(word);
      const result = await service.search('test');
      expect(result.exists).toBe(true);
      expect(result.wordId).toBe(1);
    });

    // [TC-WORD-014] Search when word does not exist
    it('should return exists: false when word not found (TC-WORD-014)', async () => {
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

    // [TC-WORD-017] Create complete with new word
    it('should create new word, sense and translation (TC-WORD-017)', async () => {
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

    // [TC-WORD-018] Create complete with existing wordId
    it('should use existing wordId (TC-WORD-018)', async () => {
      const dtoWithId = { ...dto, wordId: 5 };
      mockSenseRepo.create.mockReturnValue({ id: 20 });
      mockTranslationRepo.create.mockReturnValue({});
      mockQueryBuilder.getOne.mockResolvedValue({ id: 5 });

      await service.createComplete(dtoWithId);

      expect(mockWordRepo.save).not.toHaveBeenCalled();
      expect(mockSenseRepo.create).toHaveBeenCalledWith(expect.objectContaining({ wordId: 5 }));
    });

    // [TC-WORD-019] Throw BadRequestException if no wordId and no word data
    it('should throw error if wordId is missing and word data is missing (TC-WORD-019)', async () => {
      const badDto = { sense: {}, translation: {} } as any;
      await expect(service.createComplete(badDto)).rejects.toThrow(BadRequestException);
    });

    // [TC-WORD-020] Throw BadRequestException if simplified already exists
    it('should throw error if creating new word but simplified exists (TC-WORD-020)', async () => {
      mockWordRepo.findOne.mockResolvedValue({ id: 1 });
      await expect(service.createComplete(dto)).rejects.toThrow(BadRequestException);
    });

    // [TC-WORD-021] Use default language if not provided
    it('should use "vn" as default language (TC-WORD-021)', async () => {
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

    // [TC-WORD-022] Update complete when sense and translation found
    it('should update word, sense and existing vn translation (TC-WORD-022)', async () => {
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

    // [TC-WORD-023] Throw NotFoundException if sense not found
    it('should throw NotFoundException if sense not found (TC-WORD-023)', async () => {
      mockSenseRepo.findOne.mockResolvedValue(null);
      await expect(service.updateCompleteBySenseId(999, dto)).rejects.toThrow(NotFoundException);
    });

    // [TC-WORD-024] Update word without conflict (same simplified)
    it('should update word if simplified is same as current (TC-WORD-024)', async () => {
      const word = { id: 1, simplified: 'upd' };
      const wordSense = { id: senseId, word, translations: [] };
      mockSenseRepo.findOne.mockResolvedValue(wordSense);

      await service.updateCompleteBySenseId(senseId, dto);
      expect(mockWordRepo.findOne).not.toHaveBeenCalled();
    });

    // [TC-WORD-025] Throw BadRequestException on word conflict
    it('should throw error if update simplified to existing other word (TC-WORD-025)', async () => {
      const word = { id: 1, simplified: 'old' };
      const wordSense = { id: senseId, word, translations: [] };
      mockSenseRepo.findOne.mockResolvedValue(wordSense);
      mockWordRepo.findOne.mockResolvedValue({ id: 2, simplified: 'upd' });

      await expect(service.updateCompleteBySenseId(senseId, dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    // [TC-WORD-026] Create new translation if "vn" missing
    it('should create new translation if "vn" exists but for other language (TC-WORD-026)', async () => {
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
