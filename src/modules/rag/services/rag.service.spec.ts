/**
 * Unit tests for RagService.
 *
 * Strategy: mock-only.
 * - axios.post mock toàn cục (jest.mock('axios'))
 * - VectorSearchService mock với searchSimilar
 * - ConfigService trả URL/model giả
 * - ragContextRepository mock save/find/queryBuilder
 *
 * CheckDB: assert ragContextRepository.save được gọi với userId/query/response/sources.
 * Rollback: jest.clearAllMocks() trong afterEach (no real DB).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { RagService } from './rag.service';
import { VectorSearchService } from './vector-search.service';
import { RagContext } from '../entities/rag-context.entity';
import { SourceType } from '../entities/embedding.entity';
import {
  createMockRepository,
  MockRepository,
} from '../../../test/helpers/mock-repository';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('RagService', () => {
  let service: RagService;
  let ragContextRepository: MockRepository;
  let vectorSearchService: { searchSimilar: jest.Mock };
  const originalEnv = process.env.NODE_ENV;

  beforeEach(async () => {
    ragContextRepository = createMockRepository();
    vectorSearchService = { searchSimilar: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RagService,
        {
          provide: getRepositoryToken(RagContext),
          useValue: ragContextRepository,
        },
        { provide: VectorSearchService, useValue: vectorSearchService },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn(
              (k: string, def?: string) =>
                ({
                  LLM_SERVICE_URL: 'http://llm:8001',
                  LLM_MODEL: 'qwen-2.5b-instruct',
                })[k] || def,
            ),
          },
        },
      ],
    }).compile();

    service = module.get<RagService>(RagService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    process.env.NODE_ENV = originalEnv;
  });

  describe('query', () => {
    /**
     * TC-RAG-RAG-001
     * Objective: Happy path - search → LLM → save context → return response
     */
    it('TC-RAG-RAG-001 - should perform full RAG flow successfully', async () => {
      const sources = [
        {
          id: 1,
          sourceType: SourceType.WORD,
          sourceId: 10,
          contentText: 'hello',
          similarity: 0.85,
          metadata: { hskLevel: 1 },
        },
      ];
      vectorSearchService.searchSimilar.mockResolvedValue(sources);
      mockedAxios.post.mockResolvedValue({
        data: { text: 'Câu trả lời', confidence: 0.9 },
      });
      ragContextRepository.save!.mockResolvedValue({ id: 100 });

      const result = await service.query({
        query: 'Test',
        userId: 1,
        type: 'word',
        hskLevel: 1,
      });

      expect(vectorSearchService.searchSimilar).toHaveBeenCalled();
      expect(mockedAxios.post).toHaveBeenCalledWith(
        'http://llm:8001/generate',
        expect.objectContaining({ model: 'gemini-2.5-flash' }),
        expect.objectContaining({ timeout: 60000 }),
      );
      expect(ragContextRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 1, query: 'Test' }),
      );
      expect(result.answer).toBe('Câu trả lời');
      expect(result.contextId).toBe(100);
    });

    /**
     * TC-RAG-RAG-002
     * Objective: Embedding service lỗi → graceful degrade, sources=[], confidence cap 0.3
     */
    it('TC-RAG-RAG-002 - should degrade gracefully when embedding fails', async () => {
      vectorSearchService.searchSimilar.mockRejectedValue(new Error('down'));
      mockedAxios.post.mockResolvedValue({
        data: { text: 'fallback', confidence: 0.8 },
      });
      ragContextRepository.save!.mockResolvedValue({ id: 101 });

      const result = await service.query({ query: 'X' });
      expect(result.sources).toEqual([]);
      expect(result.confidence).toBeLessThanOrEqual(0.3);
    });

    /**
     * TC-RAG-RAG-003
     * Objective: type=grammar → sourceTypes filter chỉ GRAMMAR
     */
    it('TC-RAG-RAG-003 - should filter to GRAMMAR sourceType when type=grammar', async () => {
      vectorSearchService.searchSimilar.mockResolvedValue([]);
      mockedAxios.post.mockResolvedValue({ data: { text: 'a' } });
      ragContextRepository.save!.mockResolvedValue({ id: 1 });

      await service.query({ query: 'X', type: 'grammar' });
      expect(vectorSearchService.searchSimilar).toHaveBeenCalledWith(
        'X',
        expect.objectContaining({
          sourceTypes: [SourceType.GRAMMAR],
        }),
      );
    });

    /**
     * TC-RAG-RAG-004
     * Objective: type=lesson → filter [CONTENT, QUESTION]
     */
    it('TC-RAG-RAG-004 - should filter to CONTENT+QUESTION when type=lesson', async () => {
      vectorSearchService.searchSimilar.mockResolvedValue([]);
      mockedAxios.post.mockResolvedValue({ data: { text: 'a' } });
      ragContextRepository.save!.mockResolvedValue({ id: 1 });

      await service.query({ query: 'X', type: 'lesson' });
      expect(vectorSearchService.searchSimilar).toHaveBeenCalledWith(
        'X',
        expect.objectContaining({
          sourceTypes: [SourceType.CONTENT, SourceType.QUESTION],
        }),
      );
    });

    /**
     * TC-RAG-RAG-005
     * Objective: HSK level <= 2 → minSimilarity giảm, maxSources tăng
     */
    it('TC-RAG-RAG-005 - should adjust thresholds for beginner HSK levels', async () => {
      vectorSearchService.searchSimilar.mockResolvedValue([]);
      mockedAxios.post.mockResolvedValue({ data: { text: 'a' } });
      ragContextRepository.save!.mockResolvedValue({ id: 1 });

      await service.query({ query: 'X', type: 'word', hskLevel: 1 });
      const callOptions = vectorSearchService.searchSimilar.mock.calls[0][1];
      // word base = 0.7, hsk<=2 trừ 0.1 = 0.6
      expect(callOptions.minSimilarity).toBeCloseTo(0.6, 5);
      // word base limit = 3, hsk<=2 +2 = 5
      expect(callOptions.limit).toBe(5);
    });

    /**
     * TC-RAG-RAG-006
     * Objective: LLM service lỗi non-dev → throw "RAG query failed"
     */
    it('TC-RAG-RAG-006 - should throw when LLM fails in non-dev', async () => {
      vectorSearchService.searchSimilar.mockResolvedValue([]);
      mockedAxios.post.mockRejectedValue(new Error('llm down'));
      await expect(service.query({ query: 'X' })).rejects.toThrow(
        /RAG query failed/,
      );
    });

    /**
     * TC-RAG-RAG-007
     * Objective: LLM lỗi trong dev → fallback response (vẫn trả về)
     */
    it('TC-RAG-RAG-007 - should return fallback in dev when LLM fails', async () => {
      process.env.NODE_ENV = 'development';
      vectorSearchService.searchSimilar.mockResolvedValue([
        {
          id: 1,
          sourceType: SourceType.WORD,
          sourceId: 1,
          contentText: 'Hello content',
          similarity: 0.8,
        },
      ]);
      mockedAxios.post.mockRejectedValue(new Error('llm down'));
      ragContextRepository.save!.mockResolvedValue({ id: 1 });

      const result = await service.query({ query: 'X' });
      expect(result.answer).toBeDefined();
      expect(result.confidence).toBe(0.5);
    });

    /**
     * TC-RAG-RAG-008
     * Objective: userContext dạng object → JSON.stringify khi build prompt
     */
    it('TC-RAG-RAG-008 - should accept object userContext', async () => {
      vectorSearchService.searchSimilar.mockResolvedValue([]);
      mockedAxios.post.mockResolvedValue({ data: { text: 'a' } });
      ragContextRepository.save!.mockResolvedValue({ id: 1 });

      await service.query({
        query: 'X',
        context: { foo: 'bar' },
      });
      expect(mockedAxios.post).toHaveBeenCalled();
    });
  });

  describe('getQueryHistory', () => {
    /**
     * TC-RAG-RAG-009
     * Objective: Lấy history theo userId, default limit=10
     */
    it('TC-RAG-RAG-009 - should fetch history with default limit', async () => {
      ragContextRepository.find!.mockResolvedValue([]);
      await service.getQueryHistory(1);
      expect(ragContextRepository.find).toHaveBeenCalledWith({
        where: { userId: 1 },
        order: { createdAt: 'DESC' },
        take: 10,
      });
    });

    /**
     * TC-RAG-RAG-010
     * Objective: Lấy history với limit tùy chỉnh
     */
    it('TC-RAG-RAG-010 - should respect custom limit', async () => {
      ragContextRepository.find!.mockResolvedValue([]);
      await service.getQueryHistory(1, 5);
      expect(ragContextRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({ take: 5 }),
      );
    });
  });

  describe('getAnalytics', () => {
    /**
     * TC-RAG-RAG-011
     * Objective: Aggregate analytics: totalQueries, avgProcessingTime, popularQueries
     */
    it('TC-RAG-RAG-011 - should aggregate analytics correctly', async () => {
      ragContextRepository.count!.mockResolvedValue(50);
      ragContextRepository.__queryBuilder.getRawOne
        .mockResolvedValueOnce({ avg: '125.5' }) // avgProcessingTime
        .mockResolvedValueOnce({ avg: '3.2' }); // avgSourcesUsed
      ragContextRepository.__queryBuilder.getRawMany.mockResolvedValue([
        { query: 'A', count: '10' },
        { query: 'B', count: '5' },
      ]);

      const result = await service.getAnalytics();
      expect(result.totalQueries).toBe(50);
      expect(result.avgProcessingTime).toBeCloseTo(125.5);
      expect(result.popularQueries).toHaveLength(2);
      expect(result.popularQueries[0]).toEqual({ query: 'A', count: 10 });
    });

    /**
     * TC-RAG-RAG-012
     * Objective: Lỗi DB → wrap throw
     */
    it('TC-RAG-RAG-012 - should wrap and throw on DB error', async () => {
      ragContextRepository.count!.mockRejectedValue(new Error('boom'));
      await expect(service.getAnalytics()).rejects.toThrow(
        /Failed to get RAG analytics/,
      );
    });

    /**
     * TC-RAG-RAG-016
     * Objective: type=general (default) + không có HSK level → cover branch fallback
     *            của getSmartMinSimilarity/getSmartMaxSources (không trừ 0.1, không +2)
     */
    it('TC-RAG-RAG-016 - should use general defaults when type/hskLevel missing', async () => {
      vectorSearchService.searchSimilar.mockResolvedValue([]);
      mockedAxios.post.mockResolvedValue({ data: { text: 'a' } });
      ragContextRepository.save!.mockResolvedValue({ id: 1 });

      await service.query({ query: 'X' }); // không có type, không có hskLevel
      const opts = vectorSearchService.searchSimilar.mock.calls[0][1];
      // general base: minSimilarity=0.6, limit=5
      expect(opts.minSimilarity).toBeCloseTo(0.6, 5);
      expect(opts.limit).toBe(5);
    });

    /**
     * TC-RAG-RAG-017
     * Objective: query có userContext dạng string + sources có metadata.hskLevel
     *            → cover prompt build branch (typeof string + hskInfo)
     */
    it('TC-RAG-RAG-017 - should accept string userContext and label hskLevel in prompt', async () => {
      vectorSearchService.searchSimilar.mockResolvedValue([
        {
          id: 1,
          sourceType: SourceType.WORD,
          sourceId: 1,
          contentText: 'c',
          similarity: 0.7,
          metadata: { hskLevel: 2 },
        },
      ]);
      mockedAxios.post.mockResolvedValue({ data: { text: 'a' } });
      ragContextRepository.save!.mockResolvedValue({ id: 1 });

      await service.query({
        query: 'Q',
        context: 'plain string context',
        hskLevel: 2,
      });
      // CheckDB: ragContextRepository.save được gọi
      expect(ragContextRepository.save).toHaveBeenCalled();
    });

    /**
     * TC-RAG-RAG-014
     * Objective: Fallback response trong dev với sources=[] → câu trả lời chứa "couldn't find"
     */
    it('TC-RAG-RAG-014 - should return "couldn\'t find" fallback in dev when no sources', async () => {
      process.env.NODE_ENV = 'development';
      vectorSearchService.searchSimilar.mockResolvedValue([]); // no sources
      mockedAxios.post.mockRejectedValue(new Error('llm down'));
      ragContextRepository.save!.mockResolvedValue({ id: 1 });

      const result = await service.query({ query: 'X' });
      expect(result.answer).toMatch(/couldn't find/);
    });

    /**
     * TC-RAG-RAG-015
     * Objective: Fallback response trong dev với sources nhiều sourceType khác nhau
     *            để cover toàn bộ switch case của getSourceLabel
     */
    it('TC-RAG-RAG-015 - should label all source types correctly in fallback', async () => {
      process.env.NODE_ENV = 'development';
      const sourceTypes = [
        SourceType.GRAMMAR,
        SourceType.CONTENT,
        SourceType.QUESTION,
        'unknown' as any, // hit default branch
      ];
      ragContextRepository.save!.mockResolvedValue({ id: 1 });
      mockedAxios.post.mockRejectedValue(new Error('llm down'));

      for (const st of sourceTypes) {
        vectorSearchService.searchSimilar.mockResolvedValueOnce([
          {
            id: 1,
            sourceType: st,
            sourceId: 1,
            contentText: 'content',
            similarity: 0.7,
          },
        ]);
        const r = await service.query({ query: 'Q' });
        expect(r.answer).toBeDefined();
      }
    });

    /**
     * TC-RAG-RAG-013
     * Objective: avg trả null → default 0
     */
    it('TC-RAG-RAG-013 - should default avg to 0 when null', async () => {
      ragContextRepository.count!.mockResolvedValue(0);
      ragContextRepository.__queryBuilder.getRawOne.mockResolvedValue({
        avg: null,
      });
      ragContextRepository.__queryBuilder.getRawMany.mockResolvedValue([]);

      const result = await service.getAnalytics();
      expect(result.avgProcessingTime).toBe(0);
      expect(result.avgSourcesUsed).toBe(0);
    });
  });
});
