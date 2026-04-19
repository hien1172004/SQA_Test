/**
 * Unit tests for GrammarPatternsService.
 *
 * Strategy: mock-only.
 * CheckDB: assert repo + queryBuilder calls với tham số đúng.
 * Rollback: jest.clearAllMocks() trong afterEach (no real DB).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { GrammarPatternsService } from './grammar-patterns.service';
import { GrammarPattern } from './entities/grammar-pattern.entity';
import { GrammarTranslation } from './entities/grammar-translation.entity';
import {
  createMockRepository,
  MockRepository,
} from '../../test/helpers/mock-repository';

describe('GrammarPatternsService', () => {
  let service: GrammarPatternsService;
  let patternRepository: MockRepository;
  let translationRepository: MockRepository;

  beforeEach(async () => {
    patternRepository = createMockRepository();
    translationRepository = createMockRepository();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GrammarPatternsService,
        {
          provide: getRepositoryToken(GrammarPattern),
          useValue: patternRepository,
        },
        {
          provide: getRepositoryToken(GrammarTranslation),
          useValue: translationRepository,
        },
      ],
    }).compile();

    service = module.get<GrammarPatternsService>(GrammarPatternsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    /**
     * TC-GRM-PTN-001
     * Objective: Tạo grammar pattern mới → repo.create + save được gọi đúng
     */
    it('TC-GRM-PTN-001 - should create new pattern', async () => {
      const dto: any = { pattern: ['了'], hskLevel: 1 };
      patternRepository.create!.mockReturnValue(dto);
      patternRepository.save!.mockResolvedValue({ id: 1, ...dto });

      const result = await service.create(dto);
      expect(patternRepository.create).toHaveBeenCalledWith(dto);
      expect(patternRepository.save).toHaveBeenCalled();
      expect(result.id).toBe(1);
    });
  });

  describe('findAll', () => {
    /**
     * TC-GRM-PTN-002
     * Objective: Áp dụng search + hskLevel + sort tùy chỉnh + pagination
     */
    it('TC-GRM-PTN-002 - should apply search, hskLevel, sort, pagination', async () => {
      const qb = patternRepository.__queryBuilder;
      qb.getManyAndCount.mockResolvedValue([[{ id: 1 }], 1]);

      const result = await service.findAll({
        page: 2,
        limit: 5,
        search: 'le',
        hskLevel: 2,
        sortBy: 'hskLevel',
        sortOrder: 'DESC',
      } as any);

      expect(qb.andWhere).toHaveBeenCalledWith(
        "JSON_SEARCH(pattern.pattern, 'one', :search) IS NOT NULL",
        { search: '%le%' },
      );
      expect(qb.andWhere).toHaveBeenCalledWith('pattern.hskLevel = :hskLevel', {
        hskLevel: 2,
      });
      expect(qb.skip).toHaveBeenCalledWith(5);
      expect(qb.take).toHaveBeenCalledWith(5);
      expect(qb.orderBy).toHaveBeenCalledWith('pattern.hskLevel', 'DESC');
      expect(result.totalPages).toBe(1);
    });

    /**
     * TC-GRM-PTN-003
     * Objective: Default page=1, limit=10, sortBy=id ASC khi query rỗng
     */
    it('TC-GRM-PTN-003 - should use defaults when query empty', async () => {
      const qb = patternRepository.__queryBuilder;
      qb.getManyAndCount.mockResolvedValue([[], 0]);
      await service.findAll({} as any);
      expect(qb.skip).toHaveBeenCalledWith(0);
      expect(qb.take).toHaveBeenCalledWith(10);
      expect(qb.orderBy).toHaveBeenCalledWith('pattern.id', 'ASC');
    });

    /**
     * TC-GRM-PTN-004
     * Objective: sortBy không hợp lệ → fallback id
     */
    it('TC-GRM-PTN-004 - should fallback to id for invalid sortBy', async () => {
      const qb = patternRepository.__queryBuilder;
      qb.getManyAndCount.mockResolvedValue([[], 0]);
      await service.findAll({ sortBy: 'invalid' } as any);
      expect(qb.orderBy).toHaveBeenCalledWith('pattern.id', 'ASC');
    });
  });

  describe('findOne', () => {
    /**
     * TC-GRM-PTN-005
     * Objective: Tìm pattern theo id, kèm relations:[translations]
     */
    it('TC-GRM-PTN-005 - should fetch with translations relation', async () => {
      patternRepository.findOne!.mockResolvedValue({ id: 1 });
      const result = await service.findOne(1);
      expect(patternRepository.findOne).toHaveBeenCalledWith({
        where: { id: 1 },
        relations: ['translations'],
      });
      expect(result.id).toBe(1);
    });

    /**
     * TC-GRM-PTN-006
     * Objective: Throw NotFoundException khi không tồn tại
     */
    it('TC-GRM-PTN-006 - should throw NotFound when missing', async () => {
      patternRepository.findOne!.mockResolvedValue(null);
      await expect(service.findOne(99)).rejects.toThrow(NotFoundException);
    });
  });

  describe('findByPattern', () => {
    /**
     * TC-GRM-PTN-007
     * Objective: Tìm pattern theo trường pattern (string)
     */
    it('TC-GRM-PTN-007 - should fetch by pattern string', async () => {
      patternRepository.findOne!.mockResolvedValue({ id: 1 });
      await service.findByPattern('le');
      expect(patternRepository.findOne).toHaveBeenCalledWith({
        where: { pattern: 'le' },
        relations: ['translations'],
      });
    });

    /**
     * TC-GRM-PTN-008
     * Objective: Throw NotFound khi pattern không tồn tại
     */
    it('TC-GRM-PTN-008 - should throw NotFound when pattern missing', async () => {
      patternRepository.findOne!.mockResolvedValue(null);
      await expect(service.findByPattern('xx')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    /**
     * TC-GRM-PTN-009
     * Objective: Verify pattern tồn tại → update + reload
     */
    it('TC-GRM-PTN-009 - should update and reload', async () => {
      patternRepository.findOne!.mockResolvedValue({ id: 1 });
      patternRepository.update!.mockResolvedValue({ affected: 1 });

      const result = await service.update(1, { hskLevel: 3 } as any);
      expect(patternRepository.update).toHaveBeenCalledWith(1, { hskLevel: 3 });
      expect(result.id).toBe(1);
    });

    /**
     * TC-GRM-PTN-010
     * Objective: Throw NotFound khi pattern không tồn tại
     */
    it('TC-GRM-PTN-010 - should throw NotFound when pattern missing', async () => {
      patternRepository.findOne!.mockResolvedValue(null);
      await expect(service.update(99, {} as any)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('remove', () => {
    /**
     * TC-GRM-PTN-011
     * Objective: Xóa pattern khi tồn tại
     */
    it('TC-GRM-PTN-011 - should remove existing pattern', async () => {
      const p = { id: 1 };
      patternRepository.findOne!.mockResolvedValue(p);
      patternRepository.remove!.mockResolvedValue(p);
      await service.remove(1);
      expect(patternRepository.remove).toHaveBeenCalledWith(p);
    });

    /**
     * TC-GRM-PTN-012
     * Objective: Throw NotFound khi pattern không tồn tại
     */
    it('TC-GRM-PTN-012 - should throw NotFound when pattern missing', async () => {
      patternRepository.findOne!.mockResolvedValue(null);
      await expect(service.remove(99)).rejects.toThrow(NotFoundException);
    });
  });

  describe('getStatistics', () => {
    /**
     * TC-GRM-PTN-013
     * Objective: Trả về tổng + phân bố theo HSK level
     */
    it('TC-GRM-PTN-013 - should aggregate stats', async () => {
      patternRepository.count!.mockResolvedValue(20);
      patternRepository.__queryBuilder.getRawMany.mockResolvedValue([
        { level: 1, total: '5' },
        { level: 2, total: '15' },
      ]);

      const result = await service.getStatistics();
      expect(result.total).toBe(20);
      expect(result.hskLevelDistribution).toHaveLength(2);
    });
  });

  describe('createComplete', () => {
    /**
     * TC-GRM-PTN-014
     * Objective: Scenario 1 - không có patternId → tạo pattern mới + translation
     */
    it('TC-GRM-PTN-014 - should create new pattern + translation when no patternId', async () => {
      const dto: any = {
        pattern: { pattern: ['了'], hskLevel: 1 },
        translation: {
          language: 'vn',
          grammarPoint: 'GP',
          explanation: 'E',
          example: 'EX',
        },
      };
      patternRepository.create!.mockReturnValue(dto.pattern);
      patternRepository.save!.mockResolvedValue({ id: 10, ...dto.pattern });
      translationRepository.create!.mockImplementation((d) => d);
      translationRepository.save!.mockResolvedValue({});
      patternRepository.findOne!.mockResolvedValue({ id: 10, translations: [] });

      const result = await service.createComplete(dto);
      expect(patternRepository.create).toHaveBeenCalled();
      expect(translationRepository.save).toHaveBeenCalled();
      expect(result.id).toBe(10);
    });

    /**
     * TC-GRM-PTN-015
     * Objective: Scenario 1 - không có pattern data → throw BadRequest
     */
    it('TC-GRM-PTN-015 - should throw BadRequest when no pattern data', async () => {
      await expect(
        service.createComplete({
          translation: { grammarPoint: 'X' },
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    /**
     * TC-GRM-PTN-016
     * Objective: Scenario 2 - có patternId hợp lệ, language chưa có translation
     */
    it('TC-GRM-PTN-016 - should add translation to existing pattern', async () => {
      const existingPattern = {
        id: 5,
        translations: [{ language: 'en' }],
      };
      patternRepository.findOne!
        .mockResolvedValueOnce(existingPattern) // initial findOne
        .mockResolvedValueOnce({ id: 5, translations: [] }); // reload at end
      translationRepository.create!.mockImplementation((d) => d);
      translationRepository.save!.mockResolvedValue({});

      const result = await service.createComplete({
        patternId: 5,
        translation: { language: 'vn', grammarPoint: 'X' },
      } as any);
      expect(result.id).toBe(5);
    });

    /**
     * TC-GRM-PTN-017
     * Objective: Scenario 2 - patternId không tồn tại → NotFound
     */
    it('TC-GRM-PTN-017 - should throw NotFound when patternId missing', async () => {
      patternRepository.findOne!.mockResolvedValue(null);
      await expect(
        service.createComplete({
          patternId: 99,
          translation: { language: 'vn' },
        } as any),
      ).rejects.toThrow(NotFoundException);
    });

    /**
     * TC-GRM-PTN-018
     * Objective: Scenario 2 - translation cho language đã tồn tại → Conflict
     */
    it('TC-GRM-PTN-018 - should throw Conflict when translation language exists', async () => {
      patternRepository.findOne!.mockResolvedValue({
        id: 5,
        translations: [{ language: 'vn' }],
      });
      await expect(
        service.createComplete({
          patternId: 5,
          translation: { language: 'vn', grammarPoint: 'X' },
        } as any),
      ).rejects.toThrow(ConflictException);
    });

    /**
     * TC-GRM-PTN-019
     * Objective: Default language = 'vn' khi không truyền vào
     */
    it('TC-GRM-PTN-019 - should default language to vn when not provided', async () => {
      patternRepository.findOne!
        .mockResolvedValueOnce({ id: 5, translations: [] })
        .mockResolvedValueOnce({ id: 5, translations: [] });
      translationRepository.create!.mockImplementation((d) => d);
      translationRepository.save!.mockResolvedValue({});

      await service.createComplete({
        patternId: 5,
        translation: { grammarPoint: 'X' }, // không có language
      } as any);

      expect(translationRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ language: 'vn' }),
      );
    });
  });

  describe('updateCompleteByTranslationId', () => {
    /**
     * TC-GRM-PTN-020
     * Objective: Update cả pattern và translation
     */
    it('TC-GRM-PTN-020 - should update both pattern and translation', async () => {
      translationRepository.findOne!.mockResolvedValue({
        id: 100,
        grammarPatternId: 5,
      });
      patternRepository.update!.mockResolvedValue({ affected: 1 });
      translationRepository.update!.mockResolvedValue({ affected: 1 });
      patternRepository.findOne!.mockResolvedValue({ id: 5 });

      await service.updateCompleteByTranslationId(100, {
        pattern: { hskLevel: 3 },
        translation: { grammarPoint: 'NEW' },
      } as any);

      expect(patternRepository.update).toHaveBeenCalledWith(5, { hskLevel: 3 });
      expect(translationRepository.update).toHaveBeenCalledWith(100, {
        grammarPoint: 'NEW',
      });
    });

    /**
     * TC-GRM-PTN-021
     * Objective: Throw NotFound khi translation không tồn tại
     */
    it('TC-GRM-PTN-021 - should throw NotFound when translation missing', async () => {
      translationRepository.findOne!.mockResolvedValue(null);
      await expect(
        service.updateCompleteByTranslationId(99, {} as any),
      ).rejects.toThrow(NotFoundException);
    });

    /**
     * TC-GRM-PTN-022
     * Objective: Không update gì khi pattern và translation đều rỗng/undefined
     */
    it('TC-GRM-PTN-022 - should skip updates when both inputs empty', async () => {
      translationRepository.findOne!.mockResolvedValue({
        id: 100,
        grammarPatternId: 5,
      });
      patternRepository.findOne!.mockResolvedValue({ id: 5 });
      await service.updateCompleteByTranslationId(100, {} as any);
      expect(patternRepository.update).not.toHaveBeenCalled();
      expect(translationRepository.update).not.toHaveBeenCalled();
    });

    /**
     * TC-GRM-PTN-023
     * Objective: createComplete scenario 2 - dto.translation.language KHÔNG truyền
     *            (undefined) nhưng pattern đã có translation 'vn' → throw Conflict
     *            sử dụng default 'vn' trong cả 2 nhánh `||` (line 180 + 185)
     */
    it('TC-GRM-PTN-023 - should throw Conflict using default vn when language undefined', async () => {
      patternRepository.findOne!.mockResolvedValue({
        id: 5,
        translations: [{ language: 'vn' }],
      });
      await expect(
        service.createComplete({
          patternId: 5,
          translation: { grammarPoint: 'X' }, // no language → fallback 'vn'
        } as any),
      ).rejects.toThrow(/Translation for language "vn" already exists/);
    });
  });
});
