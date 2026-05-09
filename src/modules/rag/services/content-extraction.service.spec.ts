/**
 * Unit tests for ContentExtractionService.
 *
 * Strategy: mock-only.
 * - Mock 8 repositories (Word, WordSense, WordSenseTranslation, GrammarPattern,
 *   GrammarTranslation, Content, Question, Embedding) + EmbeddingService.
 * - Tập trung test extract logic + processAllContent flow.
 *
 * CheckDB: assert repo.find / save / delete được gọi đúng.
 * Rollback: jest.clearAllMocks() trong afterEach (no real DB).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ContentExtractionService } from './content-extraction.service';
import { EmbeddingService } from './embedding.service';
import { Word } from '../../words/entities/word.entity';
import { WordSense } from '../../words/entities/word-sense.entity';
import { WordSenseTranslation } from '../../words/entities/word-sense-translation.entity';
import { GrammarPattern } from '../../grammar/entities/grammar-pattern.entity';
import { GrammarTranslation } from '../../grammar/entities/grammar-translation.entity';
import { Content } from '../../lessons/entities/content.entity';
import { Question } from '../../lessons/entities/question.entity';
import { Embedding, SourceType } from '../entities/embedding.entity';
import {
  createMockRepository,
  MockRepository,
} from '../../../test/helpers/mock-repository';

describe('ContentExtractionService', () => {
  let service: ContentExtractionService;
  let wordRepository: MockRepository;
  let grammarPatternRepository: MockRepository;
  let contentRepository: MockRepository;
  let questionRepository: MockRepository;
  let embeddingRepository: MockRepository;
  let embeddingService: { generateBatchEmbeddings: jest.Mock };

  beforeEach(async () => {
    wordRepository = createMockRepository();
    grammarPatternRepository = createMockRepository();
    contentRepository = createMockRepository();
    questionRepository = createMockRepository();
    embeddingRepository = createMockRepository();
    embeddingService = { generateBatchEmbeddings: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContentExtractionService,
        { provide: getRepositoryToken(Word), useValue: wordRepository },
        { provide: getRepositoryToken(WordSense), useValue: createMockRepository() },
        { provide: getRepositoryToken(WordSenseTranslation), useValue: createMockRepository() },
        {
          provide: getRepositoryToken(GrammarPattern),
          useValue: grammarPatternRepository,
        },
        {
          provide: getRepositoryToken(GrammarTranslation),
          useValue: createMockRepository(),
        },
        { provide: getRepositoryToken(Content), useValue: contentRepository },
        { provide: getRepositoryToken(Question), useValue: questionRepository },
        { provide: getRepositoryToken(Embedding), useValue: embeddingRepository },
        { provide: EmbeddingService, useValue: embeddingService },
      ],
    }).compile();

    service = module.get<ContentExtractionService>(ContentExtractionService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('extractWordContent', () => {
    /**
     * TC-RAG-CEX-001
     * Objective: Trích xuất Word + senses + translations thành ExtractedContent
     */
    it('TC-RAG-CEX-001 - should extract words with senses and translations', async () => {
      wordRepository.find!.mockResolvedValue([
        {
          id: 1,
          simplified: '你好',
          traditional: '你好',
          senses: [
            {
              partOfSpeech: 'noun',
              translations: [{ translation: 'hello', language: 'en' }],
            },
          ],
        },
      ]);

      const result = await service.extractWordContent();
      expect(wordRepository.find).toHaveBeenCalledWith({
        relations: ['senses', 'senses.translations'],
      });
      expect(result).toHaveLength(1);
      expect(result[0].sourceType).toBe(SourceType.WORD);
      expect(result[0].text).toContain('你好');
      expect(result[0].text).toContain('hello');
      expect(result[0].metadata.simplified).toBe('你好');
    });
  });

  describe('extractGrammarContent', () => {
    /**
     * TC-RAG-CEX-002
     * Objective: Trích xuất GrammarPattern (pattern array) + translations
     */
    it('TC-RAG-CEX-002 - should extract grammar patterns with array fields', async () => {
      grammarPatternRepository.find!.mockResolvedValue([
        {
          id: 1,
          pattern: ['了'],
          patternPinyin: ['le'],
          patternFormula: 'V + 了',
          hskLevel: 1,
          translations: [{ explanation: 'past tense', language: 'en' }],
        },
      ]);

      const result = await service.extractGrammarContent();
      expect(result).toHaveLength(1);
      expect(result[0].sourceType).toBe(SourceType.GRAMMAR);
      expect(result[0].text).toContain('了');
      expect(result[0].text).toContain('le');
      expect(result[0].metadata.hskLevel).toBe(1);
    });

    /**
     * TC-RAG-CEX-003
     * Objective: pattern là string thường (legacy) → vẫn xử lý đúng
     */
    it('TC-RAG-CEX-003 - should handle legacy string pattern format', async () => {
      grammarPatternRepository.find!.mockResolvedValue([
        {
          id: 2,
          pattern: '不',
          patternPinyin: 'bu',
          translations: [],
        },
      ]);
      const result = await service.extractGrammarContent();
      expect(result[0].metadata.pattern).toBe('不');
    });
  });

  describe('extractLessonContent', () => {
    /**
     * TC-RAG-CEX-004
     * Objective: Trích xuất Content active có data text
     */
    it('TC-RAG-CEX-004 - should extract active lesson contents', async () => {
      contentRepository.find!.mockResolvedValue([
        {
          id: 1,
          lessonId: 5,
          orderIndex: 1,
          type: 'text',
          data: { title: 'L1', text: 'Hello' },
          lesson: { name: 'Lesson 1' },
        },
      ]);
      const result = await service.extractLessonContent();
      expect(contentRepository.find).toHaveBeenCalledWith({
        relations: ['lesson'],
        where: { isActive: true },
      });
      expect(result).toHaveLength(1);
      expect(result[0].text).toContain('Hello');
    });

    /**
     * TC-RAG-CEX-005
     * Objective: Content data rỗng (không trích được text) → bị bỏ qua
     */
    it('TC-RAG-CEX-005 - should skip contents with no extractable text', async () => {
      contentRepository.find!.mockResolvedValue([
        { id: 1, lessonId: 5, type: 'text', data: {}, lesson: { name: 'L' } },
      ]);
      const result = await service.extractLessonContent();
      expect(result).toHaveLength(0);
    });

    /**
     * TC-RAG-CEX-006
     * Objective: Content có dialog + vocabulary + examples → trích đầy đủ
     */
    it('TC-RAG-CEX-006 - should extract dialog/vocabulary/examples fields', async () => {
      contentRepository.find!.mockResolvedValue([
        {
          id: 1,
          lessonId: 5,
          type: 'mixed',
          data: {
            dialog: [{ speaker: 'A', text: 'Hi' }],
            vocabulary: [{ word: '你好', meaning: 'hello' }],
            examples: [{ chinese: '我', english: 'I' }],
          },
          lesson: { name: 'L' },
        },
      ]);
      const result = await service.extractLessonContent();
      expect(result[0].text).toMatch(/Dialog/);
      expect(result[0].text).toMatch(/Vocabulary/);
      expect(result[0].text).toMatch(/Example/);
    });
  });

  describe('extractQuestionContent', () => {
    /**
     * TC-RAG-CEX-007
     * Objective: Question selection có options → trích đủ + parse type components
     */
    it('TC-RAG-CEX-007 - should extract selection question with options', async () => {
      questionRepository.find!.mockResolvedValue([
        {
          id: 1,
          lessonId: 5,
          orderIndex: 1,
          questionType: 'question_selection_text_text',
          data: {
            question: 'Q1?',
            options: [{ text: 'A' }, { text: 'B' }],
            correctAnswer: 'A',
            explanation: 'because',
          },
          lesson: { name: 'L' },
        },
      ]);
      const result = await service.extractQuestionContent();
      expect(result).toHaveLength(1);
      expect(result[0].text).toContain('SELECTION');
      expect(result[0].text).toContain('Q1?');
      expect(result[0].metadata.questionAction).toBe('SELECTION');
      expect(result[0].metadata.questionInputType).toBe('TEXT');
    });

    /**
     * TC-RAG-CEX-008
     * Objective: Question type không đủ 3 phần → fallback UNKNOWN/TEXT/TEXT
     */
    it('TC-RAG-CEX-008 - should fallback when questionType has unexpected format', async () => {
      questionRepository.find!.mockResolvedValue([
        {
          id: 1,
          lessonId: 5,
          questionType: 'odd',
          data: { question: 'Q' },
          lesson: { name: 'L' },
        },
      ]);
      const result = await service.extractQuestionContent();
      expect(result[0].metadata.questionAction).toBe('UNKNOWN');
    });

    /**
     * TC-RAG-CEX-009
     * Objective: Question matching pairs → trích pairs
     */
    it('TC-RAG-CEX-009 - should extract matching question pairs', async () => {
      questionRepository.find!.mockResolvedValue([
        {
          id: 1,
          lessonId: 5,
          questionType: 'question_matching_text_text',
          data: {
            question: 'Match',
            pairs: [{ left: 'A', right: '1' }, { left: 'B', right: '2' }],
          },
          lesson: { name: 'L' },
        },
      ]);
      const result = await service.extractQuestionContent();
      expect(result[0].text).toMatch(/Matching pairs/);
    });

    /**
     * TC-RAG-CEX-010
     * Objective: Question fill blanks legacy format
     */
    it('TC-RAG-CEX-010 - should extract fill question blanks', async () => {
      questionRepository.find!.mockResolvedValue([
        {
          id: 1,
          lessonId: 5,
          questionType: 'question_fill_text_text',
          data: {
            question: 'Fill',
            blanks: [{ correct: ['了'], index: 1 }],
          },
          lesson: { name: 'L' },
        },
      ]);
      const result = await service.extractQuestionContent();
      expect(result[0].text).toMatch(/Fill-in blanks/);
    });

    /**
     * TC-RAG-CEX-011
     * Objective: Question với data rỗng → không tạo entry
     */
    it('TC-RAG-CEX-011 - should skip questions with no extractable text', async () => {
      questionRepository.find!.mockResolvedValue([
        {
          id: 1,
          lessonId: 5,
          questionType: 'question_selection_text_text',
          data: null,
          lesson: { name: 'L' },
        },
      ]);
      const result = await service.extractQuestionContent();
      expect(result).toHaveLength(0);
    });

    /**
     * TC-RAG-CEX-012
     * Objective: Question với new TextContent format (questionContent + segments)
     */
    it('TC-RAG-CEX-012 - should extract new TextContent format', async () => {
      questionRepository.find!.mockResolvedValue([
        {
          id: 1,
          lessonId: 5,
          questionType: 'question_fill_text_text',
          data: {
            questionContent: { chinese: ['你', '好'], pinyin: ['nǐ', 'hǎo'] },
            segments: [
              { type: 'text', content: { text: 'Sentence' } },
              { type: 'blank', blankIndex: 1 },
            ],
            blankAnswers: [
              { index: 1, correctAnswers: [{ text: '是' }] },
            ],
            optionBankItems: [{ text: '是' }, { text: '不' }],
          },
          lesson: { name: 'L' },
        },
      ]);
      const result = await service.extractQuestionContent();
      expect(result[0].text).toContain('你好');
      expect(result[0].text).toMatch(/Sentence/);
      expect(result[0].text).toMatch(/Option bank/);
      expect(result[0].text).toMatch(/Answers/);
    });
  });

  describe('generateEmbeddingsForContent', () => {
    /**
     * TC-RAG-CEX-013
     * Objective: Chia batch + lưu embeddings vào DB
     */
    it('TC-RAG-CEX-013 - should batch and save embeddings', async () => {
      const items = Array.from({ length: 3 }, (_, i) => ({
        sourceType: SourceType.WORD,
        sourceId: i + 1,
        text: `t${i}`,
        metadata: {},
      }));
      embeddingService.generateBatchEmbeddings.mockResolvedValue([
        [0.1], [0.2], [0.3],
      ]);
      embeddingRepository.save!.mockResolvedValue([]);

      await service.generateEmbeddingsForContent(items);

      expect(embeddingService.generateBatchEmbeddings).toHaveBeenCalledWith([
        't0', 't1', 't2',
      ]);
      expect(embeddingRepository.save).toHaveBeenCalled();
    });
  });

  describe('processAllContent', () => {
    /**
     * TC-RAG-CEX-014
     * Objective: Clear embeddings cũ → extract 4 loại nội dung → generate embeddings
     */
    it('TC-RAG-CEX-014 - should clear, extract all and generate embeddings', async () => {
      embeddingRepository.delete!.mockResolvedValue({ affected: 0 });
      // Mỗi extract trả về 1 item để tổng = 4
      wordRepository.find!.mockResolvedValue([
        { id: 1, simplified: 'a', senses: [{ translations: [] }] },
      ]);
      grammarPatternRepository.find!.mockResolvedValue([
        { id: 1, pattern: ['x'], patternPinyin: [], translations: [] },
      ]);
      contentRepository.find!.mockResolvedValue([
        { id: 1, lessonId: 1, type: 'text', data: { text: 'hi' }, lesson: { name: 'L' } },
      ]);
      questionRepository.find!.mockResolvedValue([
        {
          id: 1,
          lessonId: 1,
          questionType: 'question_selection_text_text',
          data: { question: 'Q' },
          lesson: { name: 'L' },
        },
      ]);
      embeddingService.generateBatchEmbeddings.mockResolvedValue([
        [0.1], [0.2], [0.3], [0.4],
      ]);
      embeddingRepository.save!.mockResolvedValue([]);

      await service.processAllContent();

      // CheckDB: clear + 4 lần extract + save embeddings
      expect(embeddingRepository.delete).toHaveBeenCalledWith({});
      expect(embeddingRepository.save).toHaveBeenCalled();
    });

    /**
     * TC-RAG-CEX-015
     * Objective: Không có content nào → không gọi generateEmbeddings
     */
    it('TC-RAG-CEX-015 - should skip embedding when nothing extracted', async () => {
      embeddingRepository.delete!.mockResolvedValue({ affected: 0 });
      wordRepository.find!.mockResolvedValue([]);
      grammarPatternRepository.find!.mockResolvedValue([]);
      contentRepository.find!.mockResolvedValue([]);
      questionRepository.find!.mockResolvedValue([]);

      await service.processAllContent();
      expect(embeddingService.generateBatchEmbeddings).not.toHaveBeenCalled();
    });

    /**
     * TC-RAG-CEX-016
     * Objective: Lỗi trong process → wrap throw
     */
    it('TC-RAG-CEX-016 - should wrap and throw on process error', async () => {
      embeddingRepository.delete!.mockRejectedValue(new Error('boom'));
      await expect(service.processAllContent()).rejects.toThrow(
        /Content extraction process failed/,
      );
    });
  });

  describe('extractQuestionContent - all option formats', () => {
    /**
     * TC-RAG-CEX-017
     * Objective: Question audio input + image input → trích audioUrl + imageUrl
     */
    it('TC-RAG-CEX-017 - should extract audioUrl and imageUrl based on inputType', async () => {
      questionRepository.find!.mockResolvedValue([
        {
          id: 1,
          lessonId: 1,
          questionType: 'question_selection_audio_text',
          data: { question: 'Q', audioUrl: 'a.mp3' },
          lesson: { name: 'L' },
        },
        {
          id: 2,
          lessonId: 1,
          questionType: 'question_selection_image_text',
          data: { question: 'Q', imageUrl: 'i.png' },
          lesson: { name: 'L' },
        },
      ]);
      const result = await service.extractQuestionContent();
      expect(result[0].text).toMatch(/Audio content/);
      expect(result[1].text).toMatch(/Image content/);
    });

    /**
     * TC-RAG-CEX-018
     * Objective: Options với 4 format khác nhau: content, text, plain string, image/audio object
     */
    it('TC-RAG-CEX-018 - should handle all option formats', async () => {
      questionRepository.find!.mockResolvedValue([
        {
          id: 1,
          lessonId: 1,
          questionType: 'question_selection_text_text',
          data: {
            question: 'Q',
            options: [
              { content: { text: 'A1' } }, // new format
              { text: 'B1' }, // legacy
              'C1' as any, // plain string
              { imageUrl: 'd.png', audioUrl: 'd.mp3' }, // media object
            ],
          },
          lesson: { name: 'L' },
        },
      ]);
      const result = await service.extractQuestionContent();
      expect(result[0].text).toMatch(/A: A1/);
      expect(result[0].text).toMatch(/B: B1/);
      expect(result[0].text).toMatch(/C: C1/);
      expect(result[0].text).toMatch(/D:.*Image.*d\.png/);
      expect(result[0].text).toMatch(/Audio: d\.mp3/);
    });

    /**
     * TC-RAG-CEX-019
     * Objective: Segment loại không phải text/blank → fallback về '' (default)
     */
    it('TC-RAG-CEX-019 - should default unknown segment type to empty', async () => {
      questionRepository.find!.mockResolvedValue([
        {
          id: 1,
          lessonId: 1,
          questionType: 'question_fill_text_text',
          data: {
            question: 'Q',
            segments: [{ type: 'unknown' }, { type: 'text', content: { text: 'X' } }],
          },
          lesson: { name: 'L' },
        },
      ]);
      const result = await service.extractQuestionContent();
      expect(result[0].text).toContain('Sentence');
    });

    /**
     * TC-RAG-CEX-020
     * Objective: Blanks legacy format - phần tử string (không phải object)
     */
    it('TC-RAG-CEX-020 - should handle blank as plain value (non-object)', async () => {
      questionRepository.find!.mockResolvedValue([
        {
          id: 1,
          lessonId: 1,
          questionType: 'question_fill_text_text',
          data: {
            question: 'Q',
            blanks: ['是', '不'], // plain strings
          },
          lesson: { name: 'L' },
        },
      ]);
      const result = await service.extractQuestionContent();
      expect(result[0].text).toMatch(/Blank 1: 是/);
    });

    /**
     * TC-RAG-CEX-021
     * Objective: Cả data.answer và data.correctAnswers → trích cả 3 trường
     */
    it('TC-RAG-CEX-021 - should extract data.answer and data.correctAnswers', async () => {
      questionRepository.find!.mockResolvedValue([
        {
          id: 1,
          lessonId: 1,
          questionType: 'question_selection_text_text',
          data: {
            question: 'Q',
            answer: 'X',
            correctAnswers: ['A', 'B'],
            hint: 'h',
          },
          lesson: { name: 'L' },
        },
      ]);
      const result = await service.extractQuestionContent();
      expect(result[0].text).toMatch(/Answer: X/);
      expect(result[0].text).toMatch(/Answers: A, B/);
      expect(result[0].text).toMatch(/Hint: h/);
    });

    /**
     * TC-RAG-CEX-024
     * Objective: Option là kiểu nguyên thủy không phải string/object (number) → fallthrough '' (line 318)
     */
    it('TC-RAG-CEX-024 - should fallthrough to empty for non-string/object option', async () => {
      questionRepository.find!.mockResolvedValue([
        {
          id: 1,
          lessonId: 1,
          questionType: 'question_selection_text_text',
          data: {
            question: 'Q',
            options: [42 as any], // number → fallthrough return ''
          },
          lesson: { name: 'L' },
        },
      ]);
      const result = await service.extractQuestionContent();
      // số bị filter ở `.filter(opt => opt)` rồi join → text vẫn được tạo dù options rỗng
      expect(result[0].text).toBeDefined();
    });

    /**
     * TC-RAG-CEX-022
     * Objective: TextContent fallback empty khi content null/empty
     */
    it('TC-RAG-CEX-022 - should fallback empty for null/missing TextContent', async () => {
      questionRepository.find!.mockResolvedValue([
        {
          id: 1,
          lessonId: 1,
          questionType: 'question_fill_text_text',
          data: {
            question: 'Q',
            optionBankItems: [null, {}, { chinese: [] }], // các edge cases
          },
          lesson: { name: 'L' },
        },
      ]);
      const result = await service.extractQuestionContent();
      expect(result[0].text).toMatch(/Option bank/);
    });
  });

  describe('generateEmbeddingsForContent - batch delay branch', () => {
    /**
     * TC-RAG-CEX-023
     * Objective: Khi có nhiều hơn 1 batch → có delay setTimeout giữa các batch
     */
    it('TC-RAG-CEX-023 - should delay between batches when multiple batches', async () => {
      const items = Array.from({ length: 15 }, (_, i) => ({
        sourceType: SourceType.WORD,
        sourceId: i + 1,
        text: `t${i}`,
        metadata: {},
      }));
      embeddingService.generateBatchEmbeddings.mockResolvedValue(
        Array.from({ length: 10 }, () => [0.1]),
      );
      embeddingRepository.save!.mockResolvedValue([]);

      // Spy setTimeout để xác nhận có delay (skip thực tế)
      jest.spyOn(global, 'setTimeout').mockImplementation((cb: any) => {
        cb();
        return 0 as any;
      });

      await service.generateEmbeddingsForContent(items);
      // 15 items / 10 batchSize = 2 batch → có 1 lần delay
      expect(setTimeout).toHaveBeenCalled();

      (global.setTimeout as any).mockRestore?.();
    });
  });

  describe('extractTextFromData - edge cases', () => {
    /**
     * TC-RAG-CEX-025
     * Objective: data rỗng hoặc không phải object → trả về '' (line 205/267)
     */
    it('TC-RAG-CEX-025 - should return empty for non-object data', async () => {
      contentRepository.find!.mockResolvedValue([
        { id: 1, lessonId: 1, type: 'text', data: 'not-an-object' as any, isActive: true },
      ]);
      const result = await service.extractLessonContent();
      expect(result).toHaveLength(0);
    });

    /**
     * TC-RAG-CEX-026
     * Objective: Trích xuất các trường nội dung đặc thù: content, explanation, description
     */
    it('TC-RAG-CEX-026 - should extract specific content fields', async () => {
      contentRepository.find!.mockResolvedValue([
        {
          id: 1,
          lessonId: 1,
          type: 'text',
          data: { content: 'C', explanation: 'E', description: 'D' },
          isActive: true,
        },
      ]);
      const result = await service.extractLessonContent();
      expect(result[0].text).toContain('C');
      expect(result[0].text).toContain('Explanation: E');
      expect(result[0].text).toContain('Description: D');
    });

    /**
     * TC-RAG-CEX-027
     * Objective: extractTextFromTextContent với legacy string input (line 251)
     */
    it('TC-RAG-CEX-027 - should handle legacy string in TextContent extract', async () => {
      questionRepository.find!.mockResolvedValue([
        {
          id: 1,
          lessonId: 1,
          questionType: 'question_selection_text_text',
          data: { questionContent: 'Legacy' }, // line 251
          isActive: true,
        },
      ]);
      const result = await service.extractQuestionContent();
      expect(result[0].text).toContain('Legacy');
    });

    /**
     * TC-RAG-CEX-028
     * Objective: Matching pairs legacy format: question/answer thay vì left/right (line 366-367)
     */
    it('TC-RAG-CEX-028 - should handle matching pairs legacy format', async () => {
      questionRepository.find!.mockResolvedValue([
        {
          id: 1,
          lessonId: 1,
          questionType: 'question_matching_text_text',
          data: { pairs: [{ question: 'Q', answer: 'A' }] },
          isActive: true,
        },
      ]);
      const result = await service.extractQuestionContent();
      expect(result[0].text).toMatch(/Q matches A/);
    });

    /**
     * TC-RAG-CEX-029
     * Objective: Question data có prompt, instruction, text (line 281-283)
     */
    it('TC-RAG-CEX-029 - should extract prompt, instruction and text from questions', async () => {
      questionRepository.find!.mockResolvedValue([
        {
          id: 1,
          lessonId: 1,
          questionType: 'question_selection_text_text',
          data: { prompt: 'P', instruction: 'I', text: 'T' },
          isActive: true,
        },
      ]);
      const result = await service.extractQuestionContent();
      expect(result[0].text).toContain('Prompt: P');
      expect(result[0].text).toContain('Instruction: I');
      expect(result[0].text).toContain('T.');
    });

    /**
     * TC-RAG-CEX-030
     * Objective: Phủ toàn bộ các nhánh còn lại của toán tử || (chinese, english, content, left, right)
     */
    it('TC-RAG-CEX-030 - should cover all alternative field branches', async () => {
      // --- ARRANGE ---
      contentRepository.find!.mockResolvedValue([
        {
          id: 1,
          lessonId: 1,
          type: 'mixed',
          data: {
            // Kiểm tra trường hợp hội thoại (dialog) có trường content và trường rỗng.
            dialog: [
              { speaker: 'A', content: 'C' }, 
              { speaker: '', text: '' }
            ],
            // Kiểm tra trường hợp từ vựng (vocabulary) dùng chinese/english và trường rỗng.
            vocabulary: [
              { chinese: 'C', english: 'E' },
              { word: '', meaning: '' }
            ],
            // Kiểm tra trường hợp ví dụ (examples) dùng text/translation và trường rỗng.
            examples: [
              { text: 'T', translation: 'Tr' },
              { chinese: '', english: '' }
            ],
          },
          isActive: true,
        },
      ]);
      questionRepository.find!.mockResolvedValue([
        {
          id: 1,
          lessonId: 1,
          questionType: 'question_matching_text_text',
          data: {
            questionContent: { chinese: ['你'] },
            // Kiểm tra trường hợp câu hỏi nối cặp (pairs) dùng question/answer và trường rỗng.
            pairs: [
              { left: 'L', right: 'R' },
              { question: '', answer: '' }
            ],
            blanks: [{ correct: ['A'] }],
          },
          isActive: true,
        },
      ]);

      // --- ACT ---
      const res1 = await service.extractLessonContent();
      const res2 = await service.extractQuestionContent();

      // --- ASSERT ---
      // Xác nhận logic trích xuất hoạt động đúng với cả dữ liệu đầy đủ và dữ liệu rỗng.
      expect(res1[0].text).toContain('C');
      expect(res2[0].text).toContain('L matches R');
    });
  });
});
