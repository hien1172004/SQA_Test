import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UserProgressService } from './user-progress.service';
import { UserLessonProgress, LessonProgressStatus } from './entities/user-lesson-progress.entity';
import { User } from './entities/user.entity';
import { Lessons } from '../lessons/entities/lesson.entities';
import { Courses } from '../courses/entities/course.entities';
import { SrsService } from '../srs/srs.service';
import { NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';

describe('UserProgressService', () => {
  let service: UserProgressService;
  let userRepo: Repository<User>;
  let lessonRepo: Repository<Lessons>;
  let progressRepo: Repository<UserLessonProgress>;
  let srsService: SrsService;

  const mockSrsService = {
    initializeLessonQuestionsForReview: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserProgressService,
        {
          provide: getRepositoryToken(UserLessonProgress),
          useValue: {
            findOne: jest.fn(),
            find: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(User),
          useValue: {
            findOne: jest.fn(),
            save: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(Lessons),
          useValue: {
            findOne: jest.fn(),
            find: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(Courses),
          useValue: {
            findOne: jest.fn(),
          },
        },
        { provide: SrsService, useValue: mockSrsService },
      ],
    }).compile();

    service = module.get<UserProgressService>(UserProgressService);
    userRepo = module.get<Repository<User>>(getRepositoryToken(User));
    lessonRepo = module.get<Repository<Lessons>>(getRepositoryToken(Lessons));
    progressRepo = module.get<Repository<UserLessonProgress>>(getRepositoryToken(UserLessonProgress));
    srsService = module.get<SrsService>(SrsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('completeLesson', () => {
    /**
     * [TC-PROG-001] Xác thực khả năng xử lý của hệ thống khi ghi nhận tiến độ bài học cho người dùng không tồn tại.
     * Quy trình kiểm thử đảm bảo ném lỗi NotFoundException khi userId không hợp lệ.
     */
    it('should throw NotFoundException if the user does not exist during lesson completion (TC-PROG-001)', async () => {
      (userRepo.findOne as jest.Mock).mockResolvedValue(null);
      await expect(service.completeLesson(1, 1, 100)).rejects.toThrow(NotFoundException);
    });

    /**
     * [TC-PROG-002] Hoàn thành bài học nhưng không tìm thấy bài học
     */
    it('nên báo lỗi NotFoundException nếu không tìm thấy bài học (TC-PROG-002)', async () => {
      (userRepo.findOne as jest.Mock).mockResolvedValue({ id: 1 });
      (lessonRepo.findOne as jest.Mock).mockResolvedValue(null);
      await expect(service.completeLesson(1, 1, 100)).rejects.toThrow(NotFoundException);
    });

    /**
     * [TC-PROG-003] Kiểm tra chức năng ghi nhận tiến độ lần đầu tiên cho một bài học (New Progress).
     * Xác nhận rằng hệ thống khởi tạo bản ghi tiến độ mới, gán trạng thái COMPLETED 
     * và gọi dịch vụ SRS (Spaced Repetition System) để khởi tạo các câu hỏi ôn tập.
     */
    it('should create a new progress record when completing a lesson for the first time (TC-PROG-003)', async () => {
      const user = { id: 1, lastStudyDate: null };
      const lesson = { id: 1, name: 'Lesson 1' };
      (userRepo.findOne as jest.Mock).mockResolvedValue(user);
      (lessonRepo.findOne as jest.Mock).mockResolvedValue(lesson);
      (progressRepo.findOne as jest.Mock).mockResolvedValue(null); // Chưa có progress
      (progressRepo.create as jest.Mock).mockReturnValue({ id: 10, status: LessonProgressStatus.COMPLETED });
      (progressRepo.save as jest.Mock).mockImplementation(p => Promise.resolve(p));

      const result = await service.completeLesson(1, 1, 95);

      expect(result.status).toBe(LessonProgressStatus.COMPLETED);
      expect(progressRepo.create).toHaveBeenCalled();
      // [CheckDB] Đảm bảo gọi SRS init
      expect(srsService.initializeLessonQuestionsForReview).toHaveBeenCalled();
    });

    /**
     * [TC-PROG-004] Hoàn thành bài học đã từng học (cập nhật progress)
     */
    it('nên cập nhật bản ghi cũ nếu đã tồn tại tiến độ (TC-PROG-004)', async () => {
      const user = { id: 1, lastStudyDate: new Date(), currentStreak: 1, longestStreak: 1, totalStudyDays: 1 };
      const lesson = { id: 1 };
      const existingProgress = { id: 10, status: LessonProgressStatus.NOT_STARTED };
      (userRepo.findOne as jest.Mock).mockResolvedValue(user);
      (lessonRepo.findOne as jest.Mock).mockResolvedValue(lesson);
      (progressRepo.findOne as jest.Mock).mockResolvedValue(existingProgress);
      (progressRepo.save as jest.Mock).mockImplementation(p => Promise.resolve(p));

      const result = await service.completeLesson(1, 1, 80);

      expect(result.status).toBe(LessonProgressStatus.COMPLETED);
      expect(progressRepo.create).not.toHaveBeenCalled();
    });

    /**
     * [TC-PROG-005] Xử lý lỗi khi SRS init thất bại (không làm fail cả quá trình)
     */
    it('nên tiếp tục hoàn thành bài học kể cả khi SRS init bị lỗi (TC-PROG-005)', async () => {
      (userRepo.findOne as jest.Mock).mockResolvedValue({ id: 1, lastStudyDate: null });
      (lessonRepo.findOne as jest.Mock).mockResolvedValue({ id: 1 });
      (progressRepo.findOne as jest.Mock).mockResolvedValue(null);
      (progressRepo.create as jest.Mock).mockReturnValue({});
      (progressRepo.save as jest.Mock).mockResolvedValue({});
      (srsService.initializeLessonQuestionsForReview as jest.Mock).mockRejectedValue(new Error('SRS Error'));

      const result = await service.completeLesson(1, 1, 100);
      expect(result).toBeDefined();
    });
  });

  describe('updateStudyStreak (Logic Chuỗi Học Tập)', () => {
    /**
     * [TC-STREAK-01] Kiểm tra logic khởi tạo chuỗi học tập (Streak) cho người dùng mới bắt đầu.
     * Xác nhận rằng trong lần học đầu tiên, cả chuỗi hiện tại và chuỗi dài nhất đều được đặt là 1.
     */
    it('should initialize study streak to 1 for the first study session (TC-STREAK-01)', async () => {
      const user = { id: 1, lastStudyDate: null, currentStreak: 0, longestStreak: 0, totalStudyDays: 0 };
      const lesson = { id: 1 };
      (userRepo.findOne as jest.Mock).mockResolvedValue(user);
      (lessonRepo.findOne as jest.Mock).mockResolvedValue(lesson);
      (progressRepo.findOne as jest.Mock).mockResolvedValue({});
      (progressRepo.save as jest.Mock).mockResolvedValue({});

      await service.completeLesson(1, 1, 100);

      expect(user.currentStreak).toBe(1);
      expect(user.longestStreak).toBe(1);
      expect(userRepo.save).toHaveBeenCalled();
    });

    /**
     * [TC-STREAK-02] Học vào ngày kế tiếp (Tăng chuỗi)
     */
    it('nên tăng chuỗi nếu học vào ngày kế tiếp (TC-STREAK-02)', async () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const user = { id: 1, lastStudyDate: yesterday, currentStreak: 5, longestStreak: 5, totalStudyDays: 5 };
      
      (userRepo.findOne as jest.Mock).mockResolvedValue(user);
      (lessonRepo.findOne as jest.Mock).mockResolvedValue({ id: 1 });
      (progressRepo.findOne as jest.Mock).mockResolvedValue({});
      
      await service.completeLesson(1, 1, 100);

      expect(user.currentStreak).toBe(6);
      expect(user.totalStudyDays).toBe(6);
      expect(user.longestStreak).toBe(6);
    });

    /**
     * [TC-STREAK-03] Học cùng một ngày (Không đổi chuỗi)
     */
    it('không thay đổi chuỗi nếu học nhiều lần trong một ngày (TC-STREAK-03)', async () => {
      const today = new Date();
      const user = { id: 1, lastStudyDate: today, currentStreak: 5 };
      
      (userRepo.findOne as jest.Mock).mockResolvedValue(user);
      (lessonRepo.findOne as jest.Mock).mockResolvedValue({ id: 1 });
      (progressRepo.findOne as jest.Mock).mockResolvedValue({});
      
      await service.completeLesson(1, 1, 100);

      expect(user.currentStreak).toBe(5);
      expect(userRepo.save).not.toHaveBeenCalled(); // Private method returns early
    });

    /**
     * [TC-STREAK-04] Học sau một khoảng thời gian gián đoạn (Reset chuỗi)
     */
    it('nên reset chuỗi về 1 nếu học sau khi bị gián đoạn (TC-STREAK-04)', async () => {
      const longTimeAgo = new Date();
      longTimeAgo.setDate(longTimeAgo.getDate() - 3);
      const user = { id: 1, lastStudyDate: longTimeAgo, currentStreak: 10, longestStreak: 10, totalStudyDays: 10 };
      
      (userRepo.findOne as jest.Mock).mockResolvedValue(user);
      (lessonRepo.findOne as jest.Mock).mockResolvedValue({ id: 1 });
      (progressRepo.findOne as jest.Mock).mockResolvedValue({});
      
      await service.completeLesson(1, 1, 100);

      expect(user.currentStreak).toBe(1);
      expect(user.totalStudyDays).toBe(11);
      expect(user.longestStreak).toBe(10);
    });
    
    /**
     * [TC-STREAK-05] Không cập nhật gì nếu user bỗng nhiên mất (early return)
     */
    it('nên thoát sớm nếu user không tồn tại trong updateStudyStreak (TC-STREAK-05)', async () => {
        // Mặc dù completeLesson đã check user, nhưng updateStudyStreak cũng có check phụ
        // Ta cần mock findOne trả về null ở lần gọi thứ 2 (trong private method)
        (userRepo.findOne as jest.Mock)
            .mockResolvedValueOnce({ id: 1 }) // Check ở completeLesson
            .mockResolvedValueOnce(null);    // Check ở updateStudyStreak
        
        (lessonRepo.findOne as jest.Mock).mockResolvedValue({ id: 1 });
        (progressRepo.findOne as jest.Mock).mockResolvedValue({});
        
        await service.completeLesson(1, 1, 100);
        expect(userRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('getLessonProgress', () => {
    /**
     * [TC-PROG-006] Lấy tiến độ của một bài học cụ thể
     */
    it('nên trả về thông tin tiến độ kèm quan hệ lesson (TC-PROG-006)', async () => {
      const progress = { id: 1, status: LessonProgressStatus.COMPLETED };
      (progressRepo.findOne as jest.Mock).mockResolvedValue(progress);

      const result = await service.getLessonProgress(1, 1);
      expect(result).toEqual(progress);
    });
  });

  describe('getCourseProgress', () => {
    /**
     * [TC-PROG-007] Lấy tiến độ khóa học khi không có bài học nào
     */
    it('nên trả về mảng rỗng nếu khóa học không có bài học (TC-PROG-007)', async () => {
      (lessonRepo.find as jest.Mock).mockResolvedValue([]);
      const result = await service.getCourseProgress(1, 1);
      expect(result).toEqual([]);
    });

    /**
     * [TC-PROG-008] Lấy tiến độ khóa học với các trạng thái học tập khác nhau
     */
    it('nên tổng hợp trạng thái học tập của tất cả bài học trong khóa (TC-PROG-008)', async () => {
      const lessons = [
        { id: 1, name: 'L1' },
        { id: 2, name: 'L2' }
      ];
      const progress = [
        { lessonId: 1, status: LessonProgressStatus.COMPLETED, scorePercentage: 100, completedAt: new Date() }
      ];

      (lessonRepo.find as jest.Mock).mockResolvedValue(lessons);
      (progressRepo.find as jest.Mock).mockResolvedValue(progress);

      const result = await service.getCourseProgress(1, 1);

      expect(result).toHaveLength(2);
      expect(result[0].status).toBe(LessonProgressStatus.COMPLETED);
      expect(result[1].status).toBe(LessonProgressStatus.NOT_STARTED);
      expect(result[1].scorePercentage).toBeNull();
    });
  });

  describe('getStudyInfo', () => {
    /**
     * [TC-PROG-009] Lấy thông tin học tập của người dùng thành công
     */
    it('nên trả về các thông số streak và số ngày học (TC-PROG-009)', async () => {
      const user = { currentStreak: 5, longestStreak: 10, totalStudyDays: 20, lastStudyDate: new Date() };
      (userRepo.findOne as jest.Mock).mockResolvedValue(user);

      const result = await service.getStudyInfo(1);
      expect(result.currentStreak).toBe(5);
    });

    /**
     * [TC-PROG-010] Báo lỗi khi lấy study info của user không tồn tại
     */
    it('nên báo lỗi NotFoundException (TC-PROG-010)', async () => {
      (userRepo.findOne as jest.Mock).mockResolvedValue(null);
      await expect(service.getStudyInfo(1)).rejects.toThrow(NotFoundException);
    });
  });
});
