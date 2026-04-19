import { Test, TestingModule } from '@nestjs/testing';
import { HttpException, HttpStatus } from '@nestjs/common';
import { AudioGenService } from './audio-gen.service';
import { VoiceType, GenerateAudioDto } from './dto/generate-audio.dto';
import axios from 'axios';

// Mocking axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('AudioGenService', () => {
  let service: AudioGenService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AudioGenService],
    }).compile();

    service = module.get<AudioGenService>(AudioGenService);
    jest.clearAllMocks();
  });

  describe('generateAudio', () => {
    const generateAudioDto: GenerateAudioDto = {
      text: 'Xin chào',
      voice: VoiceType.FEMALE,
    };

    /**
     * [TC-AUDIO-001] Tạo âm thanh thành công
     * Mục tiêu: Đảm bảo dữ liệu nhận về từ API được chuyển đổi đúng sang Buffer.
     */
    it('nên tạo âm thanh thành công và trả về Buffer (TC-AUDIO-001)', async () => {
      const mockAudioData = Buffer.from('mock audio content');
      mockedAxios.post.mockResolvedValueOnce({
        data: mockAudioData,
      });

      const result = await service.generateAudio(generateAudioDto);

      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.stringContaining('/tts'),
        {
          text: generateAudioDto.text,
          voice: generateAudioDto.voice,
        },
        expect.any(Object),
      );
      expect(result).toEqual(mockAudioData);
      expect(Buffer.isBuffer(result)).toBe(true);
    });

    /**
     * [TC-AUDIO-002] Xử lý lỗi 500 từ dịch vụ TTS bên ngoài
     * Mục tiêu: Backend phải bắt được lỗi HTTP và ném ra đúng HttpException.
     */
    it('nên ném lỗi HttpException khi dịch vụ TTS trả về lỗi response (TC-AUDIO-002)', async () => {
      const mockError = {
        isAxiosError: true,
        response: {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          statusText: 'Internal Server Error',
        },
      };
      
      (axios.isAxiosError as unknown as jest.Mock).mockReturnValue(true);
      mockedAxios.post.mockRejectedValue(mockError);

      await expect(service.generateAudio(generateAudioDto)).rejects.toThrow(HttpException);
      try {
        await service.generateAudio(generateAudioDto);
      } catch (e: any) {
        expect(e.getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
        expect(e.message).toContain('TTS service error');
      }
    });

    /**
     * [TC-AUDIO-003] Xử lý lỗi kết nối (Network Error)
     * Mục tiêu: Trả về Service Unavailable khi server TTS không phản hồi.
     */
    it('nên ném lỗi SERVICE_UNAVAILABLE khi không kết nối được tới TTS (TC-AUDIO-003)', async () => {
      const mockError = {
        isAxiosError: true,
        message: 'Network Error',
      };
      
      (axios.isAxiosError as unknown as jest.Mock).mockReturnValue(true);
      mockedAxios.post.mockRejectedValue(mockError);

      await expect(service.generateAudio(generateAudioDto)).rejects.toThrow(HttpException);
      try {
        await service.generateAudio(generateAudioDto);
      } catch (e: any) {
        expect(e.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
      }
    });

    /**
     * [TC-AUDIO-004] Xử lý lỗi không xác định
     * Mục tiêu: Đảm bảo các lỗi lạ không làm crash app và trả về 500.
     */
    it('nên ném lỗi INTERNAL_SERVER_ERROR cho các lỗi không xác định (TC-AUDIO-004)', async () => {
      (axios.isAxiosError as unknown as jest.Mock).mockReturnValue(false);
      mockedAxios.post.mockRejectedValue(new Error('Unknown Error'));

      await expect(service.generateAudio(generateAudioDto)).rejects.toThrow(HttpException);
    });
  });

  describe('checkHealth', () => {
    /**
     * [TC-AUDIO-005] Kiểm tra sức khỏe dịch vụ thành công
     */
    it('nên trả về dữ liệu health check khi thành công (TC-AUDIO-005)', async () => {
      const mockHealthData = { status: 'ok', service: 'tts' };
      mockedAxios.get.mockResolvedValueOnce({ data: mockHealthData });

      const result = await service.checkHealth();
      expect(result).toEqual(mockHealthData);
    });

    /**
     * [TC-AUDIO-006] Xử lý khi health check thất bại
     */
    it('nên ném lỗi khi health check thất bại (TC-AUDIO-006)', async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error('Down'));

      await expect(service.checkHealth()).rejects.toThrow(HttpException);
    });
  });
});
