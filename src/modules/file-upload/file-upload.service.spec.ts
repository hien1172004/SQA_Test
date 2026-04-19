/**
 * Unit tests for FileUploadService.
 *
 * Strategy: mock-only.
 * - Mock @aws-sdk/client-s3 (S3Client, PutObjectCommand)
 * - Mock @aws-sdk/s3-request-presigner (getSignedUrl)
 * - ConfigService cấp các giá trị AWS_* hợp lệ để vượt qua validation
 *   trong constructor.
 *
 * Không dùng DB → CheckDB/Rollback không áp dụng (interaction là với S3).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';

// Mock AWS SDK BEFORE import service
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({})),
  PutObjectCommand: jest.fn().mockImplementation((input) => ({ input })),
}));

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn(),
}));

import { FileUploadService } from './file-upload.service';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const mockedGetSignedUrl = getSignedUrl as jest.MockedFunction<typeof getSignedUrl>;

describe('FileUploadService', () => {
  let service: FileUploadService;
  const validConfig: Record<string, string> = {
    AWS_REGION: 'us-east-1',
    AWS_ACCESS_KEY_ID: 'AKIAFAKE',
    AWS_SECRET_ACCESS_KEY: 'secret',
    AWS_S3_BUCKET_NAME: 'test-bucket',
  };

  const createService = async (config: Record<string, string | undefined> = validConfig) => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FileUploadService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => config[key]),
          },
        },
      ],
    }).compile();
    return module.get<FileUploadService>(FileUploadService);
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    service = await createService();
  });

  describe('constructor', () => {
    /**
     * TC-FUP-001
     * Objective: Constructor khởi tạo S3Client với region + credentials đúng
     */
    it('TC-FUP-001 - should initialize S3Client with valid config', () => {
      expect(S3Client).toHaveBeenCalledWith(
        expect.objectContaining({
          region: 'us-east-1',
          credentials: {
            accessKeyId: 'AKIAFAKE',
            secretAccessKey: 'secret',
          },
        }),
      );
    });

    /**
     * TC-FUP-002
     * Objective: Throw Error khi thiếu một biến môi trường AWS bất kỳ
     */
    it('TC-FUP-002 - should throw when AWS_REGION missing', async () => {
      await expect(createService({ ...validConfig, AWS_REGION: undefined })).rejects.toThrow(
        /AWS configuration is missing/,
      );
    });

    /**
     * TC-FUP-003
     * Objective: Throw Error khi thiếu AWS_S3_BUCKET_NAME
     */
    it('TC-FUP-003 - should throw when bucket name missing', async () => {
      await expect(createService({ ...validConfig, AWS_S3_BUCKET_NAME: undefined })).rejects.toThrow(
        /AWS configuration is missing/,
      );
    });
  });

  describe('getPresignedUploadUrl', () => {
    /**
     * TC-FUP-004
     * Objective: Tạo presigned URL với key dạng "folder/timestamp-filename" và trả 3 trường
     */
    it('TC-FUP-004 - should create presigned URL with correct key format', async () => {
      mockedGetSignedUrl.mockResolvedValue('https://signed.url');
      const before = Date.now();

      const result = await service.getPresignedUploadUrl(
        'photo.png',
        'image/png',
        'avatars',
      );

      expect(PutObjectCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          Bucket: 'test-bucket',
          ContentType: 'image/png',
        }),
      );
      const calledKey = (PutObjectCommand as unknown as jest.Mock).mock.calls[0][0].Key;
      expect(calledKey).toMatch(/^avatars\/\d+-photo\.png$/);
      const ts = parseInt(calledKey.split('/')[1].split('-')[0]);
      expect(ts).toBeGreaterThanOrEqual(before);

      expect(result.uploadUrl).toBe('https://signed.url');
      expect(result.fileUrl).toContain('test-bucket');
      expect(result.fileUrl).toContain('us-east-1');
      expect(result.key).toBe(calledKey);
    });

    /**
     * TC-FUP-005
     * Objective: Folder mặc định là 'uploads' khi không truyền
     */
    it('TC-FUP-005 - should default folder to uploads', async () => {
      mockedGetSignedUrl.mockResolvedValue('https://x');
      const result = await service.getPresignedUploadUrl('a.txt', 'text/plain');
      expect(result.key).toMatch(/^uploads\//);
    });

    /**
     * TC-FUP-006
     * Objective: getSignedUrl được gọi với expiresIn = 3600
     */
    it('TC-FUP-006 - should request signed URL with 1h expiry', async () => {
      mockedGetSignedUrl.mockResolvedValue('https://x');
      await service.getPresignedUploadUrl('a.txt', 'text/plain');
      expect(mockedGetSignedUrl).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ expiresIn: 3600 }),
      );
    });
  });

  describe('getPresignedUploadUrls (batch)', () => {
    /**
     * TC-FUP-007
     * Objective: Tạo nhiều presigned URLs song song; mỗi result kèm filename
     */
    it('TC-FUP-007 - should batch presigned URLs and include filename', async () => {
      mockedGetSignedUrl
        .mockResolvedValueOnce('https://u1')
        .mockResolvedValueOnce('https://u2');

      const result = await service.getPresignedUploadUrls([
        { filename: 'a.png', contentType: 'image/png' },
        { filename: 'b.mp3', contentType: 'audio/mpeg', folder: 'audio' },
      ]);

      expect(result).toHaveLength(2);
      expect(result[0].filename).toBe('a.png');
      expect(result[1].filename).toBe('b.mp3');
      expect(result[1].key).toMatch(/^audio\//);
    });
  });

  describe('validateFileType', () => {
    /**
     * TC-FUP-008
     * Objective: Trả true cho image/png (allowed)
     */
    it('TC-FUP-008 - should accept image/png', () => {
      expect(service.validateFileType('image/png')).toBe(true);
    });

    /**
     * TC-FUP-009
     * Objective: Trả true cho audio/mpeg
     */
    it('TC-FUP-009 - should accept audio/mpeg', () => {
      expect(service.validateFileType('audio/mpeg')).toBe(true);
    });

    /**
     * TC-FUP-010
     * Objective: Trả false cho application/pdf (không nằm trong danh sách)
     */
    it('TC-FUP-010 - should reject application/pdf', () => {
      expect(service.validateFileType('application/pdf')).toBe(false);
    });

    /**
     * TC-FUP-011
     * Objective: Trả false cho chuỗi rỗng
     */
    it('TC-FUP-011 - should reject empty string', () => {
      expect(service.validateFileType('')).toBe(false);
    });
  });
});
