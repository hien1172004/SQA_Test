import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UsersService } from './users.service';
import { User } from './entities/user.entity';
import { NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { Role } from '../auth/enums/role.enum';

describe('UsersService', () => {
  let service: UsersService;
  let repository: Repository<User>;

  /**
   * Giả lập QueryBuilder để kiểm tra logic lọc và phân trang trong hàm findAll.
   */
  const mockQueryBuilder = {
    andWhere: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getManyAndCount: jest.fn(),
  };

  /**
   * Giả lập Repository cho User.
   */
  const mockUserRepo = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
    count: jest.fn(),
    delete: jest.fn(),
    createQueryBuilder: jest.fn(() => mockQueryBuilder),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: getRepositoryToken(User),
          useValue: mockUserRepo,
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    repository = module.get<Repository<User>>(getRepositoryToken(User));
  });

  afterEach(() => {
    // [Rollback] Đảm bảo làm sạch mock dữ liệu sau mỗi test case
    jest.clearAllMocks();
  });

  describe('create', () => {
    /**
     * [TC-USR-001] Kiểm tra chức năng đăng ký người dùng mới vào hệ thống.
     * Mục tiêu: Xác nhận hệ thống lưu trữ đúng thông tin người dùng kèm mã mật khẩu đã được xử lý.
     */
    it('should successfully create and save a new user record (TC-USR-001)', async () => {
      // --- ARRANGE ---
      const dto = { email: 'test@example.com', displayName: 'Test' };
      const passwordHash = 'hashed_password';
      mockUserRepo.create.mockReturnValue({ ...dto, passwordHash });
      mockUserRepo.save.mockResolvedValue({ id: 1, ...dto });

      // --- ACT ---
      const result = await service.create(dto as any, passwordHash);

      // --- ASSERT ---
      expect(result.id).toBe(1);
      // [CheckDB] Xác nhận repository.save được gọi để lưu bản ghi vào DB.
      expect(mockUserRepo.save).toHaveBeenCalled();
    });
  });

  describe('findByEmail', () => {
    /**
     * [TC-USR-002] Truy vấn thông tin người dùng dựa trên địa chỉ email.
     */
    it('should return the user object when the provided email exists (TC-USR-002)', async () => {
      // --- ARRANGE ---
      mockUserRepo.findOne.mockResolvedValue({ id: 1, email: 'test@test.com' });

      // --- ACT ---
      const result = await service.findByEmail('test@test.com');

      // --- ASSERT ---
      expect(result!.id).toBe(1);
    });
  });

  describe('findById', () => {
    /**
     * [TC-USR-003] Tìm kiếm người dùng theo mã định danh (ID).
     */
    it('nên trả về user nếu id tồn tại (TC-USR-003)', async () => {
      // --- ARRANGE ---
      mockUserRepo.findOne.mockResolvedValue({ id: 1 });

      // --- ACT ---
      const result = await service.findById(1);

      // --- ASSERT ---
      expect(result!.id).toBe(1);
    });
  });

  describe('findAll', () => {
    /**
     * [TC-USR-004] Quản trị viên truy xuất danh sách người dùng với các bộ lọc.
     * Mục tiêu: Xác nhận việc áp dụng Role và trạng thái Active vào QueryBuilder.
     */
    it('nên trả về danh sách user có phân trang và filter (TC-USR-004)', async () => {
      // --- ARRANGE ---
      const query = { page: 1, limit: 10, role: Role.User, isActive: true };
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      // --- ACT ---
      await service.findAll(query);

      // --- ASSERT ---
      // [CheckDB] Xác nhận QueryBuilder gọi andWhere 2 lần để lọc Role và isActive.
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledTimes(2);
      expect(mockQueryBuilder.take).toHaveBeenCalledWith(10);
    });

    /**
     * [TC-USR-005] Truy xuất danh sách với tham số phân trang mặc định.
     */
    it('nên dùng tham số mặc định nếu không truyền query (TC-USR-005)', async () => {
      // --- ARRANGE ---
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      // --- ACT ---
      await service.findAll({});

      // --- ASSERT ---
      // [CheckDB] Mặc định skip=0 khi trang đầu tiên.
      expect(mockQueryBuilder.skip).toHaveBeenCalledWith(0);
    });
  });

  describe('updateProfile', () => {
    const userId = 1;
    const updateDto = { displayName: 'New Name' };

    /**
     * [TC-USR-006] Người dùng tự cập nhật thông tin cá nhân.
     * Mục tiêu: Xác nhận quyền truy cập chính chủ (requestorId === targetId).
     */
    it('cho phép người dùng tự sửa profile của mình (TC-USR-006)', async () => {
      // --- ARRANGE ---
      const user = { id: userId, email: 'old@test.com' };
      mockUserRepo.findOne.mockResolvedValue(user);
      mockUserRepo.save.mockImplementation(u => Promise.resolve(u));

      // --- ACT ---
      const result = await service.updateProfile(userId, updateDto, userId, Role.User);

      // --- ASSERT ---
      expect(result.displayName).toBe('New Name');
    });

    /**
     * [TC-USR-007] Quản trị viên cập nhật hồ sơ của người dùng khác.
     */
    it('cho phép admin sửa profile của bất kỳ ai (TC-USR-007)', async () => {
      // --- ARRANGE ---
      const user = { id: userId };
      mockUserRepo.findOne.mockResolvedValue(user);

      // --- ACT ---
      await service.updateProfile(userId, updateDto, 999, Role.Admin);
      
      // --- ASSERT ---
      // [CheckDB] Xác nhận repository.save được gọi.
      expect(mockUserRepo.save).toHaveBeenCalled();
    });

    /**
     * [TC-USR-008] Lỗi khi cập nhật hồ sơ người dùng không tồn tại.
     */
    it('báo lỗi NotFoundException nếu user không tồn tại (TC-USR-008)', async () => {
      // --- ARRANGE ---
      mockUserRepo.findOne.mockResolvedValue(null);

      // --- ACT & ASSERT ---
      await expect(service.updateProfile(99, {}, 99, Role.User)).rejects.toThrow(NotFoundException);
    });

    /**
     * [TC-USR-009] Lỗi khi người dùng cố tình cập nhật hồ sơ của người khác.
     * Mục tiêu: Đảm bảo an toàn dữ liệu, ngăn chặn hành vi can thiệp trái phép.
     */
    it('báo lỗi ForbiddenException nếu không phải chính chủ hoặc admin (TC-USR-009)', async () => {
      // --- ARRANGE ---
      mockUserRepo.findOne.mockResolvedValue({ id: 1 });

      // --- ACT & ASSERT ---
      await expect(service.updateProfile(1, {}, 2, Role.User)).rejects.toThrow(ForbiddenException);
    });

    /**
     * [TC-USR-010] Cập nhật địa chỉ email mới thành công.
     */
    it('cho phép đổi email nếu email mới chưa bị ai dùng (TC-USR-010)', async () => {
      // --- ARRANGE ---
      const user = { id: 1, email: 'old@test.com' };
      const dto = { email: 'new@test.com' };
      mockUserRepo.findOne
        .mockResolvedValueOnce(user) // Lần 1: tìm user để update
        .mockResolvedValueOnce(null); // Lần 2: kiểm tra email mới (chưa có ai dùng)

      // --- ACT ---
      await service.updateProfile(1, dto, 1, Role.User);

      // --- ASSERT ---
      expect(mockUserRepo.save).toHaveBeenCalled();
    });

    /**
     * [TC-USR-011] Lỗi khi cập nhật email đã được sử dụng bởi tài khoản khác.
     */
    it('báo lỗi BadRequestException nếu email mới đã có người dùng (TC-USR-011)', async () => {
      // --- ARRANGE ---
      const user = { id: 1, email: 'old@test.com' };
      mockUserRepo.findOne
        .mockResolvedValueOnce(user)
        .mockResolvedValueOnce({ id: 2, email: 'dupe@test.com' });

      // --- ACT & ASSERT ---
      await expect(service.updateProfile(1, { email: 'dupe@test.com' }, 1, Role.User)).rejects.toThrow(BadRequestException);
    });
  });

  describe('adminUpdateUser', () => {
    /**
     * [TC-USR-012] Quản trị viên cập nhật toàn diện thông tin người dùng.
     */
    it('admin có thể cập nhật mọi thông tin (TC-USR-012)', async () => {
      // --- ARRANGE ---
      const user = { id: 1, email: 'old@test.com' };
      mockUserRepo.findOne.mockResolvedValue(user);
      
      // --- ACT ---
      await service.adminUpdateUser(1, { role: Role.Admin });

      // --- ASSERT ---
      // [CheckDB] Xác nhận repository.save được thực hiện.
      expect(mockUserRepo.save).toHaveBeenCalled();
    });

    /**
     * [TC-USR-013] Lỗi khi Admin đổi email của người dùng sang một email đã tồn tại.
     */
    it('báo lỗi nếu admin đổi email sang email đã tồn tại (TC-USR-013)', async () => {
      // --- ARRANGE ---
      const user = { id: 1, email: 'a@test.com' };
      mockUserRepo.findOne
        .mockResolvedValueOnce(user)
        .mockResolvedValueOnce({ id: 2, email: 'b@test.com' });

      // --- ACT & ASSERT ---
      await expect(service.adminUpdateUser(1, { email: 'b@test.com' })).rejects.toThrow(BadRequestException);
    });

    /**
     * [TC-USR-014] Lỗi khi Admin cố gắng cập nhật một tài khoản không tồn tại.
     */
    it('báo lỗi if user not found for admin update (TC-USR-014)', async () => {
      // --- ARRANGE ---
      mockUserRepo.findOne.mockResolvedValue(null);

      // --- ACT & ASSERT ---
      await expect(service.adminUpdateUser(99, {})).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteUser (Soft Delete)', () => {
    /**
     * [TC-USR-015] Vô hiệu hóa tài khoản người dùng (Xóa mềm).
     */
    it('nên chuyển isActive sang false khi xóa mềm (TC-USR-015)', async () => {
      // --- ARRANGE ---
      const user = { id: 1, isActive: true };
      mockUserRepo.findOne.mockResolvedValue(user);

      // --- ACT ---
      await service.deleteUser(1);

      // --- ASSERT ---
      // [CheckDB] Trạng thái tài khoản phải được chuyển sang false.
      expect(user.isActive).toBe(false);
      expect(mockUserRepo.save).toHaveBeenCalledWith(user);
    });

    /**
     * [TC-USR-016] Lỗi khi thực hiện xóa mềm một tài khoản không tồn tại.
     */
    it('báo lỗi if user not found for soft delete (TC-USR-016)', async () => {
      // --- ARRANGE ---
      mockUserRepo.findOne.mockResolvedValue(null);

      // --- ACT & ASSERT ---
      await expect(service.deleteUser(99)).rejects.toThrow(NotFoundException);
    });
  });

  describe('hardDeleteUser', () => {
    /**
     * [TC-USR-017] Xóa vĩnh viễn tài khoản khỏi cơ sở dữ liệu.
     */
    it('nên gọi hàm delete thực sự trong DB (TC-USR-017)', async () => {
      // --- ARRANGE ---
      mockUserRepo.delete.mockResolvedValue({ affected: 1 });

      // --- ACT ---
      await service.hardDeleteUser(1);

      // --- ASSERT ---
      // [CheckDB] Xác nhận lệnh DELETE vật lý được thực hiện.
      expect(mockUserRepo.delete).toHaveBeenCalledWith(1);
    });

    /**
     * [TC-USR-018] Lỗi khi xóa vĩnh viễn tài khoản không tồn tại.
     */
    it('báo lỗi if affected is 0 for hard delete (TC-USR-018)', async () => {
      // --- ARRANGE ---
      mockUserRepo.delete.mockResolvedValue({ affected: 0 });

      // --- ACT & ASSERT ---
      await expect(service.hardDeleteUser(1)).rejects.toThrow(NotFoundException);
    });
  });

  describe('restoreUser', () => {
    /**
     * [TC-USR-019] Khôi phục quyền truy cập cho tài khoản đã bị vô hiệu hóa.
     */
    it('nên chuyển isActive lại thành true khi khôi phục (TC-USR-019)', async () => {
      // --- ARRANGE ---
      const user = { id: 1, isActive: false };
      mockUserRepo.findOne.mockResolvedValue(user);

      // --- ACT ---
      await service.restoreUser(1);

      // --- ASSERT ---
      // [CheckDB] Trạng thái tài khoản phải được chuyển về true.
      expect(user.isActive).toBe(true);
      expect(mockUserRepo.save).toHaveBeenCalled();
    });

    /**
     * [TC-USR-020] Lỗi khi khôi phục tài khoản không tồn tại.
     */
    it('báo lỗi if user not found for restore (TC-USR-020)', async () => {
      // --- ARRANGE ---
      mockUserRepo.findOne.mockResolvedValue(null);

      // --- ACT & ASSERT ---
      await expect(service.restoreUser(1)).rejects.toThrow(NotFoundException);
    });
  });

  describe('getUserStats', () => {
    /**
     * [TC-USR-021] Tổng hợp các chỉ số thống kê về người dùng.
     */
    it('nên trả về đầy đủ các con số thống kê (TC-USR-021)', async () => {
      // --- ARRANGE ---
      mockUserRepo.count.mockResolvedValue(10);

      // --- ACT ---
      const result = await service.getUserStats();

      // --- ASSERT ---
      expect(result.totalUsers).toBe(10);
      expect(result.adminUsers).toBe(10);
      // [CheckDB] Xác nhận service gọi count 5 lần để lấy các chỉ số khác nhau (Active, Inactive, Admin, User, Total).
      expect(mockUserRepo.count).toHaveBeenCalledTimes(5);
    });
  });
});
