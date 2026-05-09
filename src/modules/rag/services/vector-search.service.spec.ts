/**
 * Unit tests for VectorSearchService.
 *
 * Strategy: mock-only.
 * - Embedding repository → mock TypeORM repo + queryBuilder
 * - EmbeddingService → mock 2 method generateEmbedding + calculateCosineSimilarity
 *
 * CheckDB: assert createQueryBuilder + andWhere được gọi đúng.
 * Rollback: jest.clearAllMocks() trong afterEach (no real DB).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { VectorSearchService } from './vector-search.service';
import { EmbeddingService } from './embedding.service';
import { Embedding, SourceType } from '../entities/embedding.entity';
import {
  createMockRepository,
  MockRepository,
} from '../../../test/helpers/mock-repository';

describe('VectorSearchService', () => {
  let service: VectorSearchService;
  let embeddingRepository: MockRepository;
  let embeddingService: { generateEmbedding: jest.Mock; calculateCosineSimilarity: jest.Mock };

  beforeEach(async () => {
    embeddingRepository = createMockRepository();
    embeddingService = {
      generateEmbedding: jest.fn(),
      calculateCosineSimilarity: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VectorSearchService,
        {
          provide: getRepositoryToken(Embedding),
          useValue: embeddingRepository,
        },
        { provide: EmbeddingService, useValue: embeddingService },
      ],
    }).compile();

    service = module.get<VectorSearchService>(VectorSearchService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('searchSimilar', () => {
    /**
     * TC-RAG-VSR-001
     * Objective: Generate embedding → query DB với filter → tính similarity → sort/filter/slice
     */
    it('TC-RAG-VSR-001 - should generate query embedding, fetch, score, sort, slice', async () => {
      embeddingService.generateEmbedding.mockResolvedValue([1, 0]);
      embeddingRepository.__queryBuilder.getMany.mockResolvedValue([
        { id: 1, sourceType: SourceType.WORD, sourceId: 10, contentText: 'a', embedding: [1, 0], metadata: {} },
        { id: 2, sourceType: SourceType.WORD, sourceId: 11, contentText: 'b', embedding: [0, 1], metadata: {} },
      ]);
      embeddingService.calculateCosineSimilarity
        .mockReturnValueOnce(0.9)
        .mockReturnValueOnce(0.3);

      const results = await service.searchSimilar('test', { minSimilarity: 0.5, limit: 5 });

      expect(embeddingService.generateEmbedding).toHaveBeenCalledWith('test');
      expect(results).toHaveLength(1); // chỉ 0.9 >= 0.5
      expect(results[0].id).toBe(1);
      expect(results[0].similarity).toBe(0.9);
    });

    /**
     * TC-RAG-VSR-002
     * Objective: Áp dụng filter HSK level → andWhere JSON_EXTRACT được gọi
     */
    it('TC-RAG-VSR-002 - should apply hskLevel filter when provided', async () => {
      embeddingService.generateEmbedding.mockResolvedValue([1, 0]);
      embeddingRepository.__queryBuilder.getMany.mockResolvedValue([]);
      await service.searchSimilar('q', { hskLevel: 3 });
      expect(embeddingRepository.__queryBuilder.andWhere).toHaveBeenCalledWith(
        'JSON_EXTRACT(embedding.metadata, "$.hskLevel") = :hskLevel',
        { hskLevel: 3 },
      );
    });

    /**
     * TC-RAG-VSR-003
     * Objective: includeMetadata=false → không gắn metadata vào kết quả
     */
    it('TC-RAG-VSR-003 - should omit metadata when includeMetadata=false', async () => {
      embeddingService.generateEmbedding.mockResolvedValue([1, 0]);
      embeddingRepository.__queryBuilder.getMany.mockResolvedValue([
        { id: 1, sourceType: SourceType.WORD, sourceId: 10, contentText: 'a', embedding: [1, 0], metadata: { x: 1 } },
      ]);
      embeddingService.calculateCosineSimilarity.mockReturnValue(0.9);

      const results = await service.searchSimilar('q', { includeMetadata: false });
      expect(results[0].metadata).toBeUndefined();
    });

    /**
     * TC-RAG-VSR-004
     * Objective: Lỗi từ embeddingService → wrap throw "Vector search failed"
     */
    it('TC-RAG-VSR-004 - should wrap and throw on embedding error', async () => {
      embeddingService.generateEmbedding.mockRejectedValue(new Error('boom'));
      await expect(service.searchSimilar('q')).rejects.toThrow(
        /Vector search failed/,
      );
    });

    /**
     * TC-RAG-VSR-005
     * Objective: Sort kết quả giảm dần theo similarity, slice theo limit
     */
    it('TC-RAG-VSR-005 - should sort by similarity desc and respect limit', async () => {
      embeddingService.generateEmbedding.mockResolvedValue([1]);
      embeddingRepository.__queryBuilder.getMany.mockResolvedValue([
        { id: 1, sourceType: SourceType.WORD, sourceId: 1, contentText: 'a', embedding: [1] },
        { id: 2, sourceType: SourceType.WORD, sourceId: 2, contentText: 'b', embedding: [1] },
        { id: 3, sourceType: SourceType.WORD, sourceId: 3, contentText: 'c', embedding: [1] },
      ]);
      embeddingService.calculateCosineSimilarity
        .mockReturnValueOnce(0.6)
        .mockReturnValueOnce(0.95)
        .mockReturnValueOnce(0.8);

      const results = await service.searchSimilar('q', { limit: 2 });
      expect(results).toHaveLength(2);
      expect(results[0].similarity).toBe(0.95);
      expect(results[1].similarity).toBe(0.8);
    });
  });

  describe('searchBySourceType', () => {
    /**
     * TC-RAG-VSR-006
     * Objective: Delegate sang searchSimilar với sourceTypes=[type]
     */
    it('TC-RAG-VSR-006 - should delegate to searchSimilar with single sourceType', async () => {
      const spy = jest.spyOn(service, 'searchSimilar').mockResolvedValue([]);
      await service.searchBySourceType('q', SourceType.GRAMMAR, { limit: 3 });
      expect(spy).toHaveBeenCalledWith('q', {
        limit: 3,
        sourceTypes: [SourceType.GRAMMAR],
      });
    });
  });

  describe('findSimilarContent', () => {
    /**
     * TC-RAG-VSR-007
     * Objective: Source embedding không tồn tại → trả mảng rỗng
     */
    it('TC-RAG-VSR-007 - should return [] when source embedding not found', async () => {
      embeddingRepository.findOne!.mockResolvedValue(null);
      const result = await service.findSimilarContent(SourceType.WORD, 1);
      expect(result).toEqual([]);
    });

    /**
     * TC-RAG-VSR-008
     * Objective: Lấy embeddings khác source, tính similarity, filter & sort
     */
    it('TC-RAG-VSR-008 - should find similar content excluding self', async () => {
      embeddingRepository.findOne!.mockResolvedValue({
        sourceType: SourceType.WORD,
        sourceId: 1,
        embedding: [1, 0],
      });
      embeddingRepository.__queryBuilder.getMany.mockResolvedValue([
        { id: 2, sourceType: SourceType.WORD, sourceId: 2, contentText: 'a', embedding: [1, 0] },
        { id: 3, sourceType: SourceType.WORD, sourceId: 3, contentText: 'b', embedding: [0, 1] },
      ]);
      embeddingService.calculateCosineSimilarity
        .mockReturnValueOnce(0.95)
        .mockReturnValueOnce(0.2);

      const results = await service.findSimilarContent(SourceType.WORD, 1, { minSimilarity: 0.5 });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe(2);
    });

    /**
     * TC-RAG-VSR-009
     * Objective: Áp dụng option sourceTypes + hskLevel
     */
    it('TC-RAG-VSR-009 - should apply sourceTypes and hskLevel filters', async () => {
      embeddingRepository.findOne!.mockResolvedValue({
        sourceType: SourceType.WORD,
        sourceId: 1,
        embedding: [1],
      });
      embeddingRepository.__queryBuilder.getMany.mockResolvedValue([]);
      await service.findSimilarContent(SourceType.WORD, 1, {
        sourceTypes: [SourceType.GRAMMAR],
        hskLevel: 2,
      });
      expect(embeddingRepository.__queryBuilder.andWhere).toHaveBeenCalledWith(
        'embedding.sourceType IN (:...sourceTypes)',
        { sourceTypes: [SourceType.GRAMMAR] },
      );
      expect(embeddingRepository.__queryBuilder.andWhere).toHaveBeenCalledWith(
        'JSON_EXTRACT(embedding.metadata, "$.hskLevel") = :hskLevel',
        { hskLevel: 2 },
      );
    });

    /**
     * TC-RAG-VSR-010
     * Objective: Lỗi DB → wrap throw "Find similar content failed"
     */
    it('TC-RAG-VSR-010 - should wrap and throw on DB error', async () => {
      embeddingRepository.findOne!.mockRejectedValue(new Error('boom'));
      await expect(
        service.findSimilarContent(SourceType.WORD, 1),
      ).rejects.toThrow(/Find similar content failed/);
    });
  });

  describe('getEmbeddingStats', () => {
    /**
     * TC-RAG-VSR-011
     * Objective: Trả về total, active, bySourceType
     */
    it('TC-RAG-VSR-011 - should aggregate embedding stats', async () => {
      embeddingRepository.count!
        .mockResolvedValueOnce(100) // total
        .mockResolvedValueOnce(80); // active
      embeddingRepository.__queryBuilder.getRawMany.mockResolvedValue([
        { sourceType: SourceType.WORD, count: '50' },
        { sourceType: SourceType.GRAMMAR, count: '30' },
      ]);

      const result = await service.getEmbeddingStats();
      expect(result.total).toBe(100);
      expect(result.active).toBe(80);
      expect(result.bySourceType[SourceType.WORD]).toBe(50);
      expect(result.bySourceType[SourceType.GRAMMAR]).toBe(30);
    });

    /**
     * TC-RAG-VSR-015
     * Objective: findSimilarContent với 3 elements đều pass filter → cover comparator (line 164)
     */
    it('TC-RAG-VSR-015 - should sort multiple results via comparator', async () => {
      embeddingRepository.findOne!.mockResolvedValue({
        sourceType: SourceType.WORD,
        sourceId: 1,
        embedding: [1, 0],
      });
      embeddingRepository.__queryBuilder.getMany.mockResolvedValue([
        { id: 2, sourceType: SourceType.WORD, sourceId: 2, contentText: 'a', embedding: [1] },
        { id: 3, sourceType: SourceType.WORD, sourceId: 3, contentText: 'b', embedding: [1] },
        { id: 4, sourceType: SourceType.WORD, sourceId: 4, contentText: 'c', embedding: [1] },
      ]);
      embeddingService.calculateCosineSimilarity
        .mockReturnValueOnce(0.7)
        .mockReturnValueOnce(0.95)
        .mockReturnValueOnce(0.85);

      const result = await service.findSimilarContent(SourceType.WORD, 1, {
        minSimilarity: 0.5,
      });
      expect(result).toHaveLength(3);
      expect(result[0].similarity).toBe(0.95);
      expect(result[1].similarity).toBe(0.85);
      expect(result[2].similarity).toBe(0.7);
    });

    /**
     * TC-RAG-VSR-014
     * Objective: findSimilarContent với 1 element duy nhất → sort không có swap
     *            (cover branch của comparator khi không có swap)
     */
    it('TC-RAG-VSR-014 - should handle single result without sort swap', async () => {
      embeddingRepository.findOne!.mockResolvedValue({
        sourceType: SourceType.WORD,
        sourceId: 1,
        embedding: [1, 0],
      });
      embeddingRepository.__queryBuilder.getMany.mockResolvedValue([
        { id: 2, sourceType: SourceType.WORD, sourceId: 2, contentText: 'a', embedding: [1, 0] },
      ]);
      embeddingService.calculateCosineSimilarity.mockReturnValue(0.9);

      const result = await service.findSimilarContent(SourceType.WORD, 1, {
        minSimilarity: 0.5,
        limit: 10,
        includeMetadata: true,
      });
      expect(result).toHaveLength(1);
    });

    /**
     * TC-RAG-VSR-013
     * Objective: Kiểm tra việc sử dụng các ngưỡng tương đồng và giới hạn mặc định khi không có tham số tùy chọn.
     */
    it('TC-RAG-VSR-013 - should use default minSimilarity and limit', async () => {
      embeddingRepository.findOne!.mockResolvedValue({
        sourceType: SourceType.WORD,
        sourceId: 1,
        embedding: [1, 0],
      });
      embeddingRepository.__queryBuilder.getMany.mockResolvedValue([
        { id: 2, sourceType: SourceType.WORD, sourceId: 2, contentText: 'a', embedding: [1, 0] },
        { id: 3, sourceType: SourceType.WORD, sourceId: 3, contentText: 'b', embedding: [0, 1] },
      ]);
      embeddingService.calculateCosineSimilarity
        .mockReturnValueOnce(0.4) // < 0.5 → loại
        .mockReturnValueOnce(0.6); // >= 0.5

      const result = await service.findSimilarContent(SourceType.WORD, 1, {});
      expect(result).toHaveLength(1);
      expect(result[0].similarity).toBe(0.6);
    });

    /**
     * TC-RAG-VSR-012
     * Objective: Lỗi DB → throw "Failed to get embedding stats"
     */
    it('TC-RAG-VSR-012 - should wrap and throw on DB error', async () => {
      embeddingRepository.count!.mockRejectedValue(new Error('boom'));
      await expect(service.getEmbeddingStats()).rejects.toThrow(
        /Failed to get embedding stats/,
      );
    });

    /**
     * TC-RAG-VSR-016
     * Objective: Kiểm tra việc gọi hàm tìm kiếm theo loại nguồn dữ liệu khi không truyền tham số tùy chọn.
     */
    it('TC-RAG-VSR-016 - should call searchBySourceType without options', async () => {
      const spy = jest.spyOn(service, 'searchSimilar').mockResolvedValue([]);
      await service.searchBySourceType('q', SourceType.WORD); // No second arg
      expect(spy).toHaveBeenCalledWith('q', {
        sourceTypes: [SourceType.WORD],
      });
    });
  });
});
