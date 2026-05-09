/**
 * Unit tests for OrderIndexService.
 *
 * Strategy: mock-only. TypeORM repositories được thay bằng jest.fn(). CheckDB
 * thực hiện qua việc assert createQueryBuilder + chuỗi where/andWhere được gọi
 * với tham số đúng. Rollback đạt được vì không có mutation DB; jest.clearAllMocks()
 * trong afterEach đảm bảo state sạch giữa các test.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { OrderIndexService } from './order-index.service';
import { Content } from './entities/content.entity';
import { Question } from './entities/question.entity';
import {
  createMockRepository,
  MockRepository,
} from '../../test/helpers/mock-repository';

describe('OrderIndexService', () => {
  let service: OrderIndexService;
  let contentRepository: MockRepository;
  let questionRepository: MockRepository;

  beforeEach(async () => {
    contentRepository = createMockRepository();
    questionRepository = createMockRepository();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderIndexService,
        { provide: getRepositoryToken(Content), useValue: contentRepository },
        { provide: getRepositoryToken(Question), useValue: questionRepository },
      ],
    }).compile();

    service = module.get<OrderIndexService>(OrderIndexService);
  });

  afterEach(() => {
    // Rollback: reset mock state để test tiếp theo không bị nhiễm
    jest.clearAllMocks();
  });

  describe('getNextOrderIndex', () => {
    /**
     * [TC-LSN-OIDX-001] Tính toán số thứ tự tiếp theo khi cả Content và Question đều có dữ liệu.
     * Mục tiêu: Xác nhận hệ thống lấy giá trị MAX từ cả hai bảng và cộng thêm 1.
     */
    it('TC-LSN-OIDX-001 - should return max+1 when both repositories return values', async () => {
      // --- ARRANGE ---
      const lessonId = 5;
      // Giả lập bảng Content có maxIndex = 3.
      contentRepository.__queryBuilder.getRawOne.mockResolvedValue({
        maxIndex: 3,
      });
      // Giả lập bảng Question có maxIndex = 7.
      questionRepository.__queryBuilder.getRawOne.mockResolvedValue({
        maxIndex: 7,
      });

      // --- ACT ---
      const result = await service.getNextOrderIndex(lessonId);

      // --- ASSERT ---
      // Kết quả kỳ vọng: max(3, 7) + 1 = 8.
      expect(result).toBe(8);
      
      // [CheckDB] Xác nhận cả hai QueryBuilder đều thực hiện truy vấn đúng bài học và trạng thái Active.
      expect(contentRepository.createQueryBuilder).toHaveBeenCalledWith('content');
      expect(questionRepository.createQueryBuilder).toHaveBeenCalledWith('question');
      expect(contentRepository.__queryBuilder.where).toHaveBeenCalledWith(
        'content.lessonId = :lessonId',
        { lessonId },
      );
      expect(contentRepository.__queryBuilder.andWhere).toHaveBeenCalledWith(
        'content.isActive = :isActive',
        { isActive: true },
      );
    });

    /**
     * [TC-LSN-OIDX-002] Trả về giá trị mặc định khi bài học chưa có nội dung nào.
     */
    it('TC-LSN-OIDX-002 - should return 1 when both repositories are empty', async () => {
      // --- ARRANGE ---
      contentRepository.__queryBuilder.getRawOne.mockResolvedValue({
        maxIndex: null,
      });
      questionRepository.__queryBuilder.getRawOne.mockResolvedValue({
        maxIndex: null,
      });

      // --- ACT ---
      const result = await service.getNextOrderIndex(99);

      // --- ASSERT ---
      // Khi MAX = null, hệ thống coi như là 0. 0 + 1 = 1.
      expect(result).toBe(1);
    });

    /**
     * [TC-LSN-OIDX-003] Lấy số thứ tự lớn nhất từ bảng Content khi bảng Question rỗng.
     */
    it('TC-LSN-OIDX-003 - should pick content max when question is null', async () => {
      // --- ARRANGE ---
      contentRepository.__queryBuilder.getRawOne.mockResolvedValue({
        maxIndex: 4,
      });
      questionRepository.__queryBuilder.getRawOne.mockResolvedValue({
        maxIndex: null,
      });

      // --- ACT ---
      const result = await service.getNextOrderIndex(1);

      // --- ASSERT ---
      expect(result).toBe(5);
    });

    /**
     * [TC-LSN-OIDX-004] Xử lý trường hợp QueryBuilder trả về undefined.
     */
    it('TC-LSN-OIDX-004 - should default to 1 when getRawOne returns undefined', async () => {
      // --- ARRANGE ---
      contentRepository.__queryBuilder.getRawOne.mockResolvedValue(undefined);
      questionRepository.__queryBuilder.getRawOne.mockResolvedValue(undefined);

      // --- ACT ---
      const result = await service.getNextOrderIndex(1);

      // --- ASSERT ---
      expect(result).toBe(1);
    });
  });
});
