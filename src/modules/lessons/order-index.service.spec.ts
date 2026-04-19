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
     * TC-LSN-OIDX-001
     * Objective: Trả về max(content, question) + 1 khi cả hai có dữ liệu
     * Input:    lessonId = 5; contentMax = 3, questionMax = 7
     * Expected: 8 (= max(3,7) + 1); cả hai query builder đều được gọi với lessonId=5 + isActive=true
     */
    it('TC-LSN-OIDX-001 - should return max+1 when both repositories return values', async () => {
      const lessonId = 5;
      contentRepository.__queryBuilder.getRawOne.mockResolvedValue({
        maxIndex: 3,
      });
      questionRepository.__queryBuilder.getRawOne.mockResolvedValue({
        maxIndex: 7,
      });

      const result = await service.getNextOrderIndex(lessonId);

      expect(result).toBe(8);
      // CheckDB: cả 2 query builder phải được gọi
      expect(contentRepository.createQueryBuilder).toHaveBeenCalledWith(
        'content',
      );
      expect(questionRepository.createQueryBuilder).toHaveBeenCalledWith(
        'question',
      );
      expect(contentRepository.__queryBuilder.where).toHaveBeenCalledWith(
        'content.lessonId = :lessonId',
        { lessonId },
      );
      expect(contentRepository.__queryBuilder.andWhere).toHaveBeenCalledWith(
        'content.isActive = :isActive',
        { isActive: true },
      );
      expect(questionRepository.__queryBuilder.where).toHaveBeenCalledWith(
        'question.lessonId = :lessonId',
        { lessonId },
      );
    });

    /**
     * TC-LSN-OIDX-002
     * Objective: Trả về 1 khi cả hai repository không có record nào (maxIndex=null)
     * Input:    lessonId = 99; cả hai trả về { maxIndex: null }
     * Expected: 1 (= max(0,0) + 1)
     */
    it('TC-LSN-OIDX-002 - should return 1 when both repositories are empty', async () => {
      contentRepository.__queryBuilder.getRawOne.mockResolvedValue({
        maxIndex: null,
      });
      questionRepository.__queryBuilder.getRawOne.mockResolvedValue({
        maxIndex: null,
      });

      const result = await service.getNextOrderIndex(99);
      expect(result).toBe(1);
    });

    /**
     * TC-LSN-OIDX-003
     * Objective: Trả về content max + 1 khi questionMax = null
     * Input:    contentMax = 4, questionMax = null
     * Expected: 5
     */
    it('TC-LSN-OIDX-003 - should pick content max when question is null', async () => {
      contentRepository.__queryBuilder.getRawOne.mockResolvedValue({
        maxIndex: 4,
      });
      questionRepository.__queryBuilder.getRawOne.mockResolvedValue({
        maxIndex: null,
      });

      const result = await service.getNextOrderIndex(1);
      expect(result).toBe(5);
    });

    /**
     * TC-LSN-OIDX-004
     * Objective: Trả về 1 khi cả 2 raw result là undefined (edge: getRawOne resolve undefined)
     * Input:    cả 2 trả về undefined
     * Expected: 1
     */
    it('TC-LSN-OIDX-004 - should default to 1 when getRawOne returns undefined', async () => {
      contentRepository.__queryBuilder.getRawOne.mockResolvedValue(undefined);
      questionRepository.__queryBuilder.getRawOne.mockResolvedValue(undefined);

      const result = await service.getNextOrderIndex(1);
      expect(result).toBe(1);
    });
  });
});
