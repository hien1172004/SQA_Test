import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AdminProgressService } from './admin-progress.service';
import { UserLessonProgress, LessonProgressStatus } from './entities/user-lesson-progress.entity';
import { User } from './entities/user.entity';
import { Lessons } from '../lessons/entities/lesson.entities';
import { Courses } from '../courses/entities/course.entities';
import { NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';

describe('AdminProgressService', () => {
  let service: AdminProgressService;
  let userRepo: Repository<User>;
  let progressRepo: Repository<UserLessonProgress>;
  let lessonRepo: Repository<Lessons>;
  let courseRepo: Repository<Courses>;

  // Mock QueryBuilder đa năng giúp giả lập chuỗi các lệnh TypeORM
  const mockQueryBuilder = {
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addGroupBy: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    offset: jest.fn().mockReturnThis(),
    innerJoin: jest.fn().mockReturnThis(),
    innerJoinAndSelect: jest.fn().mockReturnThis(),
    leftJoin: jest.fn().mockReturnThis(),
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    getRawOne: jest.fn(),
    getRawMany: jest.fn(),
    getMany: jest.fn(),
    count: jest.fn(),
  };

  const createMockRepo = () => ({
    find: jest.fn(),
    findOne: jest.fn(),
    count: jest.fn(),
    createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
  });

  beforeEach(async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
    
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminProgressService,
        { provide: getRepositoryToken(UserLessonProgress), useValue: createMockRepo() },
        { provide: getRepositoryToken(User), useValue: createMockRepo() },
        { provide: getRepositoryToken(Lessons), useValue: createMockRepo() },
        { provide: getRepositoryToken(Courses), useValue: createMockRepo() },
      ],
    }).compile();

    service = module.get<AdminProgressService>(AdminProgressService);
    userRepo = module.get<Repository<User>>(getRepositoryToken(User));
    progressRepo = module.get<Repository<UserLessonProgress>>(getRepositoryToken(UserLessonProgress));
    lessonRepo = module.get<Repository<Lessons>>(getRepositoryToken(Lessons));
    courseRepo = module.get<Repository<Courses>>(getRepositoryToken(Courses));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getOverviewStats', () => {
    /**
     * [TC-ADMIN-001] Kiểm tra chức năng tổng hợp dữ liệu thống kê tổng quan cho Dashboard Quản trị.
     * Kịch bản xác nhận hệ thống tính toán đúng điểm trung bình, chuỗi học tập trung bình 
     * và danh sách người dùng tiêu biểu dựa trên các truy vấn aggregation (AVG, COUNT).
     */
    it('should return complete overview statistics for the admin dashboard (TC-ADMIN-001)', async () => {
      (userRepo.count as jest.Mock).mockResolvedValueOnce(100).mockResolvedValueOnce(80);
      (progressRepo.count as jest.Mock).mockResolvedValue(500);
      
      mockQueryBuilder.getRawOne
        .mockResolvedValueOnce({ avg: '85.5' }) // Average score
        .mockResolvedValueOnce({ avg: '5.2' });  // Average streak
      
      mockQueryBuilder.getRawMany.mockResolvedValue([
        { userId: 1, displayName: 'Top User', metric: 10 }
      ]);

      const result = await service.getOverviewStats();

      expect(result.totalUsers).toBe(100);
      expect(result.averageScore).toBe(85.5);
      expect(result.topUsers).toHaveLength(1);
    });

    /**
     * [TC-ADMIN-002] Kiểm tra khả năng xử lý an toàn của hệ thống khi cơ sở dữ liệu trống hoặc truy vấn trả về null.
     * Đảm bảo các giá trị trung bình (score, streak) được trả về là 0 thay vì null để tránh lỗi hiển thị trên giao diện.
     */
    it('should return zero values when aggregation results are null or empty (TC-ADMIN-002)', async () => {
      (userRepo.count as jest.Mock).mockResolvedValue(0);
      (progressRepo.count as jest.Mock).mockResolvedValue(0);
      mockQueryBuilder.getRawOne.mockResolvedValue(null);
      mockQueryBuilder.getRawMany.mockResolvedValue([]);

      const result = await service.getOverviewStats();
      expect(result.averageScore).toBe(0);
      expect(result.averageStreak).toBe(0);
    });
  });

  describe('getUserProgressDetails', () => {
    /**
     * [TC-ADMIN-003] Báo lỗi khi không tìm thấy user
     */
    it('nên báo lỗi NotFoundException khi userId không tồn tại (TC-ADMIN-003)', async () => {
      (userRepo.findOne as jest.Mock).mockResolvedValue(null);
      await expect(service.getUserProgressDetails(999)).rejects.toThrow(NotFoundException);
    });

    /**
     * [TC-ADMIN-004] Lấy chi tiết tiến độ user thành công
     */
    it('nên trả về báo cáo tiến độ chi tiết của người dùng (TC-ADMIN-004)', async () => {
      const mockUser = { id: 1, email: 'test@hmail.com', currentStreak: 5 };
      (userRepo.findOne as jest.Mock).mockResolvedValue(mockUser);
      
      // Mock completed lessons
      mockQueryBuilder.getMany.mockResolvedValueOnce([
        { lessonId: 10, scorePercentage: 90, completedAt: new Date(), lesson: { name: 'L1', courseId: 100, course: { title: 'C1' } } }
      ]);

      // Mock courses breakdown
      (courseRepo.find as jest.Mock).mockResolvedValue([{ id: 100, title: 'C1', isActive: true }]);
      (lessonRepo.find as jest.Mock).mockResolvedValue([{ id: 10, isActive: true }]);
      
      // Mock progress in breakdown loop
      mockQueryBuilder.getMany.mockResolvedValueOnce([{ scorePercentage: 100 }]);

      const result = await service.getUserProgressDetails(1);
      
      expect(result.user.id).toBe(1);
      expect(result.courseBreakdown[0].completedLessons).toBe(1);
    });

    /**
     * [TC-ADMIN-005] Xử lý trường hợp khóa học không có bài học nào
     */
    it('nên bỏ qua truy vấn tiến độ nếu khóa học không có bài học (TC-ADMIN-005)', async () => {
      (userRepo.findOne as jest.Mock).mockResolvedValue({ id: 1 });
      mockQueryBuilder.getMany.mockResolvedValueOnce([]); // No completed lessons
      (courseRepo.find as jest.Mock).mockResolvedValue([{ id: 2, title: 'C2', isActive: true }]);
      (lessonRepo.find as jest.Mock).mockResolvedValue([]); // Empty course

      const result = await service.getUserProgressDetails(1);
      expect(result.courseBreakdown[0].totalLessons).toBe(0);
      expect(mockQueryBuilder.where).not.toHaveBeenCalledWith('progress.lessonId IN (:...lessonIds)', expect.any(Object));
    });
  });

  describe('getCourseAnalytics', () => {
    /**
     * [TC-ADMIN-006] Phân tích khóa học thành công
     */
    it('nên tính toán chính xác các chỉ số hoàn thành của khóa học (TC-ADMIN-006)', async () => {
      (courseRepo.findOne as jest.Mock).mockResolvedValue({ id: 1, title: 'C1' });
      (lessonRepo.find as jest.Mock).mockResolvedValue([{ id: 1 }, { id: 2 }]);
      
      mockQueryBuilder.getRawOne
        .mockResolvedValueOnce({ count: '10' }) // Lần gọi 1: usersStarted
        .mockResolvedValueOnce({ count: '2', avgScore: '80' }) // Lần gọi 2: lesson 1 stats
        .mockResolvedValueOnce({ count: '1', avgScore: '90' }); // Lần gọi 3: lesson 2 stats

      mockQueryBuilder.getRawMany.mockResolvedValue([
        { userId: 1, completed: '2' }, // Đã xong cả 2 bài
        { userId: 2, completed: '1' }  // Mới xong 1 bài
      ]);

      const result = await service.getCourseAnalytics(1);
      
      expect(result.usersStarted).toBe(10);
      expect(result.usersCompleted).toBe(1); // Chỉ user 1 hoàn thành 100%
      expect(result.averageCompletionRate).toBe(15); // (3 bài hoàn thành / 20 bài tối đa) * 100
    });

    /**
     * [TC-ADMIN-007] Báo lỗi khi không thấy khóa học
     */
    it('nên báo lỗi NotFoundException (TC-ADMIN-007)', async () => {
      (courseRepo.findOne as jest.Mock).mockResolvedValue(null);
      await expect(service.getCourseAnalytics(1)).rejects.toThrow(NotFoundException);
    });
  });

  describe('getLessonAnalytics', () => {
    /**
     * [TC-ADMIN-008] Phân tích bài học và phân phối điểm số
     */
    it('nên trả về phân phối điểm số chính xác (TC-ADMIN-008)', async () => {
      (lessonRepo.findOne as jest.Mock).mockResolvedValue({ id: 1, name: 'L1', course: { title: 'C1' } });
      mockQueryBuilder.getRawOne.mockResolvedValue({ count: '3', avgScore: '50' });
      
      // Mock 3 completions for range distribution
      (progressRepo.find as jest.Mock).mockResolvedValue([
        { scorePercentage: 10 },  // 0-20
        { scorePercentage: 55 },  // 41-60
        { scorePercentage: 99 }   // 81-100
      ]);
      
      mockQueryBuilder.getMany.mockResolvedValue([
        { userId: 1, user: { displayName: 'U1' }, scorePercentage: 100, completedAt: new Date() }
      ]);

      const result = await service.getLessonAnalytics(1);

      expect(result.scoreDistribution[0].count).toBe(1);
      expect(result.scoreDistribution[2].count).toBe(1);
      expect(result.scoreDistribution[4].count).toBe(1);
      expect(result.averageScore).toBe(50);
    });

    /**
     * [TC-ADMIN-009] Báo lỗi khi không thấy bài học
     */
    it('nên báo lỗi NotFoundException (TC-ADMIN-009)', async () => {
      (lessonRepo.findOne as jest.Mock).mockResolvedValue(null);
      await expect(service.getLessonAnalytics(1)).rejects.toThrow(NotFoundException);
    });

    /**
     * [TC-ADMIN-010] Kiểm tra logic phân loại điểm số cho các dải điểm ở giữa (21-40 và 61-80).
     * Đảm bảo rằng hàm phân phối (distribution) ghi nhận đúng số lượng học viên cho mọi khoảng điểm quy định.
     */
    it('should correctly categorize scores into the 21-40 and 61-80 ranges (TC-ADMIN-010)', async () => {
        (lessonRepo.findOne as jest.Mock).mockResolvedValue({ id: 1, course: { title: '' } });
        mockQueryBuilder.getRawOne.mockResolvedValue({});
        (progressRepo.find as jest.Mock).mockResolvedValue([
            { scorePercentage: 30 }, // 21-40
            { scorePercentage: 70 }  // 61-80
        ]);
        mockQueryBuilder.getMany.mockResolvedValue([]);

        const result = await service.getLessonAnalytics(1);
        expect(result.scoreDistribution[1].count).toBe(1);
        expect(result.scoreDistribution[3].count).toBe(1);
    });
  });

  describe('getLeaderboard', () => {
    /**
     * [TC-ADMIN-Leaderboard-01] Bảng xếp hạng với các giá trị chuyển đổi kiểu dữ liệu
     */
    it('nên xử lý đúng việc chuyển đổi kiểu dữ liệu trong leaderboard (TC-ADMIN-Leaderboard-01)', async () => {
      mockQueryBuilder.getRawMany
        .mockResolvedValueOnce([]) // Streak
        .mockResolvedValueOnce([{ userId: 1, displayName: 'U1', lessonsCompleted: '10' }]) // string count
        .mockResolvedValueOnce([{ userId: 1, displayName: 'U1', averageScore: '88.5' }]); // string avg

      const result = await service.getLeaderboard(5);
      expect(result.byLessonsCompleted[0].lessonsCompleted).toBe(10);
      expect(result.byAverageScore[0].averageScore).toBe(88.5);
      
      // Gọi không tham số để kích hoạt default limit = 20 (Branch line 411)
      await service.getLeaderboard();
      expect(mockQueryBuilder.limit).toHaveBeenCalledWith(20);
    });

    /**
     * [TC-ADMIN-Edge-01] Xử lý scorePercentage bị null trong getUserProgressDetails
     */
    it('nên sử dụng giá trị 0 nếu scorePercentage là null (TC-ADMIN-Edge-01)', async () => {
      (userRepo.findOne as jest.Mock).mockResolvedValue({ id: 1 });
      mockQueryBuilder.getMany.mockResolvedValueOnce([
        { lessonId: 1, scorePercentage: null, completedAt: new Date(), lesson: { name: 'L', courseId: 1, course: { title: 'C' } } }
      ]);
      (courseRepo.find as jest.Mock).mockResolvedValue([]);
      
      const result = await service.getUserProgressDetails(1);
      expect(result.completedLessons[0].scorePercentage).toBe(0);
    });

    /**
     * [TC-ADMIN-Edge-02] Xử lý null trong course analytics
     */
    it('nên xử lý ổn định khi kết quả count/avg bị null trong course analytics (TC-ADMIN-Edge-02)', async () => {
        (courseRepo.findOne as jest.Mock).mockResolvedValue({ id: 1 });
        (lessonRepo.find as jest.Mock).mockResolvedValue([{ id: 1 }]);
        
        mockQueryBuilder.getRawOne.mockResolvedValueOnce(null); // usersStartedResult is null
        mockQueryBuilder.getRawMany.mockResolvedValue([]); // completionData empty
        mockQueryBuilder.getRawOne.mockResolvedValueOnce(null); // lesson stats null

        const result = await service.getCourseAnalytics(1);
        expect(result.usersStarted).toBe(0);
        expect(result.lessonStats[0].averageScore).toBe(0);
    });

    /**
     * [TC-ADMIN-Edge-03] Xử lý các dải điểm rỗng và trung bình rỗng trong lesson analytics
     */
    it('nên trả về điểm trung bình 0 nếu không có stats (TC-ADMIN-Edge-03)', async () => {
        (lessonRepo.findOne as jest.Mock).mockResolvedValue({ id: 1, course: { title: '' } });
        mockQueryBuilder.getRawOne.mockResolvedValueOnce({ count: null, avgScore: null });
        (progressRepo.find as jest.Mock).mockResolvedValue([{ scorePercentage: null }]); // Branch line 371
        mockQueryBuilder.getMany.mockResolvedValue([{ userId: 1, user: { displayName: 'U' }, scorePercentage: null, completedAt: new Date() }]); // Branch line 392

        const result = await service.getLessonAnalytics(1);
        expect(result.averageScore).toBe(0);
        expect(result.recentCompletions[0].scorePercentage).toBe(0);
    });

    /**
     * [TC-ADMIN-Edge-04] Kiểm tra logic xử lý thống kê trên Dashboard quản trị khi kết quả trả về từ câu truy vấn aggregation (AVG) bị rỗng hoặc null.
     * Kịch bản này đảm bảo hệ thống có cơ chế xử lý lỗi an toàn (fallback), không bị lỗi crash khi chưa có dữ liệu và luôn trả về giá trị mặc định là 0.
     */
    it('should return 0 for AVG Dashboard when raw results are empty or null (TC-ADMIN-Edge-04)', async () => {
        (userRepo.count as jest.Mock).mockResolvedValue(10);
        (progressRepo.count as jest.Mock).mockResolvedValue(10);
        
        mockQueryBuilder.getRawOne
            .mockResolvedValueOnce({ avg: null }) // line 49 branch
            .mockResolvedValueOnce({ avg: undefined }); // line 56 branch
        
        mockQueryBuilder.getRawMany.mockResolvedValue([]);

        const result = await service.getOverviewStats();
        expect(result.averageScore).toBe(0);
        expect(result.averageStreak).toBe(0);
    });

    /**
     * [TC-ADMIN-Edge-05] Xử lý score null bên trong vòng lặp courseBreakdown
     */
    it('nên xử lý score null trong vòng lặp breakdown (TC-ADMIN-Edge-05)', async () => {
        (userRepo.findOne as jest.Mock).mockResolvedValue({ id: 1 });
        mockQueryBuilder.getMany.mockResolvedValueOnce([]); // completedLessons query
        (courseRepo.find as jest.Mock).mockResolvedValue([{ id: 1, title: 'C1', isActive: true }]);
        (lessonRepo.find as jest.Mock).mockResolvedValue([{ id: 1, isActive: true }]);
        
        // Mock cho query bên trong map (line 166) trả về score null
        mockQueryBuilder.getMany.mockResolvedValueOnce([{ scorePercentage: null }]);

        const result = await service.getUserProgressDetails(1);
        expect(result.courseBreakdown[0].averageScore).toBe(0);
    });

    /**
     * [TC-ADMIN-Edge-06] Kiểm tra lỗi không phải là Error object (line 212 branch)
     */
    it('nên xử lý trường hợp lỗi ném ra không phải là Error object (TC-ADMIN-Edge-06)', async () => {
        (userRepo.findOne as jest.Mock).mockImplementation(() => {
            throw "Chuỗi lỗi không phải Error object";
        });
        await expect(service.getUserProgressDetails(1)).rejects.toBeDefined();
    });
  });
});
