import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { WordSensesService } from './word-senses.service';
import { WordSense } from './entities/word-sense.entity';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { Repository } from 'typeorm';

describe('WordSensesService', () => {
  let service: WordSensesService;
  let repository: Repository<WordSense>;

  // Giả lập QueryBuilder để kiểm tra các hàm nâng cao (findAll, getWordSenseStats)
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
    // [Rollback] Xóa toàn bộ giả lập sau mỗi test case
    jest.clearAllMocks();
  });

  describe('getNextSenseNumber', () => {
    // [TC-SENSE-001] Lấy số thứ tự nghĩa tiếp theo khi đã có dữ liệu
    it('nên trả về giá trị max + 1 nếu đã có nghĩa (TC-SENSE-001)', async () => {
      mockQueryBuilder.getRawOne.mockResolvedValue({ max: 5 });
      const result = await service.getNextSenseNumber(1);
      expect(result).toBe(6);
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('wordSense.wordId = :wordId', { wordId: 1 });
    });

    // [TC-SENSE-002] Lấy số thứ tự nghĩa tiếp theo khi chưa có dữ liệu
    it('nên trả về 1 nếu chưa có nghĩa nào (TC-SENSE-002)', async () => {
      mockQueryBuilder.getRawOne.mockResolvedValue(null);
      const result = await service.getNextSenseNumber(1);
      expect(result).toBe(1);
    });
  });

  describe('create', () => {
    // [TC-SENSE-003] Tạo mới một nghĩa thành công
    it('nên tạo và lưu nghĩa mới (TC-SENSE-003)', async () => {
      const dto = { wordId: 1, pinyin: 'test' };
      const savedSense = { id: 10, ...dto, senseNumber: 1 };
      
      mockQueryBuilder.getRawOne.mockResolvedValue({ max: 0 });
      mockWordSensesRepo.create.mockReturnValue(savedSense);
      mockWordSensesRepo.save.mockResolvedValue(savedSense);

      const result = await service.create(dto as any);

      expect(result).toEqual(savedSense);
      // [CheckDB] Xác nhận repository đã được gọi để lưu
      expect(mockWordSensesRepo.save).toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    // [TC-SENSE-004] Tìm kiếm nghĩa với đầy đủ bộ lọc và phân trang
    it('nên trả về danh sách nghĩa với đầy đủ filter (TC-SENSE-004)', async () => {
      const query = {
        wordId: 1,
        search: 'pi',
        hskLevel: 3,
        partOfSpeech: 'noun',
        page: 2,
        limit: 5
      };
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 10]);

      const result = await service.findAll(query);

      expect(result.total).toBe(10);
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledTimes(4);
      expect(mockQueryBuilder.skip).toHaveBeenCalledWith(5);
    });

    // [TC-SENSE-005] Tìm kiếm nghĩa với tham số mặc định
    it('nên dùng tham số mặc định khi không truyền query (TC-SENSE-005)', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);
      await service.findAll({});
      expect(mockQueryBuilder.skip).toHaveBeenCalledWith(0);
      expect(mockQueryBuilder.take).toHaveBeenCalledWith(10);
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith('wordSense.id', 'ASC');
    });
  });

  describe('findById', () => {
    // [TC-SENSE-006] Tìm nghĩa theo ID thành công
    it('nên trả về nghĩa khi tìm thấy (TC-SENSE-006)', async () => {
      const sense = { id: 1 };
      mockWordSensesRepo.findOne.mockResolvedValue(sense);

      const result = await service.findById(1);

      expect(result).toEqual(sense);
      expect(mockWordSensesRepo.findOne).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 1 } }));
    });

    // [TC-SENSE-007] Lỗi khi không tìm thấy nghĩa theo ID
    it('nên báo lỗi NotFoundException khi không tìm thấy (TC-SENSE-007)', async () => {
      mockWordSensesRepo.findOne.mockResolvedValue(null);
      await expect(service.findById(99)).rejects.toThrow(NotFoundException);
    });
  });

  describe('findByWordId', () => {
    // [TC-SENSE-008] Tìm danh sách nghĩa theo Word ID
    it('nên trả về danh sách nghĩa của một từ (TC-SENSE-008)', async () => {
      const senses = [{ id: 1 }];
      mockWordSensesRepo.find.mockResolvedValue(senses);

      const result = await service.findByWordId(1);

      expect(result).toEqual(senses);
      expect(mockWordSensesRepo.find).toHaveBeenCalledWith(expect.objectContaining({ where: { wordId: 1 } }));
    });
  });

  describe('update', () => {
    // [TC-SENSE-009] Cập nhật nghĩa thành công
    it('nên cập nhật và lưu nghĩa (TC-SENSE-009)', async () => {
      const sense = { id: 1, senseNumber: 1, wordId: 1 };
      const dto = { pinyin: 'updated' };
      mockWordSensesRepo.findOne.mockResolvedValue(sense);
      mockWordSensesRepo.save.mockImplementation(s => Promise.resolve(s));

      const result = await service.update(1, dto);

      expect(result.pinyin).toBe('updated');
      expect(mockWordSensesRepo.save).toHaveBeenCalled();
    });

    // [TC-SENSE-010] Cập nhật mà không thay đổi senseNumber (không check trùng)
    it('nên cập nhật bình thường nếu không đổi senseNumber (TC-SENSE-010)', async () => {
      const sense = { id: 1, senseNumber: 1, wordId: 1 };
      const dto = { senseNumber: 1 };
      mockWordSensesRepo.findOne.mockResolvedValue(sense);
      
      await service.update(1, dto);
      expect(mockWordSensesRepo.findOne).toHaveBeenCalledTimes(1); // Chỉ gọi findById, không gọi check tồn tại
    });

    // [TC-SENSE-011] Lỗi khi cập nhật senseNumber bị trùng lặp
    it('nên báo lỗi BadRequestException nếu đổi senseNumber bị trùng (TC-SENSE-011)', async () => {
      const sense = { id: 1, senseNumber: 1, wordId: 1 };
      const dto = { senseNumber: 2 };
      mockWordSensesRepo.findOne
        .mockResolvedValueOnce(sense) // Trả về cho hàm findById
        .mockResolvedValueOnce({ id: 2, senseNumber: 2 }); // Trả về cho check trùng

      await expect(service.update(1, dto)).rejects.toThrow(BadRequestException);
    });
  });

  describe('remove', () => {
    // [TC-SENSE-012] Xóa nghĩa thành công
    it('nên xóa nghĩa khi tìm thấy (TC-SENSE-012)', async () => {
      const sense = { id: 1 };
      mockWordSensesRepo.findOne.mockResolvedValue(sense);
      await service.remove(1);
      // [CheckDB] Xác nhận lệnh remove đã được gọi
      expect(mockWordSensesRepo.remove).toHaveBeenCalledWith(sense);
    });
  });

  describe('getWordSenseStats', () => {
    // [TC-SENSE-013] Lấy thông tin thống kê về các nghĩa
    it('nên trả về đầy đủ thông tin thống kê (TC-SENSE-013)', async () => {
      mockWordSensesRepo.count.mockResolvedValue(100);
      mockQueryBuilder.getRawMany.mockResolvedValue([{ level: 1, total: 10 }]);

      const result = await service.getWordSenseStats();

      expect(result.total).toBe(100);
      expect(result.primary).toBe(100);
      expect(result.hskLevelDistribution).toEqual([{ level: 1, total: 10 }]);
      expect(mockWordSensesRepo.count).toHaveBeenCalledTimes(2);
    });
  });
});
