import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { WordSensesService } from './word-senses.service';
import { WordSense } from './entities/word-sense.entity';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { Repository } from 'typeorm';

describe('WordSensesService', () => {
  let service: WordSensesService;
  let repository: Repository<WordSense>;

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
    getRawOne: jest.fn(),
    getRawMany: jest.fn(),
  };

  const mockWordSensesRepo = {
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
        WordSensesService,
        {
          provide: getRepositoryToken(WordSense),
          useValue: mockWordSensesRepo,
        },
      ],
    }).compile();

    service = module.get<WordSensesService>(WordSensesService);
    repository = module.get<Repository<WordSense>>(getRepositoryToken(WordSense));
  });

  afterEach(() => {
    // --- ROLLBACK ---
    // Xóa bỏ tất cả các bản ghi cuộc gọi của Mock để tránh ảnh hưởng chéo giữa các test case.
    jest.clearAllMocks();
  });

  describe('getNextSenseNumber', () => {
    /**
     * [TC-SENSE-001] Lấy số thứ tự nghĩa tiếp theo.
     * Mục tiêu: Xác nhận hệ thống lấy giá trị max hiện tại cộng thêm 1.
     */
    it('should return max + 1 if senses already exist (TC-SENSE-001)', async () => {
      // --- ARRANGE ---
      // Giả lập SQL SELECT MAX(senseNumber) trả về 5.
      mockQueryBuilder.getRawOne.mockResolvedValue({ max: 5 });

      // --- ACT ---
      const result = await service.getNextSenseNumber(1);

      // --- ASSERT ---
      // Kết quả kỳ vọng: 5 + 1 = 6.
      expect(result).toBe(6);
      // [CheckDB] Xác nhận query lọc đúng theo mã từ vựng (wordId).
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('wordSense.wordId = :wordId', { wordId: 1 });
    });

    /**
     * [TC-SENSE-002] Lấy số thứ tự cho nghĩa đầu tiên của một từ mới.
     * Mục tiêu: Trả về 1 khi chưa có dữ liệu.
     */
    it('should return 1 if no senses exist for the word (TC-SENSE-002)', async () => {
      // --- ARRANGE ---
      // Giả lập DB trả về null (chưa có bản ghi nào).
      mockQueryBuilder.getRawOne.mockResolvedValue(null);

      // --- ACT ---
      const result = await service.getNextSenseNumber(1);

      // --- ASSERT ---
      expect(result).toBe(1);
    });
  });

  describe('create', () => {
    /**
     * [TC-SENSE-003] Khởi tạo một nghĩa (sense) mới.
     * Mục tiêu: Xác nhận hệ thống tự động tính senseNumber và lưu vào repository.
     */
    it('should create and save a new word sense successfully (TC-SENSE-003)', async () => {
      // --- ARRANGE ---
      const dto = { wordId: 1, pinyin: 'test' };
      // Kết quả kỳ vọng sau khi xử lý: senseNumber được gán là 1.
      const savedSense = { id: 10, ...dto, senseNumber: 1 };
      
      mockQueryBuilder.getRawOne.mockResolvedValue({ max: 0 });
      mockWordSensesRepo.create.mockReturnValue(savedSense);
      mockWordSensesRepo.save.mockResolvedValue(savedSense);

      // --- ACT ---
      const result = await service.create(dto as any);

      // --- ASSERT ---
      expect(result).toEqual(savedSense);
      // [CheckDB] Đảm bảo repo.save được gọi để thực hiện INSERT.
      expect(mockWordSensesRepo.save).toHaveBeenCalled();
    });

    /**
     * [TC-SENSE-003b] Lỗi khi tạo nghĩa cho một từ vựng không tồn tại (FAILING TEST).
     * Mục tiêu: Cảnh báo việc thiếu kiểm tra sự tồn tại của từ vựng (Word) trước khi tạo nghĩa (Sense).
     */
    it('should throw NotFoundException if wordId does not exist (TC-SENSE-003b)', async () => {
      // --- ARRANGE ---
      const dto = { wordId: 999, pinyin: 'test' };
      // Giả lập getNextSenseNumber chạy bình thường (trả về 1) vì nó không kiểm tra wordId
      mockQueryBuilder.getRawOne.mockResolvedValue({ max: 0 });

      // --- ACT & ASSERT ---
      // BÀI TEST NÀY SẼ FAIL: Do hàm create hiện tại lưu luôn dữ liệu mà không kiểm tra wordId có thật không
      await expect(service.create(dto as any)).rejects.toThrow(NotFoundException);
    });
  });

  describe('findAll', () => {
    /**
     * [TC-SENSE-004] Tìm kiếm nghĩa với đầy đủ bộ lọc.
     * Mục tiêu: Xác nhận QueryBuilder áp dụng đúng các điều kiện WHERE và phân trang.
     */
    it('should return sense list with all filters applied (TC-SENSE-004)', async () => {
      // --- ARRANGE ---
      const query = {
        wordId: 1,
        search: 'pi',
        hskLevel: 3,
        partOfSpeech: 'noun',
        page: 2,
        limit: 5
      };
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 10]);

      // --- ACT ---
      const result = await service.findAll(query);

      // --- ASSERT ---
      expect(result.total).toBe(10);
      // [CheckDB] Đảm bảo 4 điều kiện andWhere (wordId, search, hsk, pos) được gọi.
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledTimes(4);
      // skip = (2-1)*5 = 5.
      expect(mockQueryBuilder.skip).toHaveBeenCalledWith(5);
    });

    /**
     * [TC-SENSE-005] Phân trang mặc định cho danh sách nghĩa.
     */
    it('should use default pagination when no query parameters provided (TC-SENSE-005)', async () => {
      // --- ARRANGE ---
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      // --- ACT ---
      await service.findAll({});

      // --- ASSERT ---
      // skip = 0, take = 10.
      expect(mockQueryBuilder.skip).toHaveBeenCalledWith(0);
      expect(mockQueryBuilder.take).toHaveBeenCalledWith(10);
    });
  });

  describe('findById', () => {
    /**
     * [TC-SENSE-006] Truy vấn nghĩa theo ID.
     */
    it('should return word sense object when ID is valid (TC-SENSE-006)', async () => {
      // --- ARRANGE ---
      const sense = { id: 1 };
      mockWordSensesRepo.findOne.mockResolvedValue(sense);

      // --- ACT ---
      const result = await service.findById(1);

      // --- ASSERT ---
      expect(result).toEqual(sense);
      // [CheckDB] Đảm bảo gọi repo.findOne với đúng filter ID.
      expect(mockWordSensesRepo.findOne).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 1 } }));
    });

    /**
     * [TC-SENSE-007] Xử lý ID nghĩa không tồn tại.
     */
    it('should throw NotFoundException if ID does not exist (TC-SENSE-007)', async () => {
      // --- ARRANGE ---
      mockWordSensesRepo.findOne.mockResolvedValue(null);

      // --- ACT & ASSERT ---
      await expect(service.findById(99)).rejects.toThrow(NotFoundException);
    });
  });

  describe('findByWordId', () => {
    /**
     * [TC-SENSE-008] Lấy danh sách nghĩa của một từ vựng.
     */
    it('should return all senses for a specific wordId (TC-SENSE-008)', async () => {
      // --- ARRANGE ---
      const senses = [{ id: 1 }];
      mockWordSensesRepo.find.mockResolvedValue(senses);

      // --- ACT ---
      const result = await service.findByWordId(1);

      // --- ASSERT ---
      expect(result).toEqual(senses);
      expect(mockWordSensesRepo.find).toHaveBeenCalledWith(expect.objectContaining({ where: { wordId: 1 } }));
    });

    /**
     * [TC-SENSE-008b] Lỗi khi truy vấn danh sách nghĩa của từ vựng không tồn tại (FAILING TEST).
     * Mục tiêu: Đảm bảo trả về lỗi 404 thay vì mảng rỗng [] khi truy cập sai ID thực thể cha.
     */
    it('should throw NotFoundException if wordId does not exist (TC-SENSE-008b)', async () => {
      // --- ARRANGE ---
      // Giả lập TypeORM find trả về mảng rỗng khi không tìm thấy
      mockWordSensesRepo.find.mockResolvedValue([]);

      // --- ACT & ASSERT ---
      // BÀI TEST NÀY SẼ FAIL: Hàm hiện tại return [] thay vì throw NotFoundException
      await expect(service.findByWordId(999)).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    /**
     * [TC-SENSE-009] Cập nhật thông tin nghĩa thành công.
     */
    it('should update and save sense changes (TC-SENSE-009)', async () => {
      // --- ARRANGE ---
      const sense = { id: 1, senseNumber: 1, wordId: 1 };
      const dto = { pinyin: 'updated' };
      mockWordSensesRepo.findOne.mockResolvedValue(sense);
      mockWordSensesRepo.save.mockImplementation(s => Promise.resolve(s));

      // --- ACT ---
      const result = await service.update(1, dto);

      // --- ASSERT ---
      expect(result.pinyin).toBe('updated');
      // [CheckDB] Đảm bảo lệnh save được gọi để ghi thay đổi.
      expect(mockWordSensesRepo.save).toHaveBeenCalled();
    });

    /**
     * [TC-SENSE-010] Lỗi trùng lặp senseNumber khi cập nhật.
     * Mục tiêu: Đảm bảo một từ không có 2 nghĩa trùng số thứ tự.
     */
    it('should throw BadRequestException if senseNumber conflict occurs (TC-SENSE-010)', async () => {
      // --- ARRANGE ---
      const sense = { id: 1, senseNumber: 1, wordId: 1 };
      const dto = { senseNumber: 2 };
      // Lần 1: tìm thấy nghĩa cũ. Lần 2: tìm thấy nghĩa khác đã mang số 2.
      mockWordSensesRepo.findOne
        .mockResolvedValueOnce(sense)
        .mockResolvedValueOnce({ id: 2, senseNumber: 2 });

      // --- ACT & ASSERT ---
      await expect(service.update(1, dto)).rejects.toThrow(BadRequestException);
    });
  });

  describe('remove', () => {
    /**
     * [TC-SENSE-011] Xóa bỏ một nghĩa.
     */
    it('should remove sense entity successfully (TC-SENSE-011)', async () => {
      // --- ARRANGE ---
      const sense = { id: 1 };
      mockWordSensesRepo.findOne.mockResolvedValue(sense);

      // --- ACT ---
      await service.remove(1);

      // --- ASSERT ---
      // [CheckDB] Xác nhận repo.remove được gọi.
      expect(mockWordSensesRepo.remove).toHaveBeenCalledWith(sense);
    });
  });

  describe('getWordSenseStats', () => {
    /**
     * [TC-SENSE-012] Thống kê tổng hợp về các nghĩa.
     */
    it('should return comprehensive stats including HSK distribution (TC-SENSE-012)', async () => {
      // --- ARRANGE ---
      // Lần 1: Tổng 100 nghĩa. Lần 2: 60 nghĩa chính.
      mockWordSensesRepo.count
        .mockResolvedValueOnce(100)
        .mockResolvedValueOnce(60);

      mockQueryBuilder.getRawMany
        .mockResolvedValueOnce([{ level: 1, total: 10 }])
        .mockResolvedValueOnce([{ pos: 'noun', total: 50 }]);

      // --- ACT ---
      const result = await service.getWordSenseStats();

      // --- ASSERT ---
      expect(result.total).toBe(100);
      expect(result.primary).toBe(60);
      expect(result.hskLevelDistribution).toEqual([{ level: 1, total: 10 }]);
      expect(mockWordSensesRepo.count).toHaveBeenCalledTimes(2);
    });
  });
});
