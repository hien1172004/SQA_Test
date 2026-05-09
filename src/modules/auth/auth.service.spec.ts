/**
 * Unit tests for AuthService.
 *
 * Strategy: mock-only.
 * - Mock UsersService (findByEmail, create)
 * - Mock JwtService (sign)
 * - bcrypt được mock ở module-level (jest.mock('bcrypt'))
 *
 * CheckDB: assert usersService.create / findByEmail được gọi với tham số đúng.
 *          (DB không được thay đổi vì usersService bị mock.)
 * Rollback: jest.clearAllMocks() trong afterEach.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConflictException } from '@nestjs/common';

jest.mock('bcrypt');
import * as bcrypt from 'bcrypt';

import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';

describe('AuthService', () => {
  let service: AuthService;
  let usersService: { findByEmail: jest.Mock; create: jest.Mock };
  let jwtService: { sign: jest.Mock };

  const mockedBcrypt = bcrypt as jest.Mocked<typeof bcrypt>;

  beforeEach(async () => {
    usersService = {
      findByEmail: jest.fn(),
      create: jest.fn(),
    };
    jwtService = { sign: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersService },
        { provide: JwtService, useValue: jwtService },
      ],
    }).compile();
    service = module.get<AuthService>(AuthService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('signUp', () => {
    /**
     * [TC-AUTH-001] Đăng ký người dùng mới thành công.
     * Mục tiêu: Xác nhận quy trình kiểm tra email trùng lặp, mã hóa mật khẩu và lưu trữ vào cơ sở dữ liệu.
     */
    it('TC-AUTH-001 - should create user when email is unique', async () => {
      // --- ARRANGE ---
      const dto: any = { email: 'new@x.com', password: 'pass', name: 'N' };
      // Giả lập email chưa tồn tại trong hệ thống.
      usersService.findByEmail.mockResolvedValue(null);
      mockedBcrypt.genSalt = jest.fn().mockResolvedValue('salt') as any;
      mockedBcrypt.hash = jest.fn().mockResolvedValue('hashed') as any;
      const savedUser = { id: 1, email: dto.email };
      usersService.create.mockResolvedValue(savedUser);

      // --- ACT ---
      const result = await service.signUp(dto);

      // --- ASSERT ---
      // [CheckDB] Xác nhận service thực hiện kiểm tra email trước khi tiến hành đăng ký.
      expect(usersService.findByEmail).toHaveBeenCalledWith('new@x.com');
      // [CheckDB] Xác nhận thông tin được gửi xuống tầng UsersService với mật khẩu đã mã hóa.
      expect(usersService.create).toHaveBeenCalledWith(dto, 'hashed');
      expect(result).toEqual(savedUser);
    });

    /**
     * [TC-AUTH-002] Lỗi khi đăng ký với email đã tồn tại trong hệ thống.
     * Mục tiêu: Ngăn chặn việc tạo tài khoản trùng lặp.
     */
    it('TC-AUTH-002 - should throw Conflict when email exists', async () => {
      // --- ARRANGE ---
      // Giả lập email đã có người sử dụng.
      usersService.findByEmail.mockResolvedValue({ id: 1, email: 'x@x.com' });

      // --- ACT & ASSERT ---
      await expect(
        service.signUp({ email: 'x@x.com', password: 'p' } as any),
      ).rejects.toThrow(ConflictException);
      // [CheckDB] Đảm bảo KHÔNG gọi hàm tạo người dùng để bảo vệ tính toàn vẹn dữ liệu.
      expect(usersService.create).not.toHaveBeenCalled();
    });

    /**
     * [TC-AUTH-003] Xác nhận mật khẩu được mã hóa an toàn bằng Bcrypt.
     */
    it('TC-AUTH-003 - should hash password using bcrypt', async () => {
      // --- ARRANGE ---
      usersService.findByEmail.mockResolvedValue(null);
      mockedBcrypt.genSalt = jest.fn().mockResolvedValue('s') as any;
      mockedBcrypt.hash = jest.fn().mockResolvedValue('h') as any;
      usersService.create.mockResolvedValue({});

      // --- ACT ---
      await service.signUp({ email: 'a@a.com', password: 'P@ss' } as any);

      // --- ASSERT ---
      // Xác nhận Bcrypt được gọi với đúng mật khẩu gốc và muối (salt).
      expect(mockedBcrypt.hash).toHaveBeenCalledWith('P@ss', 's');
    });
  });

  describe('validateUser', () => {
    /**
     * [TC-AUTH-004] Xác thực thông tin đăng nhập và cấp phát mã JWT.
     * Mục tiêu: Xác nhận người dùng nhận được token khi email và mật khẩu hoàn toàn chính xác.
     */
    it('TC-AUTH-004 - should return JWT when credentials are valid', async () => {
      // --- ARRANGE ---
      const user = {
        id: 1,
        email: 'a@a.com',
        passwordHash: 'hashed',
        role: 'student',
      };
      usersService.findByEmail.mockResolvedValue(user);
      mockedBcrypt.compare = jest.fn().mockResolvedValue(true) as any;
      jwtService.sign.mockReturnValue('jwt-token');

      // --- ACT ---
      const result = await service.validateUser('a@a.com', 'P@ss');

      // --- ASSERT ---
      // Xác nhận JWT được ký với các trường thông tin cơ bản của người dùng.
      expect(jwtService.sign).toHaveBeenCalledWith({
        id: 1,
        email: 'a@a.com',
        role: 'student',
      });
      expect(result).toBe('jwt-token');
    });

    /**
     * [TC-AUTH-005] Từ chối xác thực khi địa chỉ email không có trong hệ thống.
     */
    it('TC-AUTH-005 - should return null when email not found', async () => {
      // --- ARRANGE ---
      usersService.findByEmail.mockResolvedValue(null);

      // --- ACT ---
      const result = await service.validateUser('x@x.com', 'p');

      // --- ASSERT ---
      expect(result).toBeNull();
      // Đảm bảo KHÔNG cấp phát JWT cho tài khoản không tồn tại.
      expect(jwtService.sign).not.toHaveBeenCalled();
    });

    /**
     * [TC-AUTH-006] Từ chối xác thực khi mật khẩu không trùng khớp.
     */
    it('TC-AUTH-006 - should return null when password is wrong', async () => {
      // --- ARRANGE ---
      usersService.findByEmail.mockResolvedValue({
        id: 1,
        email: 'a@a.com',
        passwordHash: 'hashed',
        role: 'student',
      });
      mockedBcrypt.compare = jest.fn().mockResolvedValue(false) as any;

      // --- ACT ---
      const result = await service.validateUser('a@a.com', 'wrong');

      // --- ASSERT ---
      expect(result).toBeNull();
      expect(jwtService.sign).not.toHaveBeenCalled();
    });

    /**
     * [TC-AUTH-007] Kiểm tra quy trình so khớp mật khẩu bằng Bcrypt.
     */
    it('TC-AUTH-007 - should call bcrypt.compare with correct args', async () => {
      // --- ARRANGE ---
      const user = {
        id: 2,
        email: 'b@b.com',
        passwordHash: 'h2',
        role: 'admin',
      };
      usersService.findByEmail.mockResolvedValue(user);
      mockedBcrypt.compare = jest.fn().mockResolvedValue(true) as any;
      jwtService.sign.mockReturnValue('t');

      // --- ACT ---
      await service.validateUser('b@b.com', 'mypass');

      // --- ASSERT ---
      // Xác nhận mật khẩu nhập vào được so sánh với mã băm lưu trong DB.
      expect(mockedBcrypt.compare).toHaveBeenCalledWith('mypass', 'h2');
    });

    /**
     * [TC-AUTH-008] Đảm bảo JWT Payload chứa đầy đủ thông tin phân quyền.
     * Mục tiêu: Token phải mang theo ID, Email và Role để các Guard phía sau có thể kiểm tra.
     */
    it('TC-AUTH-008 - should include id/email/role in JWT payload', async () => {
      // --- ARRANGE ---
      usersService.findByEmail.mockResolvedValue({
        id: 7,
        email: 'admin@x.com',
        passwordHash: 'h',
        role: 'admin',
      });
      mockedBcrypt.compare = jest.fn().mockResolvedValue(true) as any;
      jwtService.sign.mockReturnValue('t');

      // --- ACT ---
      await service.validateUser('admin@x.com', 'pwd');

      // --- ASSERT ---
      const payload = jwtService.sign.mock.calls[0][0];
      expect(payload).toHaveProperty('id', 7);
      expect(payload).toHaveProperty('email', 'admin@x.com');
      expect(payload).toHaveProperty('role', 'admin');
    });
  });
});
