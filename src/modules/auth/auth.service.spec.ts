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
     * TC-AUTH-001
     * Objective: Đăng ký user mới khi email chưa tồn tại → hash password, lưu DB, trả về user
     */
    it('TC-AUTH-001 - should create user when email is unique', async () => {
      const dto: any = { email: 'new@x.com', password: 'pass', name: 'N' };
      usersService.findByEmail.mockResolvedValue(null);
      mockedBcrypt.genSalt = jest.fn().mockResolvedValue('salt') as any;
      mockedBcrypt.hash = jest.fn().mockResolvedValue('hashed') as any;
      const savedUser = { id: 1, email: dto.email };
      usersService.create.mockResolvedValue(savedUser);

      const result = await service.signUp(dto);

      // CheckDB: findByEmail check tồn tại trước
      expect(usersService.findByEmail).toHaveBeenCalledWith('new@x.com');
      // CheckDB: create lưu DB với passwordHash đúng
      expect(usersService.create).toHaveBeenCalledWith(dto, 'hashed');
      expect(result).toEqual(savedUser);
    });

    /**
     * TC-AUTH-002
     * Objective: Throw ConflictException khi email đã tồn tại; KHÔNG gọi create
     */
    it('TC-AUTH-002 - should throw Conflict when email exists', async () => {
      usersService.findByEmail.mockResolvedValue({ id: 1, email: 'x@x.com' });
      await expect(
        service.signUp({ email: 'x@x.com', password: 'p' } as any),
      ).rejects.toThrow(ConflictException);
      // CheckDB: KHÔNG insert user mới
      expect(usersService.create).not.toHaveBeenCalled();
    });

    /**
     * TC-AUTH-003
     * Objective: bcrypt.genSalt và bcrypt.hash được gọi với đúng password
     */
    it('TC-AUTH-003 - should hash password using bcrypt', async () => {
      usersService.findByEmail.mockResolvedValue(null);
      mockedBcrypt.genSalt = jest.fn().mockResolvedValue('s') as any;
      mockedBcrypt.hash = jest.fn().mockResolvedValue('h') as any;
      usersService.create.mockResolvedValue({});

      await service.signUp({ email: 'a@a.com', password: 'P@ss' } as any);
      expect(mockedBcrypt.hash).toHaveBeenCalledWith('P@ss', 's');
    });
  });

  describe('validateUser', () => {
    /**
     * TC-AUTH-004
     * Objective: Email + password đúng → trả về JWT token
     */
    it('TC-AUTH-004 - should return JWT when credentials are valid', async () => {
      const user = {
        id: 1,
        email: 'a@a.com',
        passwordHash: 'hashed',
        role: 'student',
      };
      usersService.findByEmail.mockResolvedValue(user);
      mockedBcrypt.compare = jest.fn().mockResolvedValue(true) as any;
      jwtService.sign.mockReturnValue('jwt-token');

      const result = await service.validateUser('a@a.com', 'P@ss');

      expect(jwtService.sign).toHaveBeenCalledWith({
        id: 1,
        email: 'a@a.com',
        role: 'student',
      });
      expect(result).toBe('jwt-token');
    });

    /**
     * TC-AUTH-005
     * Objective: Email không tồn tại → trả về null
     */
    it('TC-AUTH-005 - should return null when email not found', async () => {
      usersService.findByEmail.mockResolvedValue(null);
      const result = await service.validateUser('x@x.com', 'p');
      expect(result).toBeNull();
      expect(jwtService.sign).not.toHaveBeenCalled();
    });

    /**
     * TC-AUTH-006
     * Objective: Email tồn tại nhưng password sai → trả về null
     */
    it('TC-AUTH-006 - should return null when password is wrong', async () => {
      usersService.findByEmail.mockResolvedValue({
        id: 1,
        email: 'a@a.com',
        passwordHash: 'hashed',
        role: 'student',
      });
      mockedBcrypt.compare = jest.fn().mockResolvedValue(false) as any;

      const result = await service.validateUser('a@a.com', 'wrong');
      expect(result).toBeNull();
      expect(jwtService.sign).not.toHaveBeenCalled();
    });

    /**
     * TC-AUTH-007
     * Objective: bcrypt.compare được gọi với đúng password và hash
     */
    it('TC-AUTH-007 - should call bcrypt.compare with correct args', async () => {
      const user = {
        id: 2,
        email: 'b@b.com',
        passwordHash: 'h2',
        role: 'admin',
      };
      usersService.findByEmail.mockResolvedValue(user);
      mockedBcrypt.compare = jest.fn().mockResolvedValue(true) as any;
      jwtService.sign.mockReturnValue('t');

      await service.validateUser('b@b.com', 'mypass');
      expect(mockedBcrypt.compare).toHaveBeenCalledWith('mypass', 'h2');
    });

    /**
     * TC-AUTH-008
     * Objective: JWT payload phải chứa id, email, role (đầy đủ trường authorization)
     */
    it('TC-AUTH-008 - should include id/email/role in JWT payload', async () => {
      usersService.findByEmail.mockResolvedValue({
        id: 7,
        email: 'admin@x.com',
        passwordHash: 'h',
        role: 'admin',
      });
      mockedBcrypt.compare = jest.fn().mockResolvedValue(true) as any;
      jwtService.sign.mockReturnValue('t');

      await service.validateUser('admin@x.com', 'pwd');
      const payload = jwtService.sign.mock.calls[0][0];
      expect(payload).toHaveProperty('id', 7);
      expect(payload).toHaveProperty('email', 'admin@x.com');
      expect(payload).toHaveProperty('role', 'admin');
    });
  });
});
