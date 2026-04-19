/// <reference types="jest" />
/**
 * Shared mock helpers for unit testing.
 *
 * - createMockRepository(): trả về một object đầy đủ các method TypeORM Repository
 *   thường dùng, mỗi method là jest.fn() để dễ assert (CheckDB).
 * - createMockQueryBuilder(): trả về QueryBuilder fluent API mock; tất cả method
 *   chainable đều return về chính nó để chuỗi gọi không bị break.
 *
 * Mục tiêu:
 *   + CheckDB: assert mock methods được gọi với tham số đúng yêu cầu
 *   + Rollback: vì DB là mock thuần, không có mutation thật. Việc reset state
 *     giữa các test được đảm bảo bằng jest.clearAllMocks() trong afterEach.
 */
// Use `any` for index signature so test code có thể truy cập __queryBuilder.<method>
// mà không bị TypeScript phàn nàn về kiểu cụ thể (vd: andWhere, getOne).
export type MockRepository = Record<string, any>;

export const createMockQueryBuilder = (): any => {
  const qb: any = {};
  const chainMethods = [
    'select',
    'addSelect',
    'where',
    'andWhere',
    'orWhere',
    'leftJoin',
    'leftJoinAndSelect',
    'innerJoin',
    'innerJoinAndSelect',
    'orderBy',
    'addOrderBy',
    'groupBy',
    'addGroupBy',
    'skip',
    'take',
    'limit',
    'offset',
    'from',
    'update',
    'set',
    'insert',
    'into',
    'values',
    'delete',
  ];
  chainMethods.forEach((m) => {
    qb[m] = jest.fn().mockReturnValue(qb);
  });

  // Terminal methods (return data) - default to undefined; tests override
  qb.getOne = jest.fn();
  qb.getMany = jest.fn();
  qb.getManyAndCount = jest.fn();
  qb.getRawOne = jest.fn();
  qb.getRawMany = jest.fn();
  qb.getCount = jest.fn();
  qb.execute = jest.fn();
  return qb;
};

export const createMockRepository = (): MockRepository => {
  const queryBuilder = createMockQueryBuilder();
  return {
    find: jest.fn(),
    findOne: jest.fn(),
    findAndCount: jest.fn(),
    findBy: jest.fn(),
    findOneBy: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    remove: jest.fn(),
    count: jest.fn(),
    countBy: jest.fn(),
    createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    // Expose qb để test có thể dễ dàng setup return values
    __queryBuilder: queryBuilder,
  } as any;
};
