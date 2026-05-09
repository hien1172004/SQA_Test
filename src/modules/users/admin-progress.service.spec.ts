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
     * [TC-ADMIN-001] Tổng hợp dữ liệu thống kê tổng quan cho Dashboard Quản trị.
     * Mục tiêu: Xác nhận hệ thống tính toán chính xác điểm trung bình, chuỗi học tập trung bình và top người dùng từ DB.
     */
    it('should return complete overview statistics for the admin dashboard (TC-ADMIN-001)', async () => {
      // --- ARRANGE ---
      (userRepo.count as jest.Mock).mockResolvedValueOnce(100).mockResolvedValueOnce(80);
      (progressRepo.count as jest.Mock).mockResolvedValue(500);
      
      mockQueryBuilder.getRawOne
        .mockResolvedValueOnce({ avg: '85.5' }) // Giả lập điểm trung bình trả về từ SQL AVG()
        .mockResolvedValueOnce({ avg: '5.2' });  // Giả lập chuỗi học tập trung bình
      
      mockQueryBuilder.getRawMany.mockResolvedValue([
        { userId: 1, displayName: 'Top User', metric: 10 }
      ]);

      // --- ACT ---
      const result = await service.getOverviewStats();

      // --- ASSERT ---
      expect(result.totalUsers).toBe(100);
      expect(result.averageScore).toBe(85.5);
      expect(result.topUsers).toHaveLength(1);
    });

    /**
     * [TC-ADMIN-002] Xử lý an toàn khi cơ sở dữ liệu chưa có dữ liệu (kết quả truy vấn null).
     * Mục tiêu: Đảm bảo dashboard không bị lỗi hiển thị khi các hàm AVG() của SQL trả về null.
     */
    it('should return zero values when aggregation results are null or empty (TC-ADMIN-002)', async () => {
      // --- ARRANGE ---
      (userRepo.count as jest.Mock).mockResolvedValue(0);
      (progressRepo.count as jest.Mock).mockResolvedValue(0);
      mockQueryBuilder.getRawOne.mockResolvedValue(null);
      mockQueryBuilder.getRawMany.mockResolvedValue([]);

      // --- ACT ---
      const result = await service.getOverviewStats();

      // --- ASSERT ---
      // [CheckDB] Trả về 0 mặc định thay vì null.
      expect(result.averageScore).toBe(0);
      expect(result.averageStreak).toBe(0);
    });
  });

  describe('getUserProgressDetails', () => {
    /**
     * [TC-ADMIN-003] Lỗi khi truy xuất tiến độ của người dùng không tồn tại.
     */
    it('nên báo lỗi NotFoundException khi userId không tồn tại (TC-ADMIN-003)', async () => {
      // --- ARRANGE ---
      (userRepo.findOne as jest.Mock).mockResolvedValue(null);

      // --- ACT & ASSERT ---
      await expect(service.getUserProgressDetails(999)).rejects.toThrow(NotFoundException);
    });

    /**
     * [TC-ADMIN-004] Truy xuất báo cáo chi tiết về tiến độ học tập của người dùng.
     * Mục tiêu: Xác nhận việc tổng hợp thông tin bài học đã hoàn thành và phân tích tỷ lệ hoàn thành từng khóa học.
     */
    it('nên trả về báo cáo tiến độ chi tiết của người dùng (TC-ADMIN-004)', async () => {
      // --- ARRANGE ---
      const mockUser = { id: 1, email: 'test@hmail.com', currentStreak: 5 };
      (userRepo.findOne as jest.Mock).mockResolvedValue(mockUser);
      
      // Giả lập danh sách bài học đã hoàn thành.
      mockQueryBuilder.getMany.mockResolvedValueOnce([
        { lessonId: 10, scorePercentage: 90, completedAt: new Date(), lesson: { name: 'L1', courseId: 100, course: { title: 'C1' } } }
      ]);

      // Giả lập dữ liệu khóa học để phân tích (Course Breakdown).
      (courseRepo.find as jest.Mock).mockResolvedValue([{ id: 100, title: 'C1', isActive: true }]);
      (lessonRepo.find as jest.Mock).mockResolvedValue([{ id: 10, isActive: true }]);
      
      // Giả lập điểm số trung bình trong vòng lặp phân tích.
      mockQueryBuilder.getMany.mockResolvedValueOnce([{ scorePercentage: 100 }]);

      // --- ACT ---
      const result = await service.getUserProgressDetails(1);
      
      // --- ASSERT ---
      expect(result.user.id).toBe(1);
      // [CheckDB] Xác nhận tính toán đúng số lượng bài học hoàn thành trong khóa học.
      expect(result.courseBreakdown[0].completedLessons).toBe(1);
    });

    /**
     * [TC-ADMIN-005] Xử lý an toàn khi gặp khóa học không có bài học nào.
     */
    it('nên bỏ qua truy vấn tiến độ nếu khóa học không có bài học (TC-ADMIN-005)', async () => {
      // --- ARRANGE ---
      (userRepo.findOne as jest.Mock).mockResolvedValue({ id: 1 });
      mockQueryBuilder.getMany.mockResolvedValueOnce([]); // Người dùng chưa hoàn thành bài nào.
      (courseRepo.find as jest.Mock).mockResolvedValue([{ id: 2, title: 'C2', isActive: true }]);
      (lessonRepo.find as jest.Mock).mockResolvedValue([]); // Khóa học rỗng.

      // --- ACT ---
      const result = await service.getUserProgressDetails(1);

      // --- ASSERT ---
      expect(result.courseBreakdown[0].totalLessons).toBe(0);
      // [CheckDB] Đảm bảo không gọi QueryBuilder lọc theo mảng lessonIds rỗng (tránh lỗi SQL IN ()).
      expect(mockQueryBuilder.where).not.toHaveBeenCalledWith('progress.lessonId IN (:...lessonIds)', expect.any(Object));
    });
  });

  describe('getCourseAnalytics', () => {
    /**
     * [TC-ADMIN-006] Phân tích hiệu quả và tỷ lệ hoàn thành của một khóa học.
     * Mục tiêu: Xác nhận các chỉ số về số lượng học viên bắt đầu, hoàn thành và điểm số trung bình.
     */
    it('nên tính toán chính xác các chỉ số hoàn thành của khóa học (TC-ADMIN-006)', async () => {
      // --- ARRANGE ---
      (courseRepo.findOne as jest.Mock).mockResolvedValue({ id: 1, title: 'C1' });
      (lessonRepo.find as jest.Mock).mockResolvedValue([{ id: 1 }, { id: 2 }]);
      
      mockQueryBuilder.getRawOne
        .mockResolvedValueOnce({ count: '10' }) // Lần 1: usersStarted
        .mockResolvedValueOnce({ count: '2', avgScore: '80' }) // Lần 2: bài học 1
        .mockResolvedValueOnce({ count: '1', avgScore: '90' }); // Lần 3: bài học 2

      mockQueryBuilder.getRawMany.mockResolvedValue([
        { userId: 1, completed: '2' }, // Đã xong cả 2 bài -> 100%
        { userId: 2, completed: '1' }  // Mới xong 1 bài -> 50%
      ]);

      // --- ACT ---
      const result = await service.getCourseAnalytics(1);
      
      // --- ASSERT ---
      expect(result.usersStarted).toBe(10);
      expect(result.usersCompleted).toBe(1);
      // [CheckDB] Công thức: (Tổng bài hoàn thành / (Tổng user * Tổng bài học)) * 100
      expect(result.averageCompletionRate).toBe(15);
    });

    /**
     * [TC-ADMIN-007] Lỗi khi phân tích khóa học không tồn tại.
     */
    it('nên báo lỗi NotFoundException (TC-ADMIN-007)', async () => {
      // --- ARRANGE ---
      (courseRepo.findOne as jest.Mock).mockResolvedValue(null);

      // --- ACT & ASSERT ---
      await expect(service.getCourseAnalytics(1)).rejects.toThrow(NotFoundException);
    });
  });

  describe('getLessonAnalytics', () => {
    /**
     * [TC-ADMIN-008] Phân tích phổ điểm và phân phối học lực của học viên trong một bài học.
     */
    it('nên trả về phân phối điểm số chính xác (TC-ADMIN-008)', async () => {
      // --- ARRANGE ---
      (lessonRepo.findOne as jest.Mock).mockResolvedValue({ id: 1, name: 'L1', course: { title: 'C1' } });
      mockQueryBuilder.getRawOne.mockResolvedValue({ count: '3', avgScore: '50' });
      
      // Giả lập 3 học viên với các dải điểm khác nhau.
      (progressRepo.find as jest.Mock).mockResolvedValue([
        { scorePercentage: 10 },  // Thuộc dải 0-20
        { scorePercentage: 55 },  // Thuộc dải 41-60
        { scorePercentage: 99 }   // Thuộc dải 81-100
      ]);
      
      mockQueryBuilder.getMany.mockResolvedValue([
        { userId: 1, user: { displayName: 'U1' }, scorePercentage: 100, completedAt: new Date() }
      ]);

      // --- ACT ---
      const result = await service.getLessonAnalytics(1);

      // --- ASSERT ---
      // [CheckDB] Xác nhận logic đếm số lượng học viên theo từng dải điểm (Score Distribution).
      expect(result.scoreDistribution[0].count).toBe(1);
      expect(result.scoreDistribution[2].count).toBe(1);
      expect(result.scoreDistribution[4].count).toBe(1);
      expect(result.averageScore).toBe(50);
    });

    /**
     * [TC-ADMIN-009] Lỗi khi phân tích bài học không tồn tại.
     */
    it('nên báo lỗi NotFoundException (TC-ADMIN-009)', async () => {
      // --- ARRANGE ---
      (lessonRepo.findOne as jest.Mock).mockResolvedValue(null);

      // --- ACT & ASSERT ---
      await expect(service.getLessonAnalytics(1)).rejects.toThrow(NotFoundException);
    });

    /**
     * [TC-ADMIN-010] Kiểm tra logic phân loại cho các dải điểm trung gian (21-40 và 61-80).
     */
    it('should correctly categorize scores into the 21-40 and 61-80 ranges (TC-ADMIN-010)', async () => {
        // --- ARRANGE ---
        (lessonRepo.findOne as jest.Mock).mockResolvedValue({ id: 1, course: { title: '' } });
        mockQueryBuilder.getRawOne.mockResolvedValue({});
        (progressRepo.find as jest.Mock).mockResolvedValue([
            { scorePercentage: 30 }, // Rơi vào dải 2 (21-40)
            { scorePercentage: 70 }  // Rơi vào dải 4 (61-80)
        ]);
        mockQueryBuilder.getMany.mockResolvedValue([]);

        // --- ACT ---
        const result = await service.getLessonAnalytics(1);

        // --- ASSERT ---
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
