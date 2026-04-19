/**
 * Unit tests for EmbeddingService.
 *
 * Strategy: mock-only.
 * - axios.post / axios.get được mock toàn cục bằng jest.mock('axios')
 * - ConfigService mock đơn giản trả về URL/model fix sẵn
 * - Không có DB → CheckDB/Rollback không áp dụng (no DB writes)
 */
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { EmbeddingService } from './embedding.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('EmbeddingService', () => {
  let service: EmbeddingService;
  const originalEnv = process.env.NODE_ENV;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmbeddingService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultVal?: string) => {
              if (key === 'EMBEDDING_SERVICE_URL') return 'http://test:8000';
              if (key === 'EMBEDDING_MODEL') return 'BAAI/bge-m3';
              return defaultVal;
            }),
          },
        },
      ],
    }).compile();
    service = module.get<EmbeddingService>(EmbeddingService);
    process.env.NODE_ENV = 'test'; // không phải development
  });

  afterEach(() => {
    jest.clearAllMocks();
    process.env.NODE_ENV = originalEnv;
  });

  describe('generateEmbedding', () => {
    /**
     * TC-RAG-EMB-001
     * Objective: Gọi axios.post với endpoint /embed và payload đúng → trả về embedding
     */
    it('TC-RAG-EMB-001 - should POST to /embed and return embedding array', async () => {
      const fakeEmbedding = [0.1, 0.2, 0.3];
      mockedAxios.post.mockResolvedValue({
        data: { embedding: fakeEmbedding, model: 'BAAI/bge-m3' },
      });

      const result = await service.generateEmbedding('  hello  ');
      expect(mockedAxios.post).toHaveBeenCalledWith(
        'http://test:8000/embed',
        { text: 'hello', model: 'BAAI/bge-m3' },
        expect.objectContaining({ timeout: 30000 }),
      );
      expect(result).toEqual(fakeEmbedding);
    });

    /**
     * TC-RAG-EMB-002
     * Objective: axios.post lỗi trong môi trường non-development → throw Error
     */
    it('TC-RAG-EMB-002 - should throw when axios fails in non-dev env', async () => {
      mockedAxios.post.mockRejectedValue(new Error('network down'));
      await expect(service.generateEmbedding('x')).rejects.toThrow(
        /Embedding generation failed/,
      );
    });

    /**
     * TC-RAG-EMB-003
     * Objective: axios.post lỗi trong development → fallback mock embedding (1024 chiều)
     */
    it('TC-RAG-EMB-003 - should return mock embedding in development on failure', async () => {
      process.env.NODE_ENV = 'development';
      mockedAxios.post.mockRejectedValue(new Error('boom'));
      const result = await service.generateEmbedding('x');
      expect(result).toHaveLength(1024);
    });
  });

  describe('generateBatchEmbeddings', () => {
    /**
     * TC-RAG-EMB-004
     * Objective: POST /embed/batch → trả mảng embeddings
     */
    it('TC-RAG-EMB-004 - should batch embed multiple texts', async () => {
      const arr = [
        [0.1, 0.2],
        [0.3, 0.4],
      ];
      mockedAxios.post.mockResolvedValue({ data: { embeddings: arr } });

      const result = await service.generateBatchEmbeddings(['a', 'b']);
      expect(mockedAxios.post).toHaveBeenCalledWith(
        'http://test:8000/embed/batch',
        { texts: ['a', 'b'], model: 'BAAI/bge-m3' },
        expect.objectContaining({ timeout: 60000 }),
      );
      expect(result).toEqual(arr);
    });

    /**
     * TC-RAG-EMB-005
     * Objective: Batch lỗi non-dev → throw Error
     */
    it('TC-RAG-EMB-005 - should throw when batch fails in non-dev', async () => {
      mockedAxios.post.mockRejectedValue(new Error('fail'));
      await expect(
        service.generateBatchEmbeddings(['a']),
      ).rejects.toThrow(/Batch embedding generation failed/);
    });

    /**
     * TC-RAG-EMB-006
     * Objective: Batch lỗi dev → trả mock embeddings cho từng text
     */
    it('TC-RAG-EMB-006 - should return mock batch in dev on failure', async () => {
      process.env.NODE_ENV = 'development';
      mockedAxios.post.mockRejectedValue(new Error('fail'));
      const result = await service.generateBatchEmbeddings(['a', 'b', 'c']);
      expect(result).toHaveLength(3);
      expect(result[0]).toHaveLength(1024);
    });
  });

  describe('calculateCosineSimilarity', () => {
    /**
     * TC-RAG-EMB-007
     * Objective: Hai vector trùng hướng (collinear) → similarity = 1
     */
    it('TC-RAG-EMB-007 - should return 1 for identical vectors', () => {
      const v = [1, 2, 3];
      expect(service.calculateCosineSimilarity(v, v)).toBeCloseTo(1, 5);
    });

    /**
     * TC-RAG-EMB-008
     * Objective: Hai vector vuông góc → similarity = 0
     */
    it('TC-RAG-EMB-008 - should return 0 for orthogonal vectors', () => {
      expect(
        service.calculateCosineSimilarity([1, 0, 0], [0, 1, 0]),
      ).toBeCloseTo(0, 5);
    });

    /**
     * TC-RAG-EMB-009
     * Objective: Hai vector khác chiều dài → throw Error
     */
    it('TC-RAG-EMB-009 - should throw when lengths differ', () => {
      expect(() =>
        service.calculateCosineSimilarity([1, 2], [1, 2, 3]),
      ).toThrow(/same length/);
    });

    /**
     * TC-RAG-EMB-010
     * Objective: Vector toàn 0 → trả về 0 (tránh chia cho 0)
     */
    it('TC-RAG-EMB-010 - should return 0 when one vector is zero', () => {
      expect(
        service.calculateCosineSimilarity([0, 0, 0], [1, 1, 1]),
      ).toBe(0);
    });
  });

  describe('healthCheck', () => {
    /**
     * TC-RAG-EMB-011
     * Objective: GET /health 200 → trả true
     */
    it('TC-RAG-EMB-011 - should return true when service healthy', async () => {
      mockedAxios.get.mockResolvedValue({ status: 200 });
      expect(await service.healthCheck()).toBe(true);
      expect(mockedAxios.get).toHaveBeenCalledWith(
        'http://test:8000/health',
        expect.objectContaining({ timeout: 5000 }),
      );
    });

    /**
     * TC-RAG-EMB-012
     * Objective: GET /health lỗi → trả false
     */
    it('TC-RAG-EMB-012 - should return false when health check fails', async () => {
      mockedAxios.get.mockRejectedValue(new Error('down'));
      expect(await service.healthCheck()).toBe(false);
    });

    /**
     * TC-RAG-EMB-013
     * Objective: GET /health status != 200 → trả false
     */
    it('TC-RAG-EMB-013 - should return false when status is not 200', async () => {
      mockedAxios.get.mockResolvedValue({ status: 503 });
      expect(await service.healthCheck()).toBe(false);
    });
  });
});
