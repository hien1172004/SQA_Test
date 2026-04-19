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
    // [TC-USR-001] Tạo người dùng mới thành công
    it('nên tạo và lưu một người dùng mới (TC-USR-001)', async () => {
      const dto = { email: 'test@example.com', displayName: 'Test' };
      const passwordHash = 'hashed_password';
      mockUserRepo.create.mockReturnValue({ ...dto, passwordHash });
      mockUserRepo.save.mockResolvedValue({ id: 1, ...dto });

      const result = await service.create(dto as any, passwordHash);

      expect(result.id).toBe(1);
      // [CheckDB] Xác nhận repository đã được gọi để lưu bản ghi
      expect(mockUserRepo.save).toHaveBeenCalled();
    });
  });

  describe('findByEmail', () => {
    // [TC-USR-002] Tìm người dùng theo Email
    it('nên trả về user nếu email tồn tại (TC-USR-002)', async () => {
      mockUserRepo.findOne.mockResolvedValue({ id: 1, email: 'test@test.com' });
      const result = await service.findByEmail('test@test.com');
      expect(result!.id).toBe(1);
    });
  });

  describe('findById', () => {
    // [TC-USR-003] Tìm người dùng theo ID
    it('nên trả về user nếu id tồn tại (TC-USR-003)', async () => {
      mockUserRepo.findOne.mockResolvedValue({ id: 1 });
      const result = await service.findById(1);
      expect(result!.id).toBe(1);
    });
  });

  describe('findAll', () => {
    // [TC-USR-004] Quản trị viên lấy danh sách người dùng với các bộ lọc
    it('nên trả về danh sách user có phân trang và filter (TC-USR-004)', async () => {
      const query = { page: 1, limit: 10, role: Role.User, isActive: true };
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      await service.findAll(query);

      // Kiểm tra filter role và isActive có được áp dụng không
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledTimes(2);
      expect(mockQueryBuilder.take).toHaveBeenCalledWith(10);
    });

    // [TC-USR-005] Lấy danh sách với tham số mặc định
    it('nên dùng tham số mặc định nếu không truyền query (TC-USR-005)', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);
      await service.findAll({});
      expect(mockQueryBuilder.skip).toHaveBeenCalledWith(0);
    });
  });

  describe('updateProfile', () => {
    const userId = 1;
    const updateDto = { displayName: 'New Name' };

    // [TC-USR-006] Người dùng tự cập nhật thông tin thành công
    it('cho phép người dùng tự sửa profile của mình (TC-USR-006)', async () => {
      const user = { id: userId, email: 'old@test.com' };
      mockUserRepo.findOne.mockResolvedValue(user);
      mockUserRepo.save.mockImplementation(u => Promise.resolve(u));

      const result = await service.updateProfile(userId, updateDto, userId, Role.User);

      expect(result.displayName).toBe('New Name');
    });

    // [TC-USR-007] Admin cập nhật thông tin cho người dùng khác
    it('cho phép admin sửa profile của bất kỳ ai (TC-USR-007)', async () => {
      const user = { id: userId };
      mockUserRepo.findOne.mockResolvedValue(user);

      await service.updateProfile(userId, updateDto, 999, Role.Admin);
      expect(mockUserRepo.save).toHaveBeenCalled();
    });

    // [TC-USR-008] Lỗi khi sửa profile người không tồn tại
    it('báo lỗi NotFoundException nếu user không tồn tại (TC-USR-008)', async () => {
      mockUserRepo.findOne.mockResolvedValue(null);
      await expect(service.updateProfile(99, {}, 99, Role.User)).rejects.toThrow(NotFoundException);
    });

    // [TC-USR-009] Lỗi khi người dùng sửa profile người khác (không phải admin)
    it('báo lỗi ForbiddenException nếu không phải chính chủ hoặc admin (TC-USR-009)', async () => {
      mockUserRepo.findOne.mockResolvedValue({ id: 1 });
      await expect(service.updateProfile(1, {}, 2, Role.User)).rejects.toThrow(ForbiddenException);
    });

    // [TC-USR-010] Cập nhật email thành công
    it('cho phép đổi email nếu email mới chưa bị ai dùng (TC-USR-010)', async () => {
      const user = { id: 1, email: 'old@test.com' };
      const dto = { email: 'new@test.com' };
      mockUserRepo.findOne
        .mockResolvedValueOnce(user) // Cho findById
        .mockResolvedValueOnce(null); // Cho check trùng email

      await service.updateProfile(1, dto, 1, Role.User);
      expect(mockUserRepo.save).toHaveBeenCalled();
    });

    // [TC-USR-011] Lỗi khi đổi email bị trùng lặp
    it('báo lỗi BadRequestException nếu email mới đã có người dùng (TC-USR-011)', async () => {
      const user = { id: 1, email: 'old@test.com' };
      mockUserRepo.findOne
        .mockResolvedValueOnce(user)
        .mockResolvedValueOnce({ id: 2, email: 'dupe@test.com' });

      await expect(service.updateProfile(1, { email: 'dupe@test.com' }, 1, Role.User)).rejects.toThrow(BadRequestException);
    });
  });

  describe('adminUpdateUser', () => {
    // [TC-USR-012] Admin cập nhật toàn diện thông tin user
    it('admin có thể cập nhật mọi thông tin (TC-USR-012)', async () => {
      const user = { id: 1, email: 'old@test.com' };
      mockUserRepo.findOne.mockResolvedValue(user);
      
      await service.adminUpdateUser(1, { role: Role.Admin });
      expect(mockUserRepo.save).toHaveBeenCalled();
    });

    // [TC-USR-013] Lỗi admin update khi đổi email bị trùng
    it('báo lỗi nếu admin đổi email sang email đã tồn tại (TC-USR-013)', async () => {
      const user = { id: 1, email: 'a@test.com' };
      mockUserRepo.findOne
        .mockResolvedValueOnce(user)
        .mockResolvedValueOnce({ id: 2, email: 'b@test.com' });

      await expect(service.adminUpdateUser(1, { email: 'b@test.com' })).rejects.toThrow(BadRequestException);
    });

    // [TC-USR-014] Lỗi admin update user không thấy
    it('báo lỗi if user not found for admin update (TC-USR-014)', async () => {
      mockUserRepo.findOne.mockResolvedValue(null);
      await expect(service.adminUpdateUser(99, {})).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteUser (Soft Delete)', () => {
    // [TC-USR-015] Vô hiệu hóa tài khoản (Soft Delete)
    it('nên chuyển isActive sang false khi xóa mềm (TC-USR-015)', async () => {
      const user = { id: 1, isActive: true };
      mockUserRepo.findOne.mockResolvedValue(user);

      await service.deleteUser(1);

      expect(user.isActive).toBe(false);
      expect(mockUserRepo.save).toHaveBeenCalledWith(user);
    });

    // [TC-USR-016] Lỗi xóa mềm user không tồn tại
    it('báo lỗi if user not found for soft delete (TC-USR-016)', async () => {
      mockUserRepo.findOne.mockResolvedValue(null);
      await expect(service.deleteUser(99)).rejects.toThrow(NotFoundException);
    });
  });

  describe('hardDeleteUser', () => {
    // [TC-USR-017] Xóa vĩnh viễn tài khoản thành công
    it('nên gọi hàm delete thực sự trong DB (TC-USR-017)', async () => {
      mockUserRepo.delete.mockResolvedValue({ affected: 1 });
      await service.hardDeleteUser(1);
      expect(mockUserRepo.delete).toHaveBeenCalledWith(1);
    });

    // [TC-USR-018] Lỗi xóa vĩnh viễn user không tồn tại
    it('báo lỗi if affected is 0 for hard delete (TC-USR-018)', async () => {
      mockUserRepo.delete.mockResolvedValue({ affected: 0 });
      await expect(service.hardDeleteUser(1)).rejects.toThrow(NotFoundException);
    });
  });

  describe('restoreUser', () => {
    // [TC-USR-019] Khôi phục tài khoản bị vô hiệu hóa
    it('nên chuyển isActive lại thành true khi khôi phục (TC-USR-019)', async () => {
      const user = { id: 1, isActive: false };
      mockUserRepo.findOne.mockResolvedValue(user);

      await service.restoreUser(1);

      expect(user.isActive).toBe(true);
      expect(mockUserRepo.save).toHaveBeenCalled();
    });

    // [TC-USR-020] Lỗi khôi phục user không tồn tại
    it('báo lỗi if user not found for restore (TC-USR-020)', async () => {
      mockUserRepo.findOne.mockResolvedValue(null);
      await expect(service.restoreUser(1)).rejects.toThrow(NotFoundException);
    });
  });

  describe('getUserStats', () => {
    // [TC-USR-021] Lấy thống kê tổng hợp người dùng
    it('nên trả về đầy đủ các con số thống kê (TC-USR-021)', async () => {
      mockUserRepo.count.mockResolvedValue(10); // Mock cho tất cả các cuộc gọi count()

      const result = await service.getUserStats();

      expect(result.totalUsers).toBe(10);
      expect(result.adminUsers).toBe(10);
      expect(mockUserRepo.count).toHaveBeenCalledTimes(5);
    });
  });
});
