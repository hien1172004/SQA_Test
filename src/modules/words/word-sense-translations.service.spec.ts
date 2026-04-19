import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { WordSenseTranslationsService } from './word-sense-translations.service';
import { WordSenseTranslation } from './entities/word-sense-translation.entity';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { Repository } from 'typeorm';

describe('WordSenseTranslationsService', () => {
  let service: WordSenseTranslationsService;
  let repository: Repository<WordSenseTranslation>;

  /**
   * Cấu hình giả lập (Mock) cho QueryBuilder của TypeORM.
   * Điều này cho phép chúng ta kiểm tra các truy vấn phức tạp như findAll và getTranslationStats
   * mà không cần kết nối tới cơ sở dữ liệu thật.
   */
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

  /**
   * Cấu hình giả lập (Mock) cho Repository của WordSenseTranslation.
   * Tất cả các phương thức tương tác với DB sẽ được trích xuất để kiểm tra sau này (CheckDB).
   */
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
    // Thiết lập module kiểm thử ảo của NestJS
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
    /**
     * [Rollback] Xóa bỏ tất cả các bản ghi cuộc gọi của Mock.
     * Đảm bảo rằng mỗi test case bắt đầu với một trạng thái hoàn toàn sạch,
     * tránh việc kết quả của test case này ảnh hưởng đến test case khác.
     */
    jest.clearAllMocks();
  });

  describe('create', () => {
    const dto = { wordSenseId: 1, language: 'en', translation: 'Hello' };

    /**
     * [TC-TRANS-001] Kiểm tra quy trình đăng ký một bản dịch mới cho một "nghĩa" (word sense) cụ thể.
     * Xác nhận rằng khi ngôn ngữ cung cấp chưa tồn tại trong danh sách dịch của nghĩa đó, hệ thống sẽ 
     * thực hiện tạo mới và lưu trữ bản dịch vào cơ sở dữ liệu thành công.
     */
    it('should create and save a new translation when the target language does not exist for this sense (TC-TRANS-001)', async () => {
      // Giả lập: Không tìm thấy bản dịch trùng lặp
      mockTranslationRepo.findOne.mockResolvedValue(null);
      mockTranslationRepo.create.mockReturnValue(dto);
      mockTranslationRepo.save.mockResolvedValue({ id: 1, ...dto });

      const result = await service.create(dto);

      expect(result.id).toBe(1);
      // [CheckDB] Đảm bảo hàm save() của repository đã được gọi
      expect(mockTranslationRepo.save).toHaveBeenCalled();
    });

    /**
     * [TC-TRANS-002] Xác thực tính duy nhất của ngôn ngữ bản dịch trong cùng một nghĩa của từ.
     * Kịch bản này kiểm tra xem hệ thống có ngăn chặn việc tạo bản dịch mới nếu ngôn ngữ đó đã tồn tại hay không.
     * Mong đợi một lỗi BadRequestException được ném ra để bảo vệ tính toàn vẹn dữ liệu.
     */
    it('should throw BadRequestException if a translation with the same language already exists for the sense (TC-TRANS-002)', async () => {
      // Giả lập: Đã tồn tại bản dịch tiếng Anh cho sense này
      mockTranslationRepo.findOne.mockResolvedValue({ id: 5, language: 'en' });

      await expect(service.create(dto)).rejects.toThrow(BadRequestException);
      // Kiểm tra thông điệp lỗi có đúng không
      await expect(service.create(dto)).rejects.toThrow('Translation for this word sense and language already exists');
    });
  });

  describe('findAll', () => {
    // [TC-TRANS-003] Kiểm tra tìm kiếm với đầy đủ filter (wordSenseId, language, search)
    it('nên áp dụng chính xác các bộ lọc tìm kiếm và phân trang (TC-TRANS-003)', async () => {
      const query = { wordSenseId: 10, language: 'vn', search: 'xin chao', page: 1, limit: 10 };
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      await service.findAll(query);

      // Xác minh các filter được gọi qua QueryBuilder
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(expect.stringContaining('wordSenseId'), expect.anything());
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(expect.stringContaining('language'), expect.anything());
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(expect.stringContaining('translation LIKE'), expect.anything());
    });

    // [TC-TRANS-004] Kiểm tra giá trị phân trang mặc định
    it('nên sử dụng phân trang mặc định nếu không truyền query (TC-TRANS-004)', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);
      await service.findAll({});
      expect(mockQueryBuilder.skip).toHaveBeenCalledWith(0); // (1-1)*10
      expect(mockQueryBuilder.take).toHaveBeenCalledWith(10);
    });
  });

  describe('findById', () => {
    /**
     * [TC-TRANS-005] Kiểm tra chức năng truy xuất thông tin bản dịch cụ thể thông qua mã ID duy nhất.
     * Kỳ vọng hệ thống trả về đối tượng bản dịch chính xác nếu ID tồn tại trong hệ thống.
     */
    it('should return the translation object when the provided ID exists (TC-TRANS-005)', async () => {
      const translation = { id: 1, translation: 'test' };
      mockTranslationRepo.findOne.mockResolvedValue(translation);

      const result = await service.findById(1);

      expect(result).toEqual(translation);
      expect(mockTranslationRepo.findOne).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 1 } }));
    });

    /**
     * [TC-TRANS-006] Xác minh khả năng xử lý của hệ thống khi cố gắng tìm một bản dịch không có thực.
     * Đảm bảo tính nhất quán của API khi ném ra NotFoundException cho các yêu cầu ID không hợp lệ.
     */
    it('should throw NotFoundException if the translation ID does not exist in the database (TC-TRANS-006)', async () => {
      mockTranslationRepo.findOne.mockResolvedValue(null);
      await expect(service.findById(999)).rejects.toThrow(NotFoundException);
    });
  });

  describe('findByWordSenseId', () => {
    // [TC-TRANS-007] Lấy danh sách bản dịch theo Word Sense ID
    it('nên trả về mảng các bản dịch liên kết với sense (TC-TRANS-007)', async () => {
      const results = [{ id: 1, language: 'vn' }];
      mockTranslationRepo.find.mockResolvedValue(results);

      const result = await service.findByWordSenseId(5);

      expect(result).toEqual(results);
      expect(mockTranslationRepo.find).toHaveBeenCalledWith(expect.objectContaining({ where: { wordSenseId: 5 } }));
    });
  });

  describe('findByLanguage', () => {
    // [TC-TRANS-008] Lấy danh sách bản dịch theo ngôn ngữ cụ thể
    it('nên trả về các bản dịch của một ngôn ngữ nhất định (TC-TRANS-008)', async () => {
      const results = [{ id: 1, language: 'en' }];
      mockTranslationRepo.find.mockResolvedValue(results);

      const result = await service.findByLanguage('en');

      expect(result).toEqual(results);
      expect(mockTranslationRepo.find).toHaveBeenCalledWith(expect.objectContaining({ where: { language: 'en' } }));
    });
  });

  describe('update', () => {
    // [TC-TRANS-009] Cập nhật bản dịch thành công (không đổi ngôn ngữ)
    it('nên cập nhật các nội dung bản dịch mà không báo lỗi trùng lặp (TC-TRANS-009)', async () => {
      const translation = { id: 1, language: 'vn', wordSenseId: 10 };
      const dto = { translation: 'updated' };
      mockTranslationRepo.findOne.mockResolvedValue(translation);
      mockTranslationRepo.save.mockImplementation(t => Promise.resolve(t));

      const result = await service.update(1, dto);

      expect(result.translation).toBe('updated');
      expect(mockTranslationRepo.save).toHaveBeenCalled();
    });

    // [TC-TRANS-010] Cập nhật ngôn ngữ mới cho bản dịch thành công
    it('nên cho phép thay đổi ngôn ngữ nếu ngôn ngữ mới chưa tồn tại cho sense này (TC-TRANS-010)', async () => {
      const translation = { id: 1, language: 'vn', wordSenseId: 10 };
      const dto = { language: 'en' };
      mockTranslationRepo.findOne
        .mockResolvedValueOnce(translation) // Trả về cho hàm findById (gọi bởi update)
        .mockResolvedValueOnce(null); // Trả về cho check trùng ngôn ngữ trong logic update

      await service.update(1, dto);
      expect(mockTranslationRepo.save).toHaveBeenCalled();
    });

    // [TC-TRANS-011] Lỗi khi cập nhật ngôn ngữ bị trùng lặp
    it('nên báo lỗi BadRequestException nếu đổi sang ngôn ngữ đã tồn tại cho cùng sense (TC-TRANS-011)', async () => {
      const translation = { id: 1, language: 'vn', wordSenseId: 10 };
      const dto = { language: 'en' };
      mockTranslationRepo.findOne
        .mockResolvedValueOnce(translation) // Hàm findById
        .mockResolvedValueOnce({ id: 22, language: 'en' }); // Hàm check trùng tìm thấy ID 22

      await expect(service.update(1, dto)).rejects.toThrow(BadRequestException);
    });
  });

  describe('remove', () => {
    // [TC-TRANS-012] Xóa bản dịch thành công
    it('nên thực hiện lệnh xóa nếu bản dịch tồn tại (TC-TRANS-012)', async () => {
      const translation = { id: 1 };
      mockTranslationRepo.findOne.mockResolvedValue(translation);
      
      await service.remove(1);

      // [CheckDB] Xác nhận repository thực hiện lệnh xóa cho đối tượng tìm được
      expect(mockTranslationRepo.remove).toHaveBeenCalledWith(translation);
    });
  });

  describe('getTranslationStats', () => {
    // [TC-TRANS-013] Kiểm tra tính toán thống kê ngôn ngữ
    it('nên trả về tổng số bản dịch và phân bổ theo ngôn ngữ (TC-TRANS-013)', async () => {
      mockTranslationRepo.count.mockResolvedValue(500);
      mockQueryBuilder.getRawMany.mockResolvedValue([
        { language: 'vn', total: 300 },
        { language: 'en', total: 200 }
      ]);

      const result = await service.getTranslationStats();

      expect(result.total).toBe(500);
      expect(result.languageDistribution).toHaveLength(2);
      expect(result.languageDistribution[0].language).toBe('vn');
      expect(mockTranslationRepo.count).toHaveBeenCalled();
    });
  });
});
