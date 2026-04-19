/**
 * Unit tests for GrammarTranslationsService.
 *
 * Strategy: mock-only.
 * CheckDB: assert repo methods (findOne/findAndCount/save/update/remove) gọi đúng tham số.
 * Rollback: jest.clearAllMocks() trong afterEach.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Like } from 'typeorm';
import { GrammarTranslationsService } from './grammar-translations.service';
import { GrammarTranslation } from './entities/grammar-translation.entity';
import {
  createMockRepository,
  MockRepository,
} from '../../test/helpers/mock-repository';

describe('GrammarTranslationsService', () => {
  let service: GrammarTranslationsService;
  let repository: MockRepository;

  beforeEach(async () => {
    repository = createMockRepository();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GrammarTranslationsService,
        {
          provide: getRepositoryToken(GrammarTranslation),
          useValue: repository,
        },
      ],
    }).compile();

    service = module.get<GrammarTranslationsService>(
      GrammarTranslationsService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    /**
     * TC-GRM-TRN-001
     * Objective: Tạo translation mới khi chưa tồn tại cặp (patternId, language)
     */
    it('TC-GRM-TRN-001 - should create when no duplicate exists', async () => {
      const dto: any = {
        grammarPatternId: 1,
        language: 'en',
        grammarPoint: 'X',
      };
      repository.findOne!.mockResolvedValue(null);
      repository.create!.mockReturnValue(dto);
      repository.save!.mockResolvedValue({ id: 10, ...dto });

      const result = await service.create(dto);

      // CheckDB: phải kiểm tra duplicate trước
      expect(repository.findOne).toHaveBeenCalledWith({
        where: { grammarPatternId: 1, language: 'en' },
      });
      expect(repository.save).toHaveBeenCalled();
      expect(result.id).toBe(10);
    });

    /**
     * TC-GRM-TRN-002
     * Objective: Throw ConflictException khi cặp đã tồn tại
     */
    it('TC-GRM-TRN-002 - should throw Conflict when duplicate exists', async () => {
      repository.findOne!.mockResolvedValue({ id: 1 });
      await expect(
        service.create({ grammarPatternId: 1, language: 'en' } as any),
      ).rejects.toThrow(ConflictException);
      expect(repository.save).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    /**
     * TC-GRM-TRN-003
     * Objective: Áp dụng đầy đủ filter + search + pagination + custom sort
     */
    it('TC-GRM-TRN-003 - should apply filters, search, sort, pagination', async () => {
      repository.findAndCount!.mockResolvedValue([[{ id: 1 }], 1]);

      const result = await service.findAll({
        page: 2,
        limit: 5,
        grammarPatternId: 3,
        language: 'en',
        search: 'hello',
        sortBy: 'language',
        sortOrder: 'DESC',
      } as any);

      expect(repository.findAndCount).toHaveBeenCalledWith({
        where: {
          grammarPatternId: 3,
          language: 'en',
          grammarPoint: Like('%hello%'),
        },
        relations: ['grammarPattern'],
        skip: 5,
        take: 5,
        order: { language: 'DESC' },
      });
      expect(result.totalPages).toBe(1);
    });

    /**
     * TC-GRM-TRN-004
     * Objective: Default sortBy=id ASC khi sortBy không hợp lệ
     */
    it('TC-GRM-TRN-004 - should fallback to id ASC for invalid sortBy', async () => {
      repository.findAndCount!.mockResolvedValue([[], 0]);
      await service.findAll({ sortBy: 'invalid', sortOrder: 'WRONG' } as any);
      expect(repository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          order: { id: 'ASC' },
          skip: 0,
          take: 10,
        }),
      );
    });
  });

  describe('findAll - default sort', () => {
    /**
     * TC-GRM-TRN-015
     * Objective: Khi không truyền sortBy/sortOrder → dùng default 'id' ASC
     */
    it('TC-GRM-TRN-015 - should use default sortBy=id ASC when not provided', async () => {
      repository.findAndCount!.mockResolvedValue([[], 0]);
      await service.findAll({} as any);
      expect(repository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ order: { id: 'ASC' } }),
      );
    });
  });

  describe('findOne', () => {
    /**
     * TC-GRM-TRN-005
     * Objective: Trả về translation khi tồn tại
     */
    it('TC-GRM-TRN-005 - should return translation when found', async () => {
      const t = { id: 1 };
      repository.findOne!.mockResolvedValue(t);
      const result = await service.findOne(1);
      expect(result).toEqual(t);
    });

    /**
     * TC-GRM-TRN-006
     * Objective: Throw NotFound khi không tồn tại
     */
    it('TC-GRM-TRN-006 - should throw NotFound when missing', async () => {
      repository.findOne!.mockResolvedValue(null);
      await expect(service.findOne(99)).rejects.toThrow(NotFoundException);
    });
  });

  describe('findByGrammarPatternId', () => {
    /**
     * TC-GRM-TRN-007
     * Objective: Filter theo grammarPatternId, sort theo language ASC
     */
    it('TC-GRM-TRN-007 - should query by grammarPatternId', async () => {
      repository.find!.mockResolvedValue([]);
      await service.findByGrammarPatternId(5);
      expect(repository.find).toHaveBeenCalledWith({
        where: { grammarPatternId: 5 },
        relations: ['grammarPattern'],
        order: { language: 'ASC' },
      });
    });
  });

  describe('findByLanguage', () => {
    /**
     * TC-GRM-TRN-008
     * Objective: Filter theo language, sort theo id ASC
     */
    it('TC-GRM-TRN-008 - should query by language', async () => {
      repository.find!.mockResolvedValue([]);
      await service.findByLanguage('vi');
      expect(repository.find).toHaveBeenCalledWith({
        where: { language: 'vi' },
        relations: ['grammarPattern'],
        order: { id: 'ASC' },
      });
    });
  });

  describe('update', () => {
    /**
     * TC-GRM-TRN-009
     * Objective: Update language khác → check duplicate, không có thì update + reload
     */
    it('TC-GRM-TRN-009 - should update language when no conflict', async () => {
      repository.findOne!
        .mockResolvedValueOnce({ id: 1, grammarPatternId: 1, language: 'en' }) // findOne
        .mockResolvedValueOnce(null) // duplicate check
        .mockResolvedValueOnce({ id: 1, language: 'vi' }); // reload after update
      repository.update!.mockResolvedValue({ affected: 1 });

      const result = await service.update(1, { language: 'vi' } as any);

      expect(repository.update).toHaveBeenCalledWith(1, { language: 'vi' });
      expect(result.language).toBe('vi');
    });

    /**
     * TC-GRM-TRN-010
     * Objective: Throw Conflict khi đổi sang language đã tồn tại
     */
    it('TC-GRM-TRN-010 - should throw Conflict when new language duplicates', async () => {
      repository.findOne!
        .mockResolvedValueOnce({ id: 1, grammarPatternId: 1, language: 'en' })
        .mockResolvedValueOnce({ id: 9 }); // duplicate
      await expect(
        service.update(1, { language: 'vi' } as any),
      ).rejects.toThrow(ConflictException);
      expect(repository.update).not.toHaveBeenCalled();
    });

    /**
     * TC-GRM-TRN-011
     * Objective: Update không đổi language → không check duplicate
     */
    it('TC-GRM-TRN-011 - should skip duplicate check when language not changed', async () => {
      repository.findOne!
        .mockResolvedValueOnce({ id: 1, grammarPatternId: 1, language: 'en' })
        .mockResolvedValueOnce({ id: 1, grammarPoint: 'NEW' });
      repository.update!.mockResolvedValue({ affected: 1 });

      await service.update(1, { grammarPoint: 'NEW' } as any);
      // Chỉ 2 lần findOne (1 cho findOne + 1 cho reload), không có lần check duplicate
      expect(repository.findOne).toHaveBeenCalledTimes(2);
    });
  });

  describe('remove', () => {
    /**
     * TC-GRM-TRN-012
     * Objective: Xóa thành công khi tồn tại
     */
    it('TC-GRM-TRN-012 - should remove when exists', async () => {
      const t = { id: 1 };
      repository.findOne!.mockResolvedValue(t);
      repository.remove!.mockResolvedValue(t);
      await service.remove(1);
      expect(repository.remove).toHaveBeenCalledWith(t);
    });

    /**
     * TC-GRM-TRN-013
     * Objective: Throw NotFound khi không tồn tại
     */
    it('TC-GRM-TRN-013 - should throw NotFound when missing', async () => {
      repository.findOne!.mockResolvedValue(null);
      await expect(service.remove(99)).rejects.toThrow(NotFoundException);
    });
  });

  describe('getStatistics', () => {
    /**
     * TC-GRM-TRN-014
     * Objective: Trả về tổng + phân bố theo language
     */
    it('TC-GRM-TRN-014 - should aggregate statistics', async () => {
      repository.count!.mockResolvedValue(15);
      repository.__queryBuilder.getRawMany.mockResolvedValue([
        { language: 'en', total: '10' },
        { language: 'vi', total: '5' },
      ]);

      const result = await service.getStatistics();
      expect(result.total).toBe(15);
      expect(result.languageDistribution).toHaveLength(2);
    });
  });
});
