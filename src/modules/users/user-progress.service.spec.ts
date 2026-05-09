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
     * [TC-PROG-01] Lỗi khi ghi nhận tiến độ cho người dùng không tồn tại.
     * Mục tiêu: Đảm bảo tính nhất quán của dữ liệu người dùng.
     */
    it('should throw NotFoundException if the user does not exist during lesson completion (TC-PROG-01)', async () => {
      // --- ARRANGE ---
      (userRepo.findOne as jest.Mock).mockResolvedValue(null);

      // --- ACT & ASSERT ---
      await expect(service.completeLesson(1, 1, 100)).rejects.toThrow(NotFoundException);
    });

    /**
     * [TC-PROG-02] Lỗi khi ghi nhận tiến độ cho bài học không tồn tại.
     */
    it('nên báo lỗi NotFoundException nếu không tìm thấy bài học (TC-PROG-02)', async () => {
      // --- ARRANGE ---
      (userRepo.findOne as jest.Mock).mockResolvedValue({ id: 1 });
      (lessonRepo.findOne as jest.Mock).mockResolvedValue(null);

      // --- ACT & ASSERT ---
      await expect(service.completeLesson(1, 1, 100)).rejects.toThrow(NotFoundException);
    });

    /**
     * [TC-PROG-03] Ghi nhận hoàn thành bài học lần đầu tiên.
     * Mục tiêu: Xác nhận việc khởi tạo bản ghi tiến độ mới, gán trạng thái COMPLETED và kích hoạt hệ thống ôn tập SRS.
     */
    it('should create a new progress record when completing a lesson for the first time (TC-PROG-03)', async () => {
      // --- ARRANGE ---
      const user = { id: 1, lastStudyDate: null };
      const lesson = { id: 1, name: 'Lesson 1' };
      (userRepo.findOne as jest.Mock).mockResolvedValue(user);
      (lessonRepo.findOne as jest.Mock).mockResolvedValue(lesson);
      // Giả lập chưa có bất kỳ tiến độ nào được ghi nhận trước đó.
      (progressRepo.findOne as jest.Mock).mockResolvedValue(null);
      (progressRepo.create as jest.Mock).mockReturnValue({ id: 10, status: LessonProgressStatus.COMPLETED });
      (progressRepo.save as jest.Mock).mockImplementation(p => Promise.resolve(p));

      // --- ACT ---
      const result = await service.completeLesson(1, 1, 95);

      // --- ASSERT ---
      expect(result.status).toBe(LessonProgressStatus.COMPLETED);
      // [CheckDB] Xác nhận repository.create được gọi để khởi tạo bản ghi mới.
      expect(progressRepo.create).toHaveBeenCalled();
      // [CheckDB] Xác nhận dịch vụ SRS được kích hoạt để đưa câu hỏi vào danh sách ôn tập.
      expect(srsService.initializeLessonQuestionsForReview).toHaveBeenCalled();
    });

    /**
     * [TC-PROG-04] Cập nhật tiến độ cho bài học đã từng học trước đó.
     */
    it('nên cập nhật bản ghi cũ nếu đã tồn tại tiến độ (TC-PROG-04)', async () => {
      // --- ARRANGE ---
      const user = { id: 1, lastStudyDate: new Date(), currentStreak: 1, longestStreak: 1, totalStudyDays: 1 };
      const lesson = { id: 1 };
      // Đã có bản ghi NOT_STARTED từ trước.
      const existingProgress = { id: 10, status: LessonProgressStatus.NOT_STARTED };
      (userRepo.findOne as jest.Mock).mockResolvedValue(user);
      (lessonRepo.findOne as jest.Mock).mockResolvedValue(lesson);
      (progressRepo.findOne as jest.Mock).mockResolvedValue(existingProgress);
      (progressRepo.save as jest.Mock).mockImplementation(p => Promise.resolve(p));

      // --- ACT ---
      const result = await service.completeLesson(1, 1, 80);

      // --- ASSERT ---
      expect(result.status).toBe(LessonProgressStatus.COMPLETED);
      // [CheckDB] Xác nhận không tạo thêm bản ghi mới mà chỉ cập nhật trên bản ghi cũ.
      expect(progressRepo.create).not.toHaveBeenCalled();
    });

    /**
     * [TC-PROG-05] Đảm bảo quy trình ghi nhận tiến độ không bị gián đoạn nếu dịch vụ SRS gặp lỗi.
     * Mục tiêu: Ưu tiên việc lưu lại tiến độ học tập của người dùng.
     */
    it('nên tiếp tục hoàn thành bài học kể cả khi SRS init bị lỗi (TC-PROG-05)', async () => {
      // --- ARRANGE ---
      (userRepo.findOne as jest.Mock).mockResolvedValue({ id: 1, lastStudyDate: null });
      (lessonRepo.findOne as jest.Mock).mockResolvedValue({ id: 1 });
      (progressRepo.findOne as jest.Mock).mockResolvedValue(null);
      (progressRepo.create as jest.Mock).mockReturnValue({});
      (progressRepo.save as jest.Mock).mockResolvedValue({});
      // Giả lập lỗi từ hệ thống SRS.
      (srsService.initializeLessonQuestionsForReview as jest.Mock).mockRejectedValue(new Error('SRS Error'));

      // --- ACT ---
      const result = await service.completeLesson(1, 1, 100);
      
      // --- ASSERT ---
      expect(result).toBeDefined();
    });
  });

  describe('updateStudyStreak (Logic Chuỗi Học Tập)', () => {
    /**
     * [TC-STREAK-01] Khởi tạo chuỗi học tập (Streak) cho người dùng mới.
     * Mục tiêu: Xác nhận rằng trong ngày học đầu tiên, chuỗi hiện tại và chuỗi dài nhất đều đạt giá trị 1.
     */
    it('should initialize study streak to 1 for the first study session (TC-STREAK-01)', async () => {
      // --- ARRANGE ---
      const user = { id: 1, lastStudyDate: null, currentStreak: 0, longestStreak: 0, totalStudyDays: 0 };
      const lesson = { id: 1 };
      (userRepo.findOne as jest.Mock).mockResolvedValue(user);
      (lessonRepo.findOne as jest.Mock).mockResolvedValue(lesson);
      (progressRepo.findOne as jest.Mock).mockResolvedValue({});
      (progressRepo.save as jest.Mock).mockResolvedValue({});

      // --- ACT ---
      await service.completeLesson(1, 1, 100);

      // --- ASSERT ---
      expect(user.currentStreak).toBe(1);
      expect(user.longestStreak).toBe(1);
      // [CheckDB] Xác nhận thông tin streak đã được lưu vào bản ghi User.
      expect(userRepo.save).toHaveBeenCalled();
    });

    /**
     * [TC-STREAK-02] Tăng chuỗi học tập khi người dùng học vào ngày kế tiếp liên tục.
     */
    it('nên tăng chuỗi nếu học vào ngày kế tiếp (TC-STREAK-02)', async () => {
      // --- ARRANGE ---
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const user = { id: 1, lastStudyDate: yesterday, currentStreak: 5, longestStreak: 5, totalStudyDays: 5 };
      
      (userRepo.findOne as jest.Mock).mockResolvedValue(user);
      (lessonRepo.findOne as jest.Mock).mockResolvedValue({ id: 1 });
      (progressRepo.findOne as jest.Mock).mockResolvedValue({});
      
      // --- ACT ---
      await service.completeLesson(1, 1, 100);

      // --- ASSERT ---
      // Tăng chuỗi từ 5 lên 6.
      expect(user.currentStreak).toBe(6);
      expect(user.totalStudyDays).toBe(6);
      expect(user.longestStreak).toBe(6);
    });

    /**
     * [TC-STREAK-03] Không thay đổi chuỗi khi người dùng học nhiều bài trong cùng một ngày.
     */
    it('không thay đổi chuỗi nếu học nhiều lần trong một ngày (TC-STREAK-03)', async () => {
      // --- ARRANGE ---
      const today = new Date();
      const user = { id: 1, lastStudyDate: today, currentStreak: 5 };
      
      (userRepo.findOne as jest.Mock).mockResolvedValue(user);
      (lessonRepo.findOne as jest.Mock).mockResolvedValue({ id: 1 });
      (progressRepo.findOne as jest.Mock).mockResolvedValue({});
      
      // --- ACT ---
      await service.completeLesson(1, 1, 100);

      // --- ASSERT ---
      expect(user.currentStreak).toBe(5);
      // [CheckDB] Xác nhận không gọi lệnh save dư thừa để tối ưu hiệu suất.
      expect(userRepo.save).not.toHaveBeenCalled();
    });

    /**
     * [TC-STREAK-04] Đặt lại chuỗi (Reset) sau một khoảng thời gian gián đoạn không học.
     */
    it('nên reset chuỗi về 1 nếu học sau khi bị gián đoạn (TC-STREAK-04)', async () => {
      // --- ARRANGE ---
      const longTimeAgo = new Date();
      longTimeAgo.setDate(longTimeAgo.getDate() - 3); // Gián đoạn 3 ngày.
      const user = { id: 1, lastStudyDate: longTimeAgo, currentStreak: 10, longestStreak: 10, totalStudyDays: 10 };
      
      (userRepo.findOne as jest.Mock).mockResolvedValue(user);
      (lessonRepo.findOne as jest.Mock).mockResolvedValue({ id: 1 });
      (progressRepo.findOne as jest.Mock).mockResolvedValue({});
      
      // --- ACT ---
      await service.completeLesson(1, 1, 100);

      // --- ASSERT ---
      // Chuỗi bị reset về 1, nhưng chuỗi dài nhất vẫn giữ nguyên giá trị 10.
      expect(user.currentStreak).toBe(1);
      expect(user.totalStudyDays).toBe(11);
      expect(user.longestStreak).toBe(10);
    });
    
    /**
     * [TC-STREAK-05] Xử lý tình huống hiếm gặp khi tài khoản người dùng bị mất trong lúc đang xử lý streak.
     */
    it('nên thoát sớm nếu user không tồn tại trong updateStudyStreak (TC-STREAK-05)', async () => {
        // --- ARRANGE ---
        (userRepo.findOne as jest.Mock)
            .mockResolvedValueOnce({ id: 1 }) // Lần 1: findOne tại completeLesson.
            .mockResolvedValueOnce(null);    // Lần 2: findOne tại updateStudyStreak (giả lập mất user).
        
        (lessonRepo.findOne as jest.Mock).mockResolvedValue({ id: 1 });
        (progressRepo.findOne as jest.Mock).mockResolvedValue({});
        
        // --- ACT ---
        await service.completeLesson(1, 1, 100);

        // --- ASSERT ---
        expect(userRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('getLessonProgress', () => {
    /**
     * [TC-PROG-06] Truy xuất tiến độ chi tiết của một bài học cụ thể.
     */
    it('nên trả về thông tin tiến độ kèm quan hệ lesson (TC-PROG-06)', async () => {
      // --- ARRANGE ---
      const progress = { id: 1, status: LessonProgressStatus.COMPLETED };
      (progressRepo.findOne as jest.Mock).mockResolvedValue(progress);

      // --- ACT ---
      const result = await service.getLessonProgress(1, 1);

      // --- ASSERT ---
      expect(result).toEqual(progress);
    });

    /**
     * [TC-PROG-06b] Lỗi khi truy vấn tiến độ cho User không tồn tại (FAILING TEST).
     * Mục tiêu: Cảnh báo việc thiếu kiểm tra User tồn tại trước khi query DB.
     */
    it('nên báo lỗi NotFoundException nếu User không tồn tại (TC-PROG-06b)', async () => {
      // --- ARRANGE ---
      (userRepo.findOne as jest.Mock).mockResolvedValue(null);

      // --- ACT & ASSERT ---
      // BÀI TEST NÀY SẼ FAIL: Do file logic hiện tại không kiểm tra User
      await expect(service.getLessonProgress(999, 1)).rejects.toThrow(NotFoundException);
    });
  });

  describe('getCourseProgress', () => {
    /**
     * [TC-PROG-07] Truy xuất tiến độ của khóa học không chứa bài học nào.
     */
    it('nên trả về mảng rỗng nếu khóa học không có bài học (TC-PROG-07)', async () => {
      // --- ARRANGE ---
      (lessonRepo.find as jest.Mock).mockResolvedValue([]);

      // --- ACT ---
      const result = await service.getCourseProgress(1, 1);

      // --- ASSERT ---
      expect(result).toEqual([]);
    });

    /**
     * [TC-PROG-08] Tổng hợp tiến độ của toàn bộ bài học trong một khóa học.
     * Mục tiêu: Kiểm tra logic ánh xạ (map) trạng thái giữa danh sách bài học và danh sách tiến độ người dùng.
     */
    it('nên tổng hợp trạng thái học tập của tất cả bài học trong khóa (TC-PROG-08)', async () => {
      // --- ARRANGE ---
      const lessons = [
        { id: 1, name: 'L1' },
        { id: 2, name: 'L2' }
      ];
      const progress = [
        { lessonId: 1, status: LessonProgressStatus.COMPLETED, scorePercentage: 100, completedAt: new Date() }
      ];

      (lessonRepo.find as jest.Mock).mockResolvedValue(lessons);
      (progressRepo.find as jest.Mock).mockResolvedValue(progress);

      // --- ACT ---
      const result = await service.getCourseProgress(1, 1);

      // --- ASSERT ---
      expect(result).toHaveLength(2);
      // Bài học 1 đã hoàn thành.
      expect(result[0].status).toBe(LessonProgressStatus.COMPLETED);
      // Bài học 2 chưa có tiến độ -> trạng thái NOT_STARTED.
      expect(result[1].status).toBe(LessonProgressStatus.NOT_STARTED);
      expect(result[1].scorePercentage).toBeNull();
    });

    /**
     * [TC-PROG-08b] Lỗi khi truy vấn tiến độ cho Course không tồn tại (FAILING TEST).
     * Mục tiêu: Cảnh báo việc thiếu kiểm tra Course tồn tại, hiện tại hàm trả về mảng rỗng [] thay vì ném lỗi.
     */
    it('nên báo lỗi NotFoundException nếu Course không tồn tại (TC-PROG-08b)', async () => {
      // --- ARRANGE ---
      (userRepo.findOne as jest.Mock).mockResolvedValue({ id: 1 });
      ((service as any).coursesRepository.findOne as jest.Mock).mockResolvedValue(null);

      // --- ACT & ASSERT ---
      // BÀI TEST NÀY SẼ FAIL: Do file logic hiện tại lấy bài học luôn mà bỏ qua kiểm tra Course
      await expect(service.getCourseProgress(1, 999)).rejects.toThrow(NotFoundException);
    });
  });

  describe('getStudyInfo', () => {
    /**
     * [TC-PROG-09] Lấy thông tin tổng hợp về chuỗi học tập và cường độ học của người dùng.
     */
    it('nên trả về các thông số streak và số ngày học (TC-PROG-09)', async () => {
      // --- ARRANGE ---
      const user = { currentStreak: 5, longestStreak: 10, totalStudyDays: 20, lastStudyDate: new Date() };
      (userRepo.findOne as jest.Mock).mockResolvedValue(user);

      // --- ACT ---
      const result = await service.getStudyInfo(1);

      // --- ASSERT ---
      expect(result.currentStreak).toBe(5);
    });

    /**
     * [TC-PROG-10] Lỗi khi truy vấn thông tin học tập của người dùng không tồn tại.
     */
    it('nên báo lỗi NotFoundException (TC-PROG-10)', async () => {
      // --- ARRANGE ---
      (userRepo.findOne as jest.Mock).mockResolvedValue(null);

      // --- ACT & ASSERT ---
      await expect(service.getStudyInfo(1)).rejects.toThrow(NotFoundException);
    });
  });
});
