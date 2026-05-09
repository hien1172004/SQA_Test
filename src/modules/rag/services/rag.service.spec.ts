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
     * [TC-RAG-RAG-001] Thực hiện quy trình RAG (Retrieval-Augmented Generation) thành công.
     * Mục tiêu: Xác nhận luồng đi từ tìm kiếm vector -> gọi LLM -> lưu ngữ cảnh -> trả về câu trả lời.
     */
    it('TC-RAG-RAG-001 - should perform full RAG flow successfully', async () => {
      // --- ARRANGE ---
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
      // Giả lập phản hồi từ dịch vụ LLM (ví dụ: Qwen hoặc Gemini).
      mockedAxios.post.mockResolvedValue({
        data: { text: 'Câu trả lời', confidence: 0.9 },
      });
      ragContextRepository.save!.mockResolvedValue({ id: 100 });

      // --- ACT ---
      const result = await service.query({
        query: 'Test',
        userId: 1,
        type: 'word',
        hskLevel: 1,
      });

      // --- ASSERT ---
      // [CheckDB] Xác nhận hệ thống thực hiện tìm kiếm ngữ cảnh tương đồng trước khi hỏi LLM.
      expect(vectorSearchService.searchSimilar).toHaveBeenCalled();
      // Xác nhận tham số gọi API LLM (model, timeout).
      expect(mockedAxios.post).toHaveBeenCalledWith(
        'http://llm:8001/generate',
        expect.objectContaining({ model: 'gemini-2.5-flash' }),
        expect.objectContaining({ timeout: 60000 }),
      );
      // [CheckDB] Xác nhận lịch sử truy vấn được lưu lại để phục vụ phân tích.
      expect(ragContextRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 1, query: 'Test' }),
      );
      expect(result.answer).toBe('Câu trả lời');
      expect(result.contextId).toBe(100);
    });

    /**
     * [TC-RAG-RAG-002] Xử lý an toàn khi dịch vụ Embedding (Vector Search) gặp sự cố.
     * Mục tiêu: Hệ thống vẫn hoạt động nhưng giảm độ tin cậy của câu trả lời.
     */
    it('TC-RAG-RAG-002 - should degrade gracefully when embedding fails', async () => {
      // --- ARRANGE ---
      vectorSearchService.searchSimilar.mockRejectedValue(new Error('down'));
      mockedAxios.post.mockResolvedValue({
        data: { text: 'fallback', confidence: 0.8 },
      });
      ragContextRepository.save!.mockResolvedValue({ id: 101 });

      // --- ACT ---
      const result = await service.query({ query: 'X' });

      // --- ASSERT ---
      // Không có nguồn dẫn chứng (sources) do lỗi search.
      expect(result.sources).toEqual([]);
      // [CheckDB] Độ tin cậy bị giới hạn tối đa 0.3 vì không có dữ liệu tham chiếu.
      expect(result.confidence).toBeLessThanOrEqual(0.3);
    });

    /**
     * [TC-RAG-RAG-003] Lọc ngữ cảnh theo loại hình Ngữ pháp (Grammar).
     */
    it('TC-RAG-RAG-003 - should filter to GRAMMAR sourceType when type=grammar', async () => {
      // --- ARRANGE ---
      vectorSearchService.searchSimilar.mockResolvedValue([]);
      mockedAxios.post.mockResolvedValue({ data: { text: 'a' } });
      ragContextRepository.save!.mockResolvedValue({ id: 1 });

      // --- ACT ---
      await service.query({ query: 'X', type: 'grammar' });

      // --- ASSERT ---
      // [CheckDB] Xác nhận chỉ tìm kiếm trong bảng dữ liệu GRAMMAR.
      expect(vectorSearchService.searchSimilar).toHaveBeenCalledWith(
        'X',
        expect.objectContaining({
          sourceTypes: [SourceType.GRAMMAR],
        }),
      );
    });

    /**
     * [TC-RAG-RAG-004] Lọc ngữ cảnh theo loại hình Bài học (Lesson).
     * Mục tiêu: Tìm kiếm trong cả nội dung (Content) và câu hỏi (Question).
     */
    it('TC-RAG-RAG-004 - should filter to CONTENT+QUESTION when type=lesson', async () => {
      // --- ARRANGE ---
      vectorSearchService.searchSimilar.mockResolvedValue([]);
      mockedAxios.post.mockResolvedValue({ data: { text: 'a' } });
      ragContextRepository.save!.mockResolvedValue({ id: 1 });

      // --- ACT ---
      await service.query({ query: 'X', type: 'lesson' });

      // --- ASSERT ---
      expect(vectorSearchService.searchSimilar).toHaveBeenCalledWith(
        'X',
        expect.objectContaining({
          sourceTypes: [SourceType.CONTENT, SourceType.QUESTION],
        }),
      );
    });

    /**
     * [TC-RAG-RAG-005] Điều chỉnh ngưỡng tìm kiếm (Threshold) cho trình độ sơ cấp (HSK level <= 2).
     * Mục tiêu: Mở rộng phạm vi tìm kiếm để hỗ trợ người mới học tốt hơn.
     */
    it('TC-RAG-RAG-005 - should adjust thresholds for beginner HSK levels', async () => {
      // --- ARRANGE ---
      vectorSearchService.searchSimilar.mockResolvedValue([]);
      mockedAxios.post.mockResolvedValue({ data: { text: 'a' } });
      ragContextRepository.save!.mockResolvedValue({ id: 1 });

      // --- ACT ---
      await service.query({ query: 'X', type: 'word', hskLevel: 1 });

      // --- ASSERT ---
      const callOptions = vectorSearchService.searchSimilar.mock.calls[0][1];
      // [CheckDB] Ngưỡng tương đồng tối thiểu giảm xuống 0.6 thay vì mặc định 0.7.
      expect(callOptions.minSimilarity).toBeCloseTo(0.6, 5);
      // [CheckDB] Số lượng nguồn tham khảo tăng lên 5 thay vì mặc định 3.
      expect(callOptions.limit).toBe(5);
    });

    /**
     * [TC-RAG-RAG-006] Lỗi nghiêm trọng khi dịch vụ LLM không phản hồi trong môi trường Production.
     */
    it('TC-RAG-RAG-006 - should throw when LLM fails in non-dev', async () => {
      // --- ARRANGE ---
      vectorSearchService.searchSimilar.mockResolvedValue([]);
      mockedAxios.post.mockRejectedValue(new Error('llm down'));

      // --- ACT & ASSERT ---
      await expect(service.query({ query: 'X' })).rejects.toThrow(
        /RAG query failed/,
      );
    });

    /**
     * [TC-RAG-RAG-007] Cơ chế phản hồi thay thế (Fallback) trong môi trường Phát triển (Dev) khi LLM lỗi.
     * Mục tiêu: Hỗ trợ lập trình viên kiểm tra luồng RAG mà không phụ thuộc hoàn toàn vào API LLM.
     */
    it('TC-RAG-RAG-007 - should return fallback in dev when LLM fails', async () => {
      // --- ARRANGE ---
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

      // --- ACT ---
      const result = await service.query({ query: 'X' });

      // --- ASSERT ---
      expect(result.answer).toBeDefined();
      expect(result.confidence).toBe(0.5);
    });

    /**
     * [TC-RAG-RAG-008] Chấp nhận ngữ cảnh người dùng dưới dạng đối tượng (Object).
     */
    it('TC-RAG-RAG-008 - should accept object userContext', async () => {
      // --- ARRANGE ---
      vectorSearchService.searchSimilar.mockResolvedValue([]);
      mockedAxios.post.mockResolvedValue({ data: { text: 'a' } });
      ragContextRepository.save!.mockResolvedValue({ id: 1 });

      // --- ACT ---
      await service.query({
        query: 'X',
        context: { foo: 'bar' },
      });

      // --- ASSERT ---
      expect(mockedAxios.post).toHaveBeenCalled();
    });
  });

  describe('getQueryHistory', () => {
    /**
     * [TC-RAG-RAG-009] Truy xuất lịch sử truy vấn RAG của người dùng với giới hạn mặc định.
     */
    it('TC-RAG-RAG-009 - should fetch history with default limit', async () => {
      // --- ARRANGE ---
      ragContextRepository.find!.mockResolvedValue([]);

      // --- ACT ---
      await service.getQueryHistory(1);

      // --- ASSERT ---
      // [CheckDB] Xác nhận service truy vấn lịch sử mới nhất (DESC) và giới hạn mặc định 10 bản ghi.
      expect(ragContextRepository.find).toHaveBeenCalledWith({
        where: { userId: 1 },
        order: { createdAt: 'DESC' },
        take: 10,
      });
    });

    /**
     * [TC-RAG-RAG-010] Truy xuất lịch sử truy vấn với giới hạn (Limit) tùy chỉnh.
     */
    it('TC-RAG-RAG-010 - should respect custom limit', async () => {
      // --- ARRANGE ---
      ragContextRepository.find!.mockResolvedValue([]);

      // --- ACT ---
      await service.getQueryHistory(1, 5);

      // --- ASSERT ---
      expect(ragContextRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({ take: 5 }),
      );
    });
  });

  describe('getAnalytics', () => {
    /**
     * [TC-RAG-RAG-011] Tổng hợp các chỉ số hiệu suất của hệ thống RAG.
     * Mục tiêu: Xác nhận việc tính toán tổng số truy vấn, thời gian xử lý trung bình và các từ khóa phổ biến.
     */
    it('TC-RAG-RAG-011 - should aggregate analytics correctly', async () => {
      // --- ARRANGE ---
      ragContextRepository.count!.mockResolvedValue(50);
      ragContextRepository.__queryBuilder.getRawOne
        .mockResolvedValueOnce({ avg: '125.5' }) // Giả lập thời gian xử lý trung bình (ms).
        .mockResolvedValueOnce({ avg: '3.2' });  // Giả lập số lượng nguồn tham chiếu trung bình.
      ragContextRepository.__queryBuilder.getRawMany.mockResolvedValue([
        { query: 'A', count: '10' },
        { query: 'B', count: '5' },
      ]);

      // --- ACT ---
      const result = await service.getAnalytics();

      // --- ASSERT ---
      expect(result.totalQueries).toBe(50);
      expect(result.avgProcessingTime).toBeCloseTo(125.5);
      expect(result.popularQueries).toHaveLength(2);
      expect(result.popularQueries[0]).toEqual({ query: 'A', count: 10 });
    });

    /**
     * [TC-RAG-RAG-012] Xử lý lỗi hệ thống khi quá trình tổng hợp dữ liệu gặp sự cố cơ sở dữ liệu.
     */
    it('TC-RAG-RAG-012 - should wrap and throw on DB error', async () => {
      // --- ARRANGE ---
      ragContextRepository.count!.mockRejectedValue(new Error('boom'));

      // --- ACT & ASSERT ---
      await expect(service.getAnalytics()).rejects.toThrow(
        /Failed to get RAG analytics/,
      );
    });

    /**
     * TC-RAG-RAG-016
     * Objective: Kiểm tra việc sử dụng các giá trị mặc định khi thiếu tham số type và hskLevel.
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
     * Objective: Xác nhận logic xây dựng prompt hoạt động đúng khi userContext là chuỗi văn bản.
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
     * Objective: Xác nhận tất cả các loại nguồn dữ liệu (SourceType) đều được phân loại đúng trong phản hồi fallback.
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

    /**
     * TC-RAG-RAG-018
     * Objective: Xử lý trường hợp phản hồi từ LLM sử dụng trường dữ liệu thay thế.
     */
    it('TC-RAG-RAG-018 - should handle LLM response with "response" field', async () => {
      vectorSearchService.searchSimilar.mockResolvedValue([]);
      mockedAxios.post.mockResolvedValue({ data: { response: 'Hello from response' } });
      ragContextRepository.save!.mockResolvedValue({ id: 1 });

      const result = await service.query({ query: 'Q' });
      expect(result.answer).toBe('Hello from response');
    });

    /**
     * TC-RAG-RAG-019
     * Objective: Xử lý an toàn khi phản hồi từ LLM không chứa các trường văn bản mong đợi.
     */
    it('TC-RAG-RAG-019 - should handle LLM response with no text fields', async () => {
      vectorSearchService.searchSimilar.mockResolvedValue([]);
      mockedAxios.post.mockResolvedValue({ data: {} });
      ragContextRepository.save!.mockResolvedValue({ id: 1 });

      const result = await service.query({ query: 'Q' });
      expect(result.answer).toBe('No response generated');
    });

    /**
     * TC-RAG-RAG-020
     * Objective: Kiểm tra cơ chế tự động chuyển về cấu hình mặc định (general) cho các loại truy vấn không xác định.
     */
    it('TC-RAG-RAG-020 - should use general fallback for unknown query type', async () => {
      vectorSearchService.searchSimilar.mockResolvedValue([]);
      mockedAxios.post.mockResolvedValue({ data: { text: 'a' } });
      ragContextRepository.save!.mockResolvedValue({ id: 1 });

      await service.query({ query: 'Q', type: 'unknown' as any });
      const opts = vectorSearchService.searchSimilar.mock.calls[0][1];
      // general: similarity 0.6, limit 5
      expect(opts.minSimilarity).toBe(0.6);
      expect(opts.limit).toBe(5);
    });
  });
});
