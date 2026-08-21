import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  PreconditionFailedException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import {
  Attachment,
  AttachmentVersion,
  AuditLog,
  EncryptedExpenseKey,
  Expense,
  ExpenseSplit,
  ExpensePayment,
  ExpenseSplitVersion,
  ExpenseTag,
  ExpenseVersion,
  Group,
  GroupKeyVersion,
  GroupMember,
  ReceiptVersion,
  User,
} from '@finmate/data-models';
import { Repository } from 'typeorm';
import { ExpensesService } from './expenses.service';
import { ExpenseEditPolicyService } from './services/expense-edit-policy.service';

describe('ExpensesService', () => {
  let service: ExpensesService;
  let expenseRepository: jest.Mocked<Repository<Expense>>;
  let splitRepository: jest.Mocked<Repository<ExpenseSplit>>;
  let groupRepository: jest.Mocked<Repository<Group>>;
  let groupMemberRepository: jest.Mocked<Repository<GroupMember>>;
  let userRepository: jest.Mocked<Repository<User>>;
  let attachmentRepository: jest.Mocked<Repository<Attachment>>;
  let groupKeyVersionRepository: {
    findOne: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
  };
  let expenseVersionRepository: jest.Mocked<Repository<ExpenseVersion>>;
  let expenseSplitVersionRepository: jest.Mocked<
    Repository<ExpenseSplitVersion>
  >;
  let attachmentVersionRepository: jest.Mocked<Repository<AttachmentVersion>>;
  let receiptVersionRepository: jest.Mocked<Repository<ReceiptVersion>>;
  let entityManagerMock: { create: jest.Mock; save: jest.Mock };
  let expenseTagRepositoryMock: { create: jest.Mock; save: jest.Mock };

  // Freeze the clock so the month-lock edit window (ExpenseEditPolicyService)
  // is deterministic. The fixtures below use fixed dates written against a
  // "current month = June 2026" assumption: 15 Jun 2026 keeps June/July open
  // and locks May 2026 and older, which is exactly what these tests expect.
  // Only Date is faked — timers stay real so async flows are unaffected.
  beforeAll(() => {
    jest.useFakeTimers({
      doNotFake: [
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
        'setImmediate',
        'clearImmediate',
        'nextTick',
        'hrtime',
        'performance',
        'queueMicrotask',
        'requestAnimationFrame',
        'cancelAnimationFrame',
        'requestIdleCallback',
        'cancelIdleCallback',
      ],
      now: new Date('2026-06-15T12:00:00Z'),
    });
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  beforeEach(async () => {
    const mockExpenseRepository = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      save: jest.fn(async (data) => data),
      create: jest.fn((data) => data),
      delete: jest.fn(),
      createQueryBuilder: jest.fn(),
      softRemove: jest.fn((data) => Promise.resolve(data)),
      restore: jest.fn(() => Promise.resolve()),
    };

    const mockSplitRepository = {
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn(async (data) => data),
      create: jest.fn((data) => data),
      delete: jest.fn(),
      softDelete: jest.fn(),
    };

    const mockGroupRepository = {
      findOne: jest.fn(),
    };

    const mockGroupMemberRepository = {
      findOne: jest.fn(),
      find: jest.fn(),
    };

    const mockUserRepository = {
      findOne: jest.fn(),
      find: jest.fn(),
    };

    const mockAttachmentRepository = {
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn(async (data) => data),
      create: jest.fn((data) => data),
      delete: jest.fn(),
    };

    const mockAuditLogRepository = {
      save: jest.fn(async (data) => data),
      create: jest.fn((data) => data),
    };

    const mockEncryptedExpenseKeyRepository = {
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn(),
      create: jest.fn((data) => data),
      delete: jest.fn(),
    };

    const mockContributionRepository = {
      createQueryBuilder: jest.fn(() => ({
        innerJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      })),
    };

    const mockGroupKeyVersionRepository = {
      findOne: jest.fn(),
      save: jest.fn(async (data) => data),
      create: jest.fn((data) => data),
    };

    const mockExpenseVersionRepository = {
      save: jest.fn(async (data) => data),
      create: jest.fn((data) => data),
    };

    const mockExpenseSplitVersionRepository = {
      save: jest.fn(async (data) => data),
      create: jest.fn((data) => data),
    };

    const mockAttachmentVersionRepository = {
      save: jest.fn(async (data) => data),
      create: jest.fn((data) => data),
    };

    const mockReceiptVersionRepository = {
      save: jest.fn(async (data) => data),
      create: jest.fn((data) => data),
    };

    const mockExpenseTagRepository = {
      save: jest.fn(async (data) => data),
      create: jest.fn((data) => data),
    };

    const mockExpensePaymentRepository = {
      softDelete: jest.fn(async () => ({ affected: 0 })),
      create: jest.fn((data) => data),
      save: jest.fn(async (data) => data),
      count: jest.fn(async () => 1),
      find: jest.fn(async () => []),
    };

    const mockEntityManager = {
      getRepository: jest.fn((entity) => {
        if (entity === Expense) return mockExpenseRepository;
        if (entity === ExpenseSplit) return mockSplitRepository;
        if (entity === ExpensePayment) return mockExpensePaymentRepository;
        if (entity === ExpenseTag) return mockExpenseTagRepository;
        if (entity === Group) return mockGroupRepository;
        if (entity === GroupMember) return mockGroupMemberRepository;
        if (entity === User) return mockUserRepository;
        if (entity === Attachment) return mockAttachmentRepository;
        if (entity === AuditLog) return mockAuditLogRepository;
        if (entity === GroupKeyVersion) return mockGroupKeyVersionRepository;
        if (entity === ExpenseVersion) return mockExpenseVersionRepository;
        if (entity === ExpenseSplitVersion)
          return mockExpenseSplitVersionRepository;
        if (entity === AttachmentVersion)
          return mockAttachmentVersionRepository;
        if (entity === ReceiptVersion) return mockReceiptVersionRepository;
        if (entity === EncryptedExpenseKey)
          return mockEncryptedExpenseKeyRepository;
        if (
          entity &&
          (entity.name === 'GroupMemberContribution' ||
            (typeof entity === 'function' &&
              entity.name === 'GroupMemberContribution'))
        ) {
          return mockContributionRepository;
        }
      }),
      // Generic EntityManager.create/save overloads (manager.create(Entity, data)),
      // used directly by closeMonth()'s carry-forward rollover write path.
      create: jest.fn((_entity, data) => data),
      save: jest.fn((_entity, data) => Promise.resolve(data)),
    };

    const mockDataSource = {
      transaction: jest.fn(async (cb) => await cb(mockEntityManager)),
      getRepository: jest.fn((entity) =>
        mockEntityManager.getRepository(entity),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExpensesService,
        {
          provide: getRepositoryToken(Expense),
          useValue: mockExpenseRepository,
        },
        {
          provide: getRepositoryToken(ExpenseSplit),
          useValue: mockSplitRepository,
        },
        {
          provide: getRepositoryToken(ExpensePayment),
          useValue: mockExpensePaymentRepository,
        },
        { provide: getRepositoryToken(Group), useValue: mockGroupRepository },
        {
          provide: getRepositoryToken(GroupMember),
          useValue: mockGroupMemberRepository,
        },
        { provide: getRepositoryToken(User), useValue: mockUserRepository },
        {
          provide: getRepositoryToken(Attachment),
          useValue: mockAttachmentRepository,
        },
        {
          provide: getRepositoryToken(AuditLog),
          useValue: mockAuditLogRepository,
        },
        {
          provide: getRepositoryToken(EncryptedExpenseKey),
          useValue: mockEncryptedExpenseKeyRepository,
        },
        {
          provide: getRepositoryToken(ExpenseVersion),
          useValue: mockExpenseVersionRepository,
        },
        {
          provide: getRepositoryToken(ExpenseSplitVersion),
          useValue: mockExpenseSplitVersionRepository,
        },
        {
          provide: getRepositoryToken(AttachmentVersion),
          useValue: mockAttachmentVersionRepository,
        },
        {
          provide: getRepositoryToken(ReceiptVersion),
          useValue: mockReceiptVersionRepository,
        },
        { provide: getDataSourceToken(), useValue: mockDataSource },
        // Real policy service (no ConfigService provided → default cutoff of 7),
        // so the edit-window behaviour under test matches production.
        ExpenseEditPolicyService,
      ],
    }).compile();

    service = module.get<ExpensesService>(ExpensesService);
    expenseRepository = module.get(getRepositoryToken(Expense));
    splitRepository = module.get(getRepositoryToken(ExpenseSplit));
    groupRepository = module.get(getRepositoryToken(Group));
    groupMemberRepository = module.get(getRepositoryToken(GroupMember));
    userRepository = module.get(getRepositoryToken(User));
    attachmentRepository = module.get(getRepositoryToken(Attachment));
    groupKeyVersionRepository = mockGroupKeyVersionRepository;
    expenseVersionRepository = module.get(getRepositoryToken(ExpenseVersion));
    expenseSplitVersionRepository = module.get(
      getRepositoryToken(ExpenseSplitVersion),
    );
    attachmentVersionRepository = module.get(
      getRepositoryToken(AttachmentVersion),
    );
    receiptVersionRepository = module.get(getRepositoryToken(ReceiptVersion));
    entityManagerMock = mockEntityManager;
    expenseTagRepositoryMock = mockExpenseTagRepository;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should reject personal expense if paidByUserId is not caller', async () => {
    userRepository.findOne
      .mockResolvedValueOnce({ id: 'caller-id' } as any)
      .mockResolvedValueOnce({ id: 'other-id' } as any);

    await expect(
      service.createExpense('caller-id', {
        title: 'Lunch',
        amountTotal: 100,
        currency: 'usd',
        category: 'Food',
        paidByUserId: 'other-id',
        expenseDate: '2026-06-10',
        splits: [
          { participantUserId: 'caller-id', splitType: 'equal', shareValue: 1 },
        ],
      } as any),
    ).rejects.toThrow(ForbiddenException);
  });

  it('should reject group write for viewer role', async () => {
    userRepository.findOne
      .mockResolvedValueOnce({ id: 'caller-id' } as any)
      .mockResolvedValueOnce({ id: 'caller-id' } as any);

    groupMemberRepository.findOne.mockResolvedValueOnce({
      id: 'membership-id',
      role: 'viewer',
      joinStatus: 'active',
    } as any);

    await expect(
      service.createExpense('caller-id', {
        title: 'Trip stay',
        amountTotal: 100,
        currency: 'INR',
        category: 'Accommodation',
        paidByUserId: 'caller-id',
        groupId: 'group-id',
        expenseDate: '2026-06-10',
        splits: [
          { participantUserId: 'caller-id', splitType: 'equal', shareValue: 1 },
        ],
      } as any),
    ).rejects.toThrow(ForbiddenException);
  });

  it('should reject personal create with participantGroupMemberId', async () => {
    userRepository.findOne
      .mockResolvedValueOnce({ id: 'caller-id' } as any)
      .mockResolvedValueOnce({ id: 'caller-id' } as any);

    await expect(
      service.createExpense('caller-id', {
        title: 'Lunch',
        amountTotal: 100,
        currency: 'USD',
        category: 'Food',
        paidByUserId: 'caller-id',
        expenseDate: '2026-06-10',
        splits: [
          {
            participantGroupMemberId: 'member-1',
            splitType: 'equal',
            shareValue: 1,
          },
        ],
      } as any),
    ).rejects.toThrow(BadRequestException);
  });

  it('should reject create with direct_shared encryption scope', async () => {
    userRepository.findOne
      .mockResolvedValueOnce({ id: 'caller-id' } as any)
      .mockResolvedValueOnce({ id: 'caller-id' } as any);

    await expect(
      service.createExpense('caller-id', {
        title: 'Shared Lunch',
        amountTotal: 100,
        currency: 'USD',
        category: 'Food',
        paidByUserId: 'caller-id',
        expenseDate: '2026-06-10',
        encryptionScope: 'direct_shared',
        splits: [
          { participantUserId: 'caller-id', splitType: 'equal', shareValue: 1 },
        ],
      } as any),
    ).rejects.toThrow(BadRequestException);
  });

  it('should reject personal create with multiple participants when no group is provided', async () => {
    userRepository.findOne
      .mockResolvedValueOnce({ id: 'caller-id' } as any)
      .mockResolvedValueOnce({ id: 'caller-id' } as any);

    await expect(
      service.createExpense('caller-id', {
        title: 'Shared Ride',
        amountTotal: 100,
        currency: 'USD',
        category: 'Travel',
        paidByUserId: 'caller-id',
        expenseDate: '2026-06-10',
        splits: [
          { participantUserId: 'caller-id', splitType: 'equal', shareValue: 1 },
          { participantUserId: 'friend-id', splitType: 'equal', shareValue: 1 },
        ],
      } as any),
    ).rejects.toThrow(BadRequestException);
  });

  it('should reject create when group is archived', async () => {
    userRepository.findOne
      .mockResolvedValueOnce({ id: 'caller-id' } as any)
      .mockResolvedValueOnce({ id: 'caller-id' } as any);

    groupMemberRepository.findOne.mockResolvedValueOnce({
      id: 'membership-id',
      role: 'member',
      joinStatus: 'active',
    } as any);
    groupRepository.findOne.mockResolvedValueOnce({
      id: 'group-id',
      isArchived: true,
    } as any);

    await expect(
      service.createExpense('caller-id', {
        title: 'Trip stay',
        amountTotal: 100,
        currency: 'INR',
        category: 'Accommodation',
        paidByUserId: 'caller-id',
        groupId: 'group-id',
        expenseDate: '2026-06-10',
        splits: [
          { participantUserId: 'caller-id', splitType: 'equal', shareValue: 1 },
        ],
      } as any),
    ).rejects.toThrow(ForbiddenException);
  });

  it('should throw precondition failed on version conflict', async () => {
    expenseRepository.findOne.mockResolvedValue({
      id: 'exp-1',
      version: 2,
      group: null,
      ownerUser: { id: 'caller-id' },
      paidByUser: { id: 'caller-id' },
    } as any);

    await expect(
      service.updateExpense('caller-id', 'exp-1', {
        version: 1,
      } as any),
    ).rejects.toThrow(PreconditionFailedException);
  });

  it('should throw not found for unknown expense', async () => {
    expenseRepository.findOne.mockResolvedValue(null);

    await expect(
      service.getExpenseById('caller-id', 'missing'),
    ).rejects.toThrow(NotFoundException);
  });

  it('should require splits when amount changes on update', async () => {
    expenseRepository.findOne.mockResolvedValue({
      id: 'exp-1',
      version: 1,
      title: 'Lunch',
      description: null,
      amountTotal: 50,
      currency: 'USD',
      category: 'Food',
      paidByUser: { id: 'caller-id' },
      ownerUser: { id: 'caller-id' },
      expenseDate: '2026-06-10',
      status: 'posted',
      group: null,
    } as any);

    await expect(
      service.updateExpense('caller-id', 'exp-1', {
        version: 1,
        amountTotal: 55,
      } as any),
    ).rejects.toThrow(BadRequestException);
  });

  it('should reject personal update when paidByUserId is not caller', async () => {
    expenseRepository.findOne.mockResolvedValue({
      id: 'exp-1',
      version: 1,
      title: 'Lunch',
      description: null,
      amountTotal: 50,
      currency: 'USD',
      category: 'Food',
      paidByUser: { id: 'caller-id' },
      ownerUser: { id: 'caller-id' },
      expenseDate: '2026-06-10',
      status: 'posted',
      group: null,
    } as any);
    userRepository.findOne.mockResolvedValue({ id: 'other-user' } as any);

    await expect(
      service.updateExpense('caller-id', 'exp-1', {
        version: 1,
        paidByUserId: 'other-user',
      } as any),
    ).rejects.toThrow(ForbiddenException);
  });

  it('should reject group update when new payer is not group member', async () => {
    expenseRepository.findOne.mockResolvedValue({
      id: 'exp-1',
      version: 1,
      title: 'Trip',
      description: null,
      amountTotal: 50,
      currency: 'USD',
      category: 'Travel',
      paidByUser: { id: 'caller-id' },
      ownerUser: { id: 'caller-id' },
      expenseDate: '2026-07-10',
      status: 'posted',
      group: { id: 'group-id' },
    } as any);
    groupMemberRepository.findOne
      .mockResolvedValueOnce({
        id: 'membership-id',
        role: 'member',
        joinStatus: 'active',
      } as any)
      .mockResolvedValueOnce(null);
    groupRepository.findOne.mockResolvedValue({
      id: 'group-id',
      isArchived: false,
    } as any);
    userRepository.findOne.mockResolvedValue({ id: 'other-user' } as any);

    await expect(
      service.updateExpense('caller-id', 'exp-1', {
        version: 1,
        paidByUserId: 'other-user',
      } as any),
    ).rejects.toThrow(BadRequestException);
  });

  it('should void posted expense on delete', async () => {
    const expense = {
      id: 'exp-1',
      status: 'posted',
      group: null,
      ownerUser: { id: 'caller-id' },
      paidByUser: { id: 'caller-id' },
    } as any;

    expenseRepository.findOne.mockResolvedValue(expense);
    expenseRepository.softRemove.mockResolvedValue(expense);

    await service.deleteExpense('caller-id', 'exp-1');

    expect(expense.status).toBe('void');
    expect(expenseRepository.softRemove).toHaveBeenCalledWith(expense);
  });

  it('should hard delete draft expense on delete', async () => {
    expenseRepository.findOne.mockResolvedValue({
      id: 'exp-1',
      status: 'draft',
      group: null,
      ownerUser: { id: 'caller-id' },
      paidByUser: { id: 'caller-id' },
    } as any);

    await service.deleteExpense('caller-id', 'exp-1');

    expect(expenseRepository.delete).toHaveBeenCalledWith({ id: 'exp-1' });
  });

  it('should build paginated list for caller', async () => {
    groupMemberRepository.find.mockResolvedValue([] as any);

    // Aggregate sub-query returned by `.clone()` for scope-wide totals.
    const totalsBuilder = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      addGroupBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([
        { currency: 'USD', transactionType: 'expense', sum: '50' },
        { currency: 'USD', transactionType: 'refund', sum: '20' },
      ]),
    };

    const queryBuilder = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orWhere: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      clone: jest.fn(() => totalsBuilder),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(1),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([
        {
          id: 'exp-1',
          title: 'Lunch',
          description: null,
          amountTotal: 50,
          currency: 'USD',
          category: 'Food',
          paidByUser: { id: 'caller-id' },
          ownerUser: { id: 'caller-id' },
          group: null,
          expenseDate: '2026-06-10',
          status: 'posted',
          version: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]),
    };

    expenseRepository.createQueryBuilder.mockReturnValue(queryBuilder as any);
    splitRepository.find.mockResolvedValue([] as any);
    attachmentRepository.find.mockResolvedValue([] as any);

    const result = await service.listExpenses('caller-id', {
      page: 1,
      limit: 20,
      categories: ['Food'],
    });

    expect(result.meta.totalItems).toBe(1);
    expect(result.data).toHaveLength(1);
    // Scope-wide totals come from the aggregate, not the page rows.
    expect(result.meta.totals).toEqual([
      { currency: 'USD', totalExpense: 50, totalRefund: 20, net: 30 },
    ]);
  });

  it('should reject list request with invalid date format', async () => {
    await expect(
      service.listExpenses('caller-id', {
        page: 1,
        limit: 20,
        startDate: '06-10-2026',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('should reject a shape-valid but impossible calendar date (400, not 500)', async () => {
    // 2026-06-31 passes the YYYY-MM-DD regex but June has 30 days; without the
    // calendar check this reaches Postgres and surfaces as an unhandled 500.
    await expect(
      service.listExpenses('caller-id', {
        page: 1,
        limit: 20,
        endDate: '2026-06-31',
      }),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.listExpenses('caller-id', {
        page: 1,
        limit: 20,
        endDate: '2026-02-30',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('should reject list request for unauthorized group filter', async () => {
    groupMemberRepository.find.mockResolvedValue([] as any);

    await expect(
      service.listExpenses('caller-id', {
        page: 1,
        limit: 20,
        groupId: 'group-id',
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  // ─── Phase 5: Additional Unit Tests ────────────────────────────────────────

  describe('group key version stamping (G-ROT write path)', () => {
    const groupMember = {
      id: 'membership-id',
      role: 'member',
      joinStatus: 'active',
      user: { id: 'caller-id' },
    } as any;

    const baseGroupDto = {
      title: 'cipher:title',
      amountTotal: 100,
      currency: 'USD',
      category: 'Food',
      paidByUserId: 'caller-id',
      groupId: 'group-id',
      expenseDate: '2026-07-10',
      splits: [
        { participantUserId: 'caller-id', splitType: 'equal', shareValue: 1 },
      ],
    };

    it('should reject a declared groupKeyVersionId on a personal create', async () => {
      userRepository.findOne
        .mockResolvedValueOnce({ id: 'caller-id' } as any)
        .mockResolvedValueOnce({ id: 'caller-id' } as any);

      await expect(
        service.createExpense('caller-id', {
          ...baseGroupDto,
          groupId: undefined,
          groupKeyVersionId: 'v1-id',
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject a declared version that does not belong to the group', async () => {
      userRepository.findOne.mockResolvedValue({ id: 'caller-id' } as any);
      groupMemberRepository.findOne.mockResolvedValue(groupMember);
      groupRepository.findOne.mockResolvedValue({
        id: 'group-id',
        currency: 'USD',
        isArchived: false,
      } as any);
      groupKeyVersionRepository.findOne.mockResolvedValue(null);

      await expect(
        service.createExpense('caller-id', {
          ...baseGroupDto,
          groupKeyVersionId: 'foreign-version-id',
        } as any),
      ).rejects.toThrow(BadRequestException);

      expect(groupKeyVersionRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'foreign-version-id', group: { id: 'group-id' } },
      });
    });

    it('should reject a declared version that is revoked', async () => {
      userRepository.findOne.mockResolvedValue({ id: 'caller-id' } as any);
      groupMemberRepository.findOne.mockResolvedValue(groupMember);
      groupRepository.findOne.mockResolvedValue({
        id: 'group-id',
        currency: 'USD',
        isArchived: false,
      } as any);
      groupKeyVersionRepository.findOne.mockResolvedValue({
        id: 'revoked-id',
        version: 1,
        status: 'REVOKED',
      } as any);

      await expect(
        service.createExpense('caller-id', {
          ...baseGroupDto,
          groupKeyVersionId: 'revoked-id',
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should stamp the declared (even superseded) version on create instead of ACTIVE', async () => {
      userRepository.findOne.mockResolvedValue({ id: 'caller-id' } as any);
      groupMemberRepository.findOne.mockResolvedValue(groupMember);
      groupMemberRepository.find.mockResolvedValue([groupMember]);
      groupRepository.findOne.mockResolvedValue({
        id: 'group-id',
        currency: 'USD',
        isArchived: false,
      } as any);

      const supersededVersion = {
        id: 'v1-id',
        version: 1,
        status: 'SUPERSEDED',
      } as any;
      groupKeyVersionRepository.findOne.mockResolvedValue(supersededVersion);

      expenseRepository.save.mockImplementation(async (data: any) => ({
        ...data,
        id: 'exp-1',
      }));
      expenseRepository.findOne.mockResolvedValue({
        id: 'exp-1',
        title: 'cipher:title',
        amountTotal: 100,
        currency: 'USD',
        category: 'Food',
        expenseDate: '2026-06-10',
        status: 'posted',
        encryptionScope: 'group',
        isCarryForward: false,
        paidByUser: { id: 'caller-id' },
        ownerUser: { id: 'caller-id' },
        group: { id: 'group-id' },
        groupKeyVersion: supersededVersion,
      } as any);
      splitRepository.find.mockResolvedValue([]);
      attachmentRepository.find.mockResolvedValue([]);

      const result = await service.createExpense('caller-id', {
        ...baseGroupDto,
        groupKeyVersionId: 'v1-id',
        encryptedAttachments: [
          {
            storageKey: 'receipts/exp-1',
            encryptedFileKey: 'iv:key',
            encryptedOriginalName: 'iv:name',
            mimeType: 'image/jpeg',
            sizeBytes: 42,
          },
        ],
      } as any);

      expect(expenseRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          groupKeyVersion: expect.objectContaining({ id: 'v1-id' }),
        }),
      );
      expect(expenseVersionRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'created',
          expense: expect.objectContaining({ id: 'exp-1' }),
          snapshot: expect.objectContaining({ groupKeyVersionId: 'v1-id' }),
        }),
      );
      expect(expenseSplitVersionRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'created',
          expense: expect.objectContaining({ id: 'exp-1' }),
        }),
      );
      expect(attachmentVersionRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'created',
          snapshot: expect.objectContaining({ storageKey: 'receipts/exp-1' }),
        }),
      );
      expect(receiptVersionRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'created',
          snapshot: expect.objectContaining({ storageKey: 'receipts/exp-1' }),
        }),
      );
      expect(result['groupKeyVersionId']).toBe('v1-id');
    });

    it('should re-stamp the declared version on update', async () => {
      const expense = {
        id: 'exp-1',
        version: 1,
        title: 'cipher:old',
        description: null,
        amountTotal: 100,
        currency: 'USD',
        category: 'Food',
        expenseDate: '2026-07-10',
        status: 'posted',
        encryptionScope: 'group',
        isCarryForward: false,
        paidByUser: { id: 'caller-id' },
        ownerUser: { id: 'caller-id' },
        group: { id: 'group-id' },
        groupKeyVersion: { id: 'v1-id', version: 1 },
      } as any;

      expenseRepository.findOne.mockResolvedValue(expense);
      userRepository.findOne.mockResolvedValue({ id: 'caller-id' } as any);
      groupMemberRepository.findOne.mockResolvedValue(groupMember);
      groupRepository.findOne.mockResolvedValue({
        id: 'group-id',
        currency: 'USD',
        isArchived: false,
      } as any);
      splitRepository.find.mockResolvedValue([]);
      attachmentRepository.find.mockResolvedValue([]);

      const rotatedVersion = {
        id: 'v2-id',
        version: 2,
        status: 'ACTIVE',
      } as any;
      groupKeyVersionRepository.findOne.mockResolvedValue(rotatedVersion);

      const result = await service.updateExpense('caller-id', 'exp-1', {
        version: 1,
        title: 'cipher:new',
        groupKeyVersionId: 'v2-id',
      } as any);

      expect(groupKeyVersionRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'v2-id', group: { id: 'group-id' } },
      });
      expect(expense.groupKeyVersion).toEqual(
        expect.objectContaining({ id: 'v2-id' }),
      );
      expect(expenseVersionRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'updated',
          expense: expect.objectContaining({ id: 'exp-1' }),
          snapshot: expect.objectContaining({ groupKeyVersionId: 'v2-id' }),
        }),
      );
      expect(result['groupKeyVersionId']).toBe('v2-id');
    });

    it('should reject a declared groupKeyVersionId on a personal update', async () => {
      expenseRepository.findOne.mockResolvedValue({
        id: 'exp-1',
        version: 1,
        title: 'Lunch',
        amountTotal: 50,
        currency: 'USD',
        category: 'Food',
        expenseDate: '2026-06-10',
        status: 'posted',
        paidByUser: { id: 'caller-id' },
        ownerUser: { id: 'caller-id' },
        group: null,
      } as any);
      userRepository.findOne.mockResolvedValue({ id: 'caller-id' } as any);
      splitRepository.find.mockResolvedValue([]);

      await expect(
        service.updateExpense('caller-id', 'exp-1', {
          version: 1,
          groupKeyVersionId: 'v1-id',
        } as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── Single source of truth: one Expense row per group expense ───────────

  describe('no duplicate Expense records', () => {
    it('persists exactly one Expense row for a group expense with multiple participants, one ExpenseSplit per participant', async () => {
      const friendMember = {
        id: 'membership-friend',
        role: 'member',
        joinStatus: 'active',
        user: { id: 'friend-id' },
      } as any;
      const callerMember = {
        id: 'membership-caller',
        role: 'member',
        joinStatus: 'active',
        user: { id: 'caller-id' },
      } as any;

      userRepository.findOne.mockResolvedValue({ id: 'caller-id' } as any);
      groupMemberRepository.findOne.mockResolvedValue(callerMember);
      groupMemberRepository.find.mockResolvedValue([
        callerMember,
        friendMember,
      ]);
      groupRepository.findOne.mockResolvedValue({
        id: 'group-id',
        currency: 'USD',
        isArchived: false,
      } as any);
      groupKeyVersionRepository.findOne.mockResolvedValue({
        id: 'gkv-1',
        version: 1,
        status: 'ACTIVE',
      } as any);

      expenseRepository.save.mockImplementation(async (data: any) => ({
        ...data,
        id: 'exp-shared-1',
      }));
      expenseRepository.findOne.mockResolvedValue({
        id: 'exp-shared-1',
        title: 'Dinner',
        amountTotal: 1000,
        currency: 'USD',
        category: 'Food & Drinks',
        expenseDate: '2026-07-10',
        status: 'posted',
        encryptionScope: 'group',
        isCarryForward: false,
        paidByUser: { id: 'caller-id' },
        ownerUser: { id: 'caller-id' },
        group: { id: 'group-id' },
        groupKeyVersion: { id: 'gkv-1', version: 1 },
      } as any);
      splitRepository.find.mockResolvedValue([]);
      attachmentRepository.find.mockResolvedValue([]);

      await service.createExpense('caller-id', {
        title: 'Dinner',
        amountTotal: 1000,
        currency: 'USD',
        category: 'Food & Drinks',
        paidByUserId: 'caller-id',
        groupId: 'group-id',
        expenseDate: '2026-07-10',
        splits: [
          { participantUserId: 'caller-id', splitType: 'equal', shareValue: 1 },
          { participantUserId: 'friend-id', splitType: 'equal', shareValue: 1 },
        ],
      } as any);

      // One Expense row regardless of how many participants share it.
      expect(expenseRepository.save).toHaveBeenCalledTimes(1);
      // One ExpenseSplit row per participant — the projection, not a copy.
      expect(splitRepository.save).toHaveBeenCalledTimes(2);
      // Frozen group-ledger identity rule: even a registered payer resolves
      // via GroupMember for a group expense — paidByUserId was accepted as
      // client convenience, but paidByUser is never persisted for a group
      // expense; only paidByGroupMember is.
      expect(expenseRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          paidByGroupMember: callerMember,
          paidByUser: undefined,
        }),
      );
    });

    it('supports a pending (Contact-backed) member as payer via paidByGroupMemberId — no paidByUser at all', async () => {
      const callerMember = {
        id: 'membership-caller',
        role: 'member',
        joinStatus: 'active',
        user: { id: 'caller-id' },
      } as any;
      const pendingPayer = {
        id: 'membership-pending',
        role: 'member',
        joinStatus: 'invited',
        user: undefined,
        contact: { id: 'contact-rahul', displayName: 'Rahul' },
      } as any;

      userRepository.findOne.mockResolvedValue({ id: 'caller-id' } as any);
      groupMemberRepository.findOne.mockImplementation(async (opts: any) => {
        if (opts?.where?.id === 'membership-pending') return pendingPayer;
        return callerMember; // caller's own membership check
      });
      groupMemberRepository.find.mockResolvedValue([
        callerMember,
        pendingPayer,
      ]);
      groupRepository.findOne.mockResolvedValue({
        id: 'group-id',
        currency: 'USD',
        isArchived: false,
      } as any);
      groupKeyVersionRepository.findOne.mockResolvedValue({
        id: 'gkv-1',
        version: 1,
        status: 'ACTIVE',
      } as any);

      expenseRepository.save.mockImplementation(async (data: any) => ({
        ...data,
        id: 'exp-pending-payer-1',
      }));
      expenseRepository.findOne.mockResolvedValue({
        id: 'exp-pending-payer-1',
        title: 'Taxi',
        amountTotal: 500,
        currency: 'USD',
        category: 'Travel',
        expenseDate: '2026-07-10',
        status: 'posted',
        encryptionScope: 'group',
        isCarryForward: false,
        paidByUser: undefined,
        paidByGroupMember: pendingPayer,
        ownerUser: { id: 'caller-id' },
        group: { id: 'group-id' },
        groupKeyVersion: { id: 'gkv-1', version: 1 },
      } as any);
      splitRepository.find.mockResolvedValue([]);
      attachmentRepository.find.mockResolvedValue([]);

      const result = await service.createExpense('caller-id', {
        title: 'Taxi',
        amountTotal: 500,
        currency: 'USD',
        category: 'Travel',
        paidByGroupMemberId: 'membership-pending',
        groupId: 'group-id',
        expenseDate: '2026-07-10',
        splits: [
          { participantUserId: 'caller-id', splitType: 'equal', shareValue: 1 },
          {
            participantGroupMemberId: 'membership-pending',
            splitType: 'equal',
            shareValue: 1,
          },
        ],
      } as any);

      expect(expenseRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          paidByUser: undefined,
          paidByGroupMember: pendingPayer,
        }),
      );
      expect((result as any).paidByUserId).toBeNull();
      expect((result as any).paidByGroupMemberId).toBe('membership-pending');
    });
  });

  describe('Phase 5 Verification Rules', () => {
    it('should reject createExpense when currency does not match group base currency', async () => {
      userRepository.findOne
        .mockResolvedValueOnce({ id: 'caller-id' } as any)
        .mockResolvedValueOnce({ id: 'caller-id' } as any);
      groupMemberRepository.findOne.mockResolvedValueOnce({
        id: 'membership-id',
        role: 'member',
        joinStatus: 'active',
      } as any);
      groupRepository.findOne.mockResolvedValueOnce({
        id: 'group-id',
        currency: 'EUR',
        isArchived: false,
      } as any);

      await expect(
        service.createExpense('caller-id', {
          title: 'Lunch',
          amountTotal: 100,
          currency: 'USD', // Mismatch
          category: 'Food',
          paidByUserId: 'caller-id',
          groupId: 'group-id',
          expenseDate: '2026-06-10',
          splits: [
            {
              participantUserId: 'caller-id',
              splitType: 'equal',
              shareValue: 1,
            },
          ],
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject createExpense splits containing a spectator', async () => {
      userRepository.findOne
        .mockResolvedValueOnce({ id: 'caller-id' } as any)
        .mockResolvedValueOnce({ id: 'caller-id' } as any);
      groupMemberRepository.findOne.mockResolvedValueOnce({
        id: 'membership-id',
        role: 'member',
        joinStatus: 'active',
      } as any);
      groupRepository.findOne.mockResolvedValueOnce({
        id: 'group-id',
        currency: 'USD',
        isArchived: false,
      } as any);

      // In persistSplits, buildGroupParticipantMaps is called inside transaction
      // Mock the find method on GroupMember repository inside transaction
      // Set one of the splits to belong to a spectator
      const mockSpectatorMember = {
        id: 'spectator-member-id',
        role: 'spectator',
        joinStatus: 'active',
        user: { id: 'spectator-id' },
      };

      const mockGroupMemberRepositoryFind =
        groupMemberRepository.find as jest.Mock;
      mockGroupMemberRepositoryFind.mockResolvedValueOnce([
        mockSpectatorMember,
      ]);

      await expect(
        service.createExpense('caller-id', {
          title: 'Lunch',
          amountTotal: 100,
          currency: 'USD',
          category: 'Food',
          paidByUserId: 'caller-id',
          groupId: 'group-id',
          expenseDate: '2026-07-10',
          splits: [
            {
              participantUserId: 'spectator-id',
              splitType: 'equal',
              shareValue: 1,
            },
          ],
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject updateExpense on a household group if ledger month is locked', async () => {
      expenseRepository.findOne.mockResolvedValue({
        id: 'exp-1',
        version: 1,
        title: 'Past Rent',
        amountTotal: 500,
        currency: 'USD',
        category: 'Housing',
        paidByUser: { id: 'caller-id' },
        ownerUser: { id: 'caller-id' },
        expenseDate: '2026-05-10',
        ledgerMonth: '2026-05', // Past month (June 2026 is current)
        status: 'posted',
        group: { id: 'group-id' },
      } as any);

      groupMemberRepository.findOne.mockResolvedValue({
        id: 'membership-id',
        role: 'member',
        joinStatus: 'active',
      } as any);

      groupRepository.findOne.mockResolvedValue({
        id: 'group-id',
        groupType: 'household',
        currency: 'USD',
        isArchived: false,
      } as any);

      await expect(
        service.updateExpense('caller-id', 'exp-1', {
          version: 1,
          title: 'Updated Rent',
        } as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should reject a metadata-only update on a normal group expense in a closed month (403)', async () => {
      // Dated years in the past → unambiguously past the grace window whenever
      // the suite runs, so no clock control is needed.
      expenseRepository.findOne.mockResolvedValue({
        id: 'exp-1',
        version: 1,
        title: 'Old Trip',
        amountTotal: 500,
        currency: 'USD',
        category: 'Travel',
        paidByUser: { id: 'caller-id' },
        ownerUser: { id: 'caller-id' },
        expenseDate: '2020-01-10',
        status: 'posted',
        group: { id: 'group-id' },
      } as any);
      groupMemberRepository.findOne.mockResolvedValue({
        id: 'membership-id',
        role: 'member',
        joinStatus: 'active',
      } as any);
      groupRepository.findOne.mockResolvedValue({
        id: 'group-id',
        groupType: 'trip',
        currency: 'USD',
        isArchived: false,
      } as any);

      // Even a title-only edit is rejected — a closed month is fully read-only.
      await expect(
        service.updateExpense('caller-id', 'exp-1', {
          version: 1,
          title: 'Tampered title',
        } as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should reject deleting a normal group expense in a closed month', async () => {
      expenseRepository.findOne.mockResolvedValue({
        id: 'exp-1',
        version: 1,
        title: 'Old Trip',
        amountTotal: 500,
        currency: 'USD',
        category: 'Travel',
        paidByUser: { id: 'caller-id' },
        ownerUser: { id: 'caller-id' },
        expenseDate: '2020-01-10',
        status: 'posted',
        group: { id: 'group-id' },
      } as any);
      groupMemberRepository.findOne.mockResolvedValue({
        id: 'membership-id',
        role: 'member',
        joinStatus: 'active',
      } as any);
      groupRepository.findOne.mockResolvedValue({
        id: 'group-id',
        groupType: 'trip',
        currency: 'USD',
        isArchived: false,
      } as any);

      await expect(service.deleteExpense('caller-id', 'exp-1')).rejects.toThrow(
        ForbiddenException,
      );
      expect(expenseRepository.softRemove).not.toHaveBeenCalled();
    });

    it('should calculate carry forward balances correctly for a household group', async () => {
      groupMemberRepository.findOne.mockResolvedValue({
        id: 'membership-id',
        role: 'member',
        joinStatus: 'active',
      } as any);
      groupRepository.findOne.mockResolvedValue({
        id: 'group-id',
        groupType: 'household',
        currency: 'USD',
      } as any);

      groupMemberRepository.find.mockResolvedValue([
        {
          id: 'member-a',
          user: { id: 'user-a', displayName: 'User A' },
          joinStatus: 'active',
        },
        {
          id: 'member-b',
          user: { id: 'user-b', displayName: 'User B' },
          joinStatus: 'active',
        },
      ] as any);

      // Expenses in the group for 2026-06
      expenseRepository.find.mockResolvedValue([
        {
          id: 'exp-1',
          amountTotal: 150,
          currency: 'USD',
          paidByUser: { id: 'user-a', displayName: 'User A' },
          ownerUser: { id: 'user-a' },
        },
      ] as any);

      const balances = await service.getCarryForwardSummary(
        'caller-id',
        'group-id',
        '2026-06',
      );

      // User A paid 150, owed 75 => net balance +75
      // User B paid 0, owed 75 => net balance -75
      const userABal = balances.find((b) => b.userId === 'user-a');
      const userBBal = balances.find((b) => b.userId === 'user-b');

      expect(userABal?.netBalance).toBe(75);
      expect(userBBal?.netBalance).toBe(-75);
    });

    it('should reject restoreExpense if restore window has expired', async () => {
      const pastDeletionDate = new Date();
      // Set to 2 months ago to be way outside grace period
      pastDeletionDate.setMonth(pastDeletionDate.getMonth() - 2);

      expenseRepository.findOne.mockResolvedValue({
        id: 'exp-1',
        title: 'Old Expense',
        deletedAt: pastDeletionDate,
        ownerUser: { id: 'caller-id' },
        paidByUser: { id: 'caller-id' },
        group: null,
      } as any);

      userRepository.findOne.mockResolvedValue({ id: 'caller-id' } as any);

      await expect(
        service.restoreExpense('caller-id', 'exp-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should allow restoreExpense if within restore window', async () => {
      const recentDeletionDate = new Date();
      // Set to current month, which is always inside restore window
      recentDeletionDate.setDate(1);

      const expense = {
        id: 'exp-1',
        title: 'Recent Expense',
        deletedAt: recentDeletionDate,
        ownerUser: { id: 'caller-id' },
        paidByUser: { id: 'caller-id' },
        group: null,
        status: 'void',
      } as any;

      expenseRepository.findOne.mockResolvedValue(expense);
      userRepository.findOne.mockResolvedValue({ id: 'caller-id' } as any);
      splitRepository.find.mockResolvedValue([]);
      attachmentRepository.find.mockResolvedValue([]);

      const result = await service.restoreExpense('caller-id', 'exp-1');

      expect(result.status).toBe('posted');
      expect(expenseRepository.restore).toHaveBeenCalledWith({ id: 'exp-1' });
    });

    describe('closeMonth', () => {
      it('should throw ForbiddenException if caller is not owner/admin', async () => {
        groupMemberRepository.findOne.mockResolvedValue({
          id: 'membership-id',
          role: 'member',
          joinStatus: 'active',
        } as any);

        await expect(
          service.closeMonth('caller-id', 'group-id', '2026-06'),
        ).rejects.toThrow(ForbiddenException);
      });

      it('should throw BadRequestException if group is not household', async () => {
        groupMemberRepository.findOne.mockResolvedValue({
          id: 'membership-id',
          role: 'admin',
          joinStatus: 'active',
        } as any);

        groupRepository.findOne.mockResolvedValue({
          id: 'group-id',
          groupType: 'normal',
          currency: 'USD',
        } as any);

        await expect(
          service.closeMonth('caller-id', 'group-id', '2026-06'),
        ).rejects.toThrow(BadRequestException);
      });

      it('should throw BadRequestException if month is in the future', async () => {
        groupMemberRepository.findOne.mockResolvedValue({
          id: 'membership-id',
          role: 'admin',
          joinStatus: 'active',
        } as any);

        groupRepository.findOne.mockResolvedValue({
          id: 'group-id',
          groupType: 'household',
          currency: 'USD',
        } as any);

        await expect(
          service.closeMonth('caller-id', 'group-id', '2099-12'),
        ).rejects.toThrow(BadRequestException);
      });

      it('should throw BadRequestException if month is already closed', async () => {
        groupMemberRepository.findOne.mockResolvedValue({
          id: 'membership-id',
          role: 'admin',
          joinStatus: 'active',
        } as any);

        groupRepository.findOne.mockResolvedValue({
          id: 'group-id',
          groupType: 'household',
          currency: 'USD',
        } as any);

        expenseRepository.count = jest.fn().mockResolvedValue(1);

        await expect(
          service.closeMonth('caller-id', 'group-id', '2026-06'),
        ).rejects.toThrow(BadRequestException);
      });

      it('should create system carry-forward expenses if carryForwardEnabled is true', async () => {
        groupMemberRepository.findOne.mockResolvedValue({
          id: 'membership-id',
          role: 'admin',
          user: { id: 'caller-id', displayName: 'Admin User' },
          joinStatus: 'active',
        } as any);

        groupRepository.findOne.mockResolvedValue({
          id: 'group-id',
          groupType: 'household',
          currency: 'USD',
          carryForwardEnabled: true,
        } as any);

        expenseRepository.count = jest.fn().mockResolvedValue(0);

        groupMemberRepository.find.mockResolvedValue([
          {
            id: 'member-a',
            user: {
              id: 'user-a',
              displayName: 'User A',
              email: 'a@finmate.com',
            },
            joinStatus: 'active',
          },
          {
            id: 'member-b',
            user: {
              id: 'user-b',
              displayName: 'User B',
              email: 'b@finmate.com',
            },
            joinStatus: 'active',
          },
        ] as any);

        expenseRepository.find.mockResolvedValue([
          {
            id: 'exp-1',
            amountTotal: 100,
            currency: 'USD',
            isCarryForward: false,
            paidByUser: { id: 'user-a', displayName: 'User A' },
            ownerUser: { id: 'user-a' },
          },
        ] as any);

        const result = await service.closeMonth(
          'caller-id',
          'group-id',
          '2026-06',
        );

        expect(result.nextLedgerMonth).toBe('2026-07');
        expect(result.carryForwardExpenseCount).toBe(1);
      });
    });
  });

  // ── Phase 2: Carry-Forward GroupMember ownership ────────────────────────────

  describe('Phase 2: Carry-Forward GroupMember ownership', () => {
    describe('getCarryForwardSummary', () => {
      it('includes a pending (Contact-backed) member as payer of a normal expense', async () => {
        groupMemberRepository.findOne.mockResolvedValue({
          id: 'membership-id',
          role: 'member',
          joinStatus: 'active',
        } as any);
        groupRepository.findOne.mockResolvedValue({
          id: 'group-id',
          groupType: 'household',
          currency: 'USD',
        } as any);

        const memberA = {
          id: 'member-a',
          user: { id: 'user-a', displayName: 'User A', email: 'a@finmate.com' },
          joinStatus: 'active',
        };
        const memberPending = {
          id: 'member-p',
          contact: { displayName: 'Pending Payer', email: 'p@finmate.com' },
          joinStatus: 'active',
        };
        groupMemberRepository.find.mockResolvedValue([
          memberA,
          memberPending,
        ] as any);

        expenseRepository.find.mockResolvedValue([
          {
            id: 'exp-1',
            amountTotal: 200,
            currency: 'USD',
            isCarryForward: false,
            paidByGroupMember: { id: 'member-p' },
            paidByUser: undefined,
          },
        ] as any);

        const balances = await service.getCarryForwardSummary(
          'caller-id',
          'group-id',
          '2026-06',
        );

        const pendingRow = balances.find((b) => b.groupMemberId === 'member-p');
        const registeredRow = balances.find(
          (b) => b.groupMemberId === 'member-a',
        );

        expect(pendingRow).toBeDefined();
        expect(pendingRow!.userId).toBeNull();
        expect(pendingRow!.displayName).toBe('Pending Payer');
        expect(pendingRow!.netBalance).toBe(100); // paid 200, owed 100 (50%)

        expect(registeredRow).toBeDefined();
        expect(registeredRow!.userId).toBe('user-a');
        expect(registeredRow!.netBalance).toBe(-100); // paid 0, owed 100
      });

      it('includes a pending (Contact-backed) member as participant of a carry-forward split', async () => {
        groupMemberRepository.findOne.mockResolvedValue({
          id: 'membership-id',
          role: 'member',
          joinStatus: 'active',
        } as any);
        groupRepository.findOne.mockResolvedValue({
          id: 'group-id',
          groupType: 'household',
          currency: 'USD',
        } as any);

        const memberA = {
          id: 'member-a',
          user: { id: 'user-a', displayName: 'User A', email: 'a@finmate.com' },
          joinStatus: 'active',
        };
        const memberPending = {
          id: 'member-p',
          contact: { displayName: 'Pending Debtor', email: 'p@finmate.com' },
          joinStatus: 'active',
        };
        groupMemberRepository.find.mockResolvedValue([
          memberA,
          memberPending,
        ] as any);

        // A carry-forward expense (from a prior month's rollover) paid by the
        // registered member, owed by the pending member.
        expenseRepository.find.mockResolvedValue([
          {
            id: 'cf-1',
            amountTotal: 50,
            currency: 'USD',
            isCarryForward: true,
            paidByUser: { id: 'user-a' },
            paidByGroupMember: undefined,
          },
        ] as any);
        splitRepository.find.mockResolvedValue([
          {
            id: 'cf-split-1',
            amountOwed: 50,
            participantGroupMember: { id: 'member-p' },
            participantUser: undefined,
          },
        ] as any);

        const balances = await service.getCarryForwardSummary(
          'caller-id',
          'group-id',
          '2026-06',
        );

        const pendingRow = balances.find((b) => b.groupMemberId === 'member-p');
        const registeredRow = balances.find(
          (b) => b.groupMemberId === 'member-a',
        );

        expect(pendingRow!.userId).toBeNull();
        expect(pendingRow!.netBalance).toBe(-50); // owes the carried-forward 50
        expect(registeredRow!.netBalance).toBe(50); // paid the carried-forward 50
      });

      it('reconciles totals for a mixed household (registered + pending members)', async () => {
        groupMemberRepository.findOne.mockResolvedValue({
          id: 'membership-id',
          role: 'member',
          joinStatus: 'active',
        } as any);
        groupRepository.findOne.mockResolvedValue({
          id: 'group-id',
          groupType: 'household',
          currency: 'USD',
        } as any);

        const memberA = {
          id: 'member-a',
          user: { id: 'user-a', displayName: 'User A', email: 'a@finmate.com' },
          joinStatus: 'active',
        };
        const memberPending = {
          id: 'member-p',
          contact: { displayName: 'Pending Member', email: 'p@finmate.com' },
          joinStatus: 'active',
        };
        groupMemberRepository.find.mockResolvedValue([
          memberA,
          memberPending,
        ] as any);

        expenseRepository.find.mockResolvedValue([
          {
            id: 'exp-1',
            amountTotal: 100,
            currency: 'USD',
            isCarryForward: false,
            paidByUser: { id: 'user-a' },
            paidByGroupMember: undefined,
          },
          {
            id: 'exp-2',
            amountTotal: 60,
            currency: 'USD',
            isCarryForward: false,
            paidByGroupMember: { id: 'member-p' },
            paidByUser: undefined,
          },
        ] as any);

        const balances = await service.getCarryForwardSummary(
          'caller-id',
          'group-id',
          '2026-06',
        );

        // Total paid across all rows must reconcile with S (100 + 60 = 160)
        const totalPaid = balances.reduce((sum, b) => sum + b.paid, 0);
        expect(totalPaid).toBe(160);
        // Net balances must sum to zero
        const totalNet = balances.reduce((sum, b) => sum + b.netBalance, 0);
        expect(Math.round(totalNet * 100) / 100).toBe(0);
      });

      it('historical compatibility: attributes a legacy paidByUser-only carry-forward expense via GroupMember fallback', async () => {
        groupMemberRepository.findOne.mockResolvedValue({
          id: 'membership-id',
          role: 'member',
          joinStatus: 'active',
        } as any);
        groupRepository.findOne.mockResolvedValue({
          id: 'group-id',
          groupType: 'household',
          currency: 'USD',
        } as any);

        const memberA = {
          id: 'member-a',
          user: { id: 'user-a', displayName: 'User A', email: 'a@finmate.com' },
          joinStatus: 'active',
        };
        const memberB = {
          id: 'member-b',
          user: { id: 'user-b', displayName: 'User B', email: 'b@finmate.com' },
          joinStatus: 'active',
        };
        groupMemberRepository.find.mockResolvedValue([memberA, memberB] as any);

        // Legacy row: written before GroupMember-payer support existed —
        // paidByGroupMember is absent entirely, only paidByUser is set.
        expenseRepository.find.mockResolvedValue([
          {
            id: 'legacy-cf-1',
            amountTotal: 30,
            currency: 'USD',
            isCarryForward: true,
            paidByUser: { id: 'user-a' },
          },
        ] as any);
        splitRepository.find.mockResolvedValue([
          {
            id: 'legacy-split-1',
            amountOwed: 30,
            participantUser: { id: 'user-b' },
          },
        ] as any);

        const balances = await service.getCarryForwardSummary(
          'caller-id',
          'group-id',
          '2026-06',
        );

        const rowA = balances.find((b) => b.groupMemberId === 'member-a');
        const rowB = balances.find((b) => b.groupMemberId === 'member-b');
        expect(rowA!.netBalance).toBe(30);
        expect(rowB!.netBalance).toBe(-30);

        // Breakdown decomposition: a pure carry-forward month has all of the
        // balance in the opening (carryForwardNet) and nothing in this month,
        // and opening + this-month must reconcile to netBalance.
        expect(rowA!.carryForwardNet).toBe(30);
        expect(rowA!.currentMonthNet).toBe(0);
        expect(rowB!.carryForwardNet).toBe(-30);
        expect(rowB!.currentMonthNet).toBe(0);
        for (const row of balances) {
          expect(row.carryForwardNet + row.currentMonthNet).toBeCloseTo(
            row.netBalance,
            2,
          );
        }
      });

      it("running balance: a prior month's net becomes this month's Opening, not This Month", async () => {
        // July: A pays 100 (50/50) → net A +50, B −50. August: no activity.
        // Viewing August, the ₹50 must appear as Opening (carried in), This
        // Month must be 0, and Overall must be the full-history +50 — never
        // counting the prior month as current activity. This is the exact bug
        // the user reported (Opening 0 / This Month = prior balance).
        groupMemberRepository.findOne.mockResolvedValue({
          id: 'membership-id',
          role: 'member',
          joinStatus: 'active',
        } as any);
        groupRepository.findOne.mockResolvedValue({
          id: 'group-id',
          groupType: 'household',
          currency: 'USD',
        } as any);

        const memberA = {
          id: 'member-a',
          user: { id: 'user-a', displayName: 'User A', email: 'a@finmate.com' },
          joinStatus: 'active',
        };
        const memberB = {
          id: 'member-b',
          user: { id: 'user-b', displayName: 'User B', email: 'b@finmate.com' },
          joinStatus: 'active',
        };
        groupMemberRepository.find.mockResolvedValue([memberA, memberB] as any);

        const allExpenses = [
          {
            id: 'jul-1',
            amountTotal: 100,
            currency: 'USD',
            isCarryForward: false,
            paidByUser: { id: 'user-a' },
            paidByGroupMember: undefined,
            ledgerMonth: '2026-07',
            expenseDate: '2026-07-15',
          },
        ];
        // The selected-month query filters by ledgerMonth; the running-balance
        // query fetches all months (no ledgerMonth). Honor both.
        expenseRepository.find.mockImplementation((opts: any) => {
          const lm = opts?.where?.ledgerMonth;
          return Promise.resolve(
            lm ? allExpenses.filter((e) => e.ledgerMonth === lm) : allExpenses,
          ) as any;
        });

        const balances = await service.getCarryForwardSummary(
          'user-a',
          'group-id',
          '2026-08',
        );
        const rowA = balances.find((b) => b.groupMemberId === 'member-a')!;
        const rowB = balances.find((b) => b.groupMemberId === 'member-b')!;

        // August itself is empty.
        expect(rowA.currentMonthNet).toBe(0);
        // July's balance is carried into August's Opening.
        expect(rowA.openingBalance).toBe(50);
        expect(rowA.closingBalance).toBe(50);
        // Overall is the full-history running balance, month-independent.
        expect(rowA.overallBalance).toBe(50);

        expect(rowB.currentMonthNet).toBe(0);
        expect(rowB.openingBalance).toBe(-50);
        expect(rowB.overallBalance).toBe(-50);

        // Identity holds for every member.
        for (const row of balances) {
          expect(row.openingBalance + row.currentMonthNet).toBeCloseTo(
            row.closingBalance,
            2,
          );
        }
      });

      it('getHouseholdScopeSummary aggregates the whole date range and puts pre-range months in Opening', async () => {
        // Jun: A pays 100 (50/50). Jul: A pays 60 (50/50). Viewing July only,
        // the period = July (A net +30), Opening = June carried in (A +50),
        // Closing = 80, Overall (full history) = 80.
        groupMemberRepository.findOne.mockResolvedValue({
          id: 'membership-id',
          role: 'member',
          joinStatus: 'active',
        } as any);
        groupRepository.findOne.mockResolvedValue({
          id: 'group-id',
          groupType: 'household',
          currency: 'USD',
        } as any);

        const memberA = {
          id: 'member-a',
          user: { id: 'user-a', displayName: 'User A', email: 'a@finmate.com' },
          joinStatus: 'active',
        };
        const memberB = {
          id: 'member-b',
          user: { id: 'user-b', displayName: 'User B', email: 'b@finmate.com' },
          joinStatus: 'active',
        };
        groupMemberRepository.find.mockResolvedValue([memberA, memberB] as any);

        expenseRepository.find.mockResolvedValue([
          {
            id: 'jun-1',
            amountTotal: 100,
            currency: 'USD',
            isCarryForward: false,
            paidByUser: { id: 'user-a' },
            ledgerMonth: '2026-06',
            expenseDate: '2026-06-15',
          },
          {
            id: 'jul-1',
            amountTotal: 60,
            currency: 'USD',
            isCarryForward: false,
            paidByUser: { id: 'user-a' },
            ledgerMonth: '2026-07',
            expenseDate: '2026-07-10',
          },
        ] as any);

        const rows = await service.getHouseholdScopeSummary(
          'user-a',
          'group-id',
          { from: '2026-07-01', to: '2026-07-31' },
        );
        const rowA = rows.find((r) => r.groupMemberId === 'member-a')!;

        expect(rowA.paid).toBe(60); // July only
        expect(rowA.expected).toBe(30); // 50% of July's 60
        expect(rowA.netBalance).toBe(30); // period net
        expect(rowA.openingBalance).toBe(50); // June carried in
        expect(rowA.closingBalance).toBe(80); // opening + period
        expect(rowA.overallBalance).toBe(80); // full history

        // Widening to Jun–Aug folds June into the period instead of Opening.
        const wide = await service.getHouseholdScopeSummary(
          'user-a',
          'group-id',
          { from: '2026-06-01', to: '2026-08-31' },
        );
        const wideA = wide.find((r) => r.groupMemberId === 'member-a')!;
        expect(wideA.paid).toBe(160);
        expect(wideA.netBalance).toBe(80);
        expect(wideA.openingBalance).toBe(0);
        expect(wideA.overallBalance).toBe(80);
      });

      it('registered-only household regression: behaves identically to before', async () => {
        groupMemberRepository.findOne.mockResolvedValue({
          id: 'membership-id',
          role: 'member',
          joinStatus: 'active',
        } as any);
        groupRepository.findOne.mockResolvedValue({
          id: 'group-id',
          groupType: 'household',
          currency: 'USD',
        } as any);

        groupMemberRepository.find.mockResolvedValue([
          {
            id: 'member-a',
            user: { id: 'user-a', displayName: 'User A' },
            joinStatus: 'active',
          },
          {
            id: 'member-b',
            user: { id: 'user-b', displayName: 'User B' },
            joinStatus: 'active',
          },
        ] as any);

        expenseRepository.find.mockResolvedValue([
          {
            id: 'exp-1',
            amountTotal: 150,
            currency: 'USD',
            paidByUser: { id: 'user-a', displayName: 'User A' },
            ownerUser: { id: 'user-a' },
          },
        ] as any);

        const balances = await service.getCarryForwardSummary(
          'caller-id',
          'group-id',
          '2026-06',
        );

        const userABal = balances.find((b) => b.userId === 'user-a');
        const userBBal = balances.find((b) => b.userId === 'user-b');

        expect(userABal?.netBalance).toBe(75);
        expect(userBBal?.netBalance).toBe(-75);
      });

      // Refund Scenario A: money returns to the original payer. Net spending and
      // the payer's net-paid both drop by the refund, so shares recompute off the
      // reduced spending. (Expense 200 → refund 80 to payer ⇒ net 120, 60 each.)
      it('treats a refund to the original payer as a negative expense', async () => {
        groupMemberRepository.findOne.mockResolvedValue({
          id: 'membership-id',
          role: 'member',
          joinStatus: 'active',
        } as any);
        groupRepository.findOne.mockResolvedValue({
          id: 'group-id',
          groupType: 'household',
          currency: 'USD',
        } as any);

        groupMemberRepository.find.mockResolvedValue([
          {
            id: 'member-a',
            user: { id: 'user-a', displayName: 'User A' },
            joinStatus: 'active',
          },
          {
            id: 'member-b',
            user: { id: 'user-b', displayName: 'User B' },
            joinStatus: 'active',
          },
        ] as any);

        expenseRepository.find.mockResolvedValue([
          {
            id: 'exp-1',
            amountTotal: 200,
            currency: 'USD',
            isCarryForward: false,
            transactionType: 'expense',
            paidByGroupMember: { id: 'member-a' },
            paidByUser: undefined,
          },
          {
            id: 'refund-1',
            amountTotal: 80,
            currency: 'USD',
            isCarryForward: false,
            transactionType: 'refund',
            paidByGroupMember: { id: 'member-a' },
            paidByUser: undefined,
          },
        ] as any);

        const balances = await service.getCarryForwardSummary(
          'caller-id',
          'group-id',
          '2026-06',
        );

        const rowA = balances.find((b) => b.groupMemberId === 'member-a');
        const rowB = balances.find((b) => b.groupMemberId === 'member-b');

        // Net spending 120 ⇒ each target 60. A paid net 120, B paid 0.
        expect(rowA!.paid).toBe(120);
        expect(rowA!.expected).toBe(60);
        expect(rowA!.netBalance).toBe(60);
        expect(rowB!.netBalance).toBe(-60);
      });

      // Refund Scenario B: money returns to a *different* member. Net spending
      // still drops by the refund; the recipient's net-paid goes negative so
      // they owe their share plus the credit they received.
      it('treats a refund to another member as a negative expense (credited to the recipient)', async () => {
        groupMemberRepository.findOne.mockResolvedValue({
          id: 'membership-id',
          role: 'member',
          joinStatus: 'active',
        } as any);
        groupRepository.findOne.mockResolvedValue({
          id: 'group-id',
          groupType: 'household',
          currency: 'USD',
        } as any);

        groupMemberRepository.find.mockResolvedValue([
          {
            id: 'member-a',
            user: { id: 'user-a', displayName: 'User A' },
            joinStatus: 'active',
          },
          {
            id: 'member-b',
            user: { id: 'user-b', displayName: 'User B' },
            joinStatus: 'active',
          },
        ] as any);

        expenseRepository.find.mockResolvedValue([
          {
            id: 'exp-1',
            amountTotal: 200,
            currency: 'USD',
            isCarryForward: false,
            transactionType: 'expense',
            paidByGroupMember: { id: 'member-a' },
            paidByUser: undefined,
          },
          {
            id: 'refund-1',
            amountTotal: 80,
            currency: 'USD',
            isCarryForward: false,
            transactionType: 'refund',
            paidByGroupMember: { id: 'member-b' },
            paidByUser: undefined,
          },
        ] as any);

        const balances = await service.getCarryForwardSummary(
          'caller-id',
          'group-id',
          '2026-06',
        );

        const rowA = balances.find((b) => b.groupMemberId === 'member-a');
        const rowB = balances.find((b) => b.groupMemberId === 'member-b');

        // Net spending 120 ⇒ each target 60. A paid 200, B paid -80 (credit).
        expect(rowA!.paid).toBe(200);
        expect(rowA!.netBalance).toBe(140);
        expect(rowB!.paid).toBe(-80);
        expect(rowB!.netBalance).toBe(-140);
        // Conservation: balances net to zero.
        const totalNet = balances.reduce((s, b) => s + b.netBalance, 0);
        expect(Math.round(totalNet * 100) / 100).toBe(0);
      });
    });

    describe('closeMonth', () => {
      it('creates a carry-forward Expense with paidByGroupMember when the creditor is a pending member', async () => {
        const callerMember = {
          id: 'membership-id',
          role: 'admin',
          user: { id: 'caller-id', displayName: 'Admin User' },
          joinStatus: 'active',
        };
        const memberRegistered = {
          id: 'member-debtor',
          user: { id: 'user-debtor', displayName: 'Debtor' },
          joinStatus: 'active',
        };
        const memberPendingCreditor = {
          id: 'member-creditor',
          contact: { displayName: 'Pending Creditor' },
          joinStatus: 'active',
        };
        // The caller-access lookup queries by (group, user, joinStatus); the
        // in-transaction debtor/creditor resolution queries by `id` — branch
        // on which shape of `where` is passed so each resolves correctly.
        groupMemberRepository.findOne.mockImplementation((opts: any) => {
          if (opts?.where?.id === memberRegistered.id)
            return Promise.resolve(memberRegistered as any);
          if (opts?.where?.id === memberPendingCreditor.id)
            return Promise.resolve(memberPendingCreditor as any);
          return Promise.resolve(callerMember as any);
        });

        groupRepository.findOne.mockResolvedValue({
          id: 'group-id',
          groupType: 'household',
          currency: 'USD',
          carryForwardEnabled: true,
        } as any);

        expenseRepository.count = jest.fn().mockResolvedValue(0);

        groupMemberRepository.find.mockResolvedValue([
          memberRegistered,
          memberPendingCreditor,
        ] as any);

        // Pending member paid 100; registered member paid 0 => registered owes pending 50.
        expenseRepository.find.mockResolvedValue([
          {
            id: 'exp-1',
            amountTotal: 100,
            currency: 'USD',
            isCarryForward: false,
            paidByGroupMember: { id: 'member-creditor' },
          },
        ] as any);

        const result = await service.closeMonth(
          'caller-id',
          'group-id',
          '2026-06',
        );

        expect(result.carryForwardExpenseCount).toBe(1);
        expect(entityManagerMock.create).toHaveBeenCalledWith(
          Expense,
          expect.objectContaining({
            paidByGroupMember: memberPendingCreditor,
            isCarryForward: true,
          }),
        );
        expect(entityManagerMock.create).toHaveBeenCalledWith(
          ExpenseSplit,
          expect.objectContaining({
            participantGroupMember: memberRegistered,
          }),
        );
      });

      it('creates a carry-forward ExpenseSplit with participantGroupMember when the debtor is a pending member', async () => {
        const callerMember = {
          id: 'membership-id',
          role: 'admin',
          user: { id: 'caller-id', displayName: 'Admin User' },
          joinStatus: 'active',
        };
        const memberPendingDebtor = {
          id: 'member-debtor',
          contact: { displayName: 'Pending Debtor' },
          joinStatus: 'active',
        };
        const memberRegisteredCreditor = {
          id: 'member-creditor',
          user: { id: 'user-creditor', displayName: 'Creditor' },
          joinStatus: 'active',
        };
        groupMemberRepository.findOne.mockImplementation((opts: any) => {
          if (opts?.where?.id === memberPendingDebtor.id)
            return Promise.resolve(memberPendingDebtor as any);
          if (opts?.where?.id === memberRegisteredCreditor.id)
            return Promise.resolve(memberRegisteredCreditor as any);
          return Promise.resolve(callerMember as any);
        });

        groupRepository.findOne.mockResolvedValue({
          id: 'group-id',
          groupType: 'household',
          currency: 'USD',
          carryForwardEnabled: true,
        } as any);

        expenseRepository.count = jest.fn().mockResolvedValue(0);

        groupMemberRepository.find.mockResolvedValue([
          memberPendingDebtor,
          memberRegisteredCreditor,
        ] as any);

        // Registered member paid 100; pending member paid 0 => pending owes registered 50.
        expenseRepository.find.mockResolvedValue([
          {
            id: 'exp-1',
            amountTotal: 100,
            currency: 'USD',
            isCarryForward: false,
            paidByGroupMember: { id: 'member-creditor' },
          },
        ] as any);

        const result = await service.closeMonth(
          'caller-id',
          'group-id',
          '2026-06',
        );

        expect(result.carryForwardExpenseCount).toBe(1);
        expect(entityManagerMock.create).toHaveBeenCalledWith(
          Expense,
          expect.objectContaining({
            paidByGroupMember: memberRegisteredCreditor,
          }),
        );
        expect(entityManagerMock.create).toHaveBeenCalledWith(
          ExpenseSplit,
          expect.objectContaining({
            participantGroupMember: memberPendingDebtor,
          }),
        );
      });
    });
  });

  // ── listMyExpenses ────────────────────────────────────────────────────────

  describe('listMyExpenses', () => {
    const makeQb = (rows: any[]) => ({
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      innerJoinAndSelect: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue(rows),
    });

    it('returns personal expenses with expenseType PERSONAL', async () => {
      const personalExp = {
        id: 'p-1',
        title: 'enc:Groceries',
        amountTotal: 200,
        category: 'Food & Drinks',
        expenseDate: '2026-07-01',
        currency: 'USD',
        status: 'posted',
        encryptionScope: 'personal',
        group: null,
        paidByUser: {
          id: 'user-1',
          displayName: 'Alice',
          email: 'alice@e.com',
        },
      };
      expenseRepository.createQueryBuilder = jest
        .fn()
        .mockReturnValue(makeQb([personalExp]));
      splitRepository.createQueryBuilder = jest
        .fn()
        .mockReturnValue(makeQb([]));

      const result = await service.listMyExpenses('user-1', 1, 20);

      expect(result.data).toHaveLength(1);
      expect((result.data[0] as any).expenseType).toBe('PERSONAL');
      expect((result.data[0] as any).myShare).toBe(200);
      expect((result.data[0] as any).groupId).toBeNull();
    });

    it('returns group shares with expenseType GROUP_SHARE and myShare = amountOwed', async () => {
      expenseRepository.createQueryBuilder = jest
        .fn()
        .mockReturnValue(makeQb([]));
      const groupExp = {
        id: 'g-1',
        title: 'enc:Dinner',
        amountTotal: 900,
        category: 'Food & Drinks',
        expenseDate: '2026-07-02',
        currency: 'USD',
        status: 'posted',
        encryptionScope: 'group',
        group: { id: 'grp-1', name: 'House' },
        paidByUser: { id: 'user-2', displayName: 'Bob', email: 'bob@e.com' },
      };
      const split = {
        id: 'sp-1',
        amountOwed: 300,
        isSettled: false,
        expense: groupExp,
      };
      splitRepository.createQueryBuilder = jest
        .fn()
        .mockReturnValue(makeQb([split]));

      const result = await service.listMyExpenses('user-1', 1, 20);

      expect(result.data).toHaveLength(1);
      expect((result.data[0] as any).expenseType).toBe('GROUP_SHARE');
      expect((result.data[0] as any).myShare).toBe(300);
      expect((result.data[0] as any).groupId).toBe('grp-1');
      expect((result.data[0] as any).groupName).toBe('House');
    });

    it('attributes a HOUSEHOLD expense to the payer at the FULL amount, not a split share', async () => {
      // Case 1: ₹1,000 electricity paid by Praveen in a 2-member household.
      // The equal-split rows (₹500 each) must be ignored for personal spending —
      // the payer's dashboard shows the full ₹1,000, non-payers show nothing.
      const householdExp = {
        id: 'hh-1',
        title: 'enc:Electricity',
        amountTotal: 1000,
        category: 'Utilities',
        expenseDate: '2026-08-01',
        currency: 'INR',
        status: 'posted',
        encryptionScope: 'group',
        group: { id: 'hh-grp', name: 'Home', groupType: 'household' },
        paidByUser: { id: 'user-1', displayName: 'Praveen', email: 'p@e.com' },
      };
      // 1st expenseRepo QB call = personal (none); 2nd = household-paid.
      expenseRepository.createQueryBuilder = jest
        .fn()
        .mockReturnValueOnce(makeQb([]))
        .mockReturnValueOnce(makeQb([householdExp]));
      // Household splits are excluded from the split branch (SQL filter).
      splitRepository.createQueryBuilder = jest
        .fn()
        .mockReturnValue(makeQb([]));

      const result = await service.listMyExpenses('user-1', 1, 20);

      expect(result.data).toHaveLength(1);
      const item = result.data[0] as any;
      expect(item.expenseType).toBe('GROUP_SHARE');
      expect(item.myShare).toBe(1000); // full paid — NOT 500
      expect(item.amountTotal).toBe(1000);
      expect(item.groupId).toBe('hh-grp');
      expect(item.paidByUserId).toBe('user-1');
    });

    it('shows nothing on a household non-payer dashboard (no split share leaks in)', async () => {
      // Naveen did not pay: household-paid query (payer-filtered) returns none,
      // and the split branch excludes household — so his dashboard shows ₹0.
      expenseRepository.createQueryBuilder = jest
        .fn()
        .mockReturnValueOnce(makeQb([])) // personal
        .mockReturnValueOnce(makeQb([])); // household-paid (he isn't the payer)
      splitRepository.createQueryBuilder = jest
        .fn()
        .mockReturnValue(makeQb([]));

      const result = await service.listMyExpenses('user-2', 1, 20);

      expect(result.data).toHaveLength(0);
    });

    it('resolves the payer display for a GROUP_SHARE item via paidByGroupMember — the shape every new group expense uses (frozen group-ledger identity rule)', async () => {
      expenseRepository.createQueryBuilder = jest
        .fn()
        .mockReturnValue(makeQb([]));
      const groupExp = {
        id: 'g-2',
        title: 'enc:Taxi',
        amountTotal: 400,
        category: 'Travel',
        expenseDate: '2026-07-03',
        currency: 'USD',
        status: 'posted',
        encryptionScope: 'group',
        group: { id: 'grp-1', name: 'House' },
        paidByUser: undefined,
        paidByGroupMember: {
          id: 'member-bob',
          user: { id: 'user-2', displayName: 'Bob', email: 'bob@e.com' },
        },
      };
      const split = {
        id: 'sp-2',
        amountOwed: 200,
        isSettled: false,
        expense: groupExp,
      };
      splitRepository.createQueryBuilder = jest
        .fn()
        .mockReturnValue(makeQb([split]));

      const result = await service.listMyExpenses('user-1', 1, 20);

      expect((result.data[0] as any).paidByUserId).toBe('user-2');
      expect((result.data[0] as any).paidByGroupMemberId).toBe('member-bob');
      expect((result.data[0] as any).paidByDisplayName).toBe('Bob');
    });

    it('does not duplicate an expense that appears as both personal and a split', async () => {
      const exp = {
        id: 'shared-1',
        title: 'enc:Shared',
        amountTotal: 100,
        category: 'Food & Drinks',
        expenseDate: '2026-07-01',
        currency: 'USD',
        status: 'posted',
        encryptionScope: 'personal',
        group: null,
        paidByUser: {
          id: 'user-1',
          displayName: 'Alice',
          email: 'alice@e.com',
        },
      };
      expenseRepository.createQueryBuilder = jest
        .fn()
        .mockReturnValue(makeQb([exp]));
      // Same expense also shows up in splits
      const split = {
        id: 'sp-x',
        amountOwed: 50,
        isSettled: false,
        expense: exp,
      };
      splitRepository.createQueryBuilder = jest
        .fn()
        .mockReturnValue(makeQb([split]));

      const result = await service.listMyExpenses('user-1', 1, 20);

      // Only one item — the personal record wins (seen set)
      expect(result.data).toHaveLength(1);
      expect((result.data[0] as any).expenseType).toBe('PERSONAL');
    });

    it('returns only non-participants excluded — returns empty for non-participant', async () => {
      expenseRepository.createQueryBuilder = jest
        .fn()
        .mockReturnValue(makeQb([]));
      splitRepository.createQueryBuilder = jest
        .fn()
        .mockReturnValue(makeQb([]));

      const result = await service.listMyExpenses('non-member', 1, 20);

      expect(result.data).toHaveLength(0);
      expect(result.meta.totalItems).toBe(0);
    });

    it('paginates correctly', async () => {
      const exps = Array.from({ length: 5 }, (_, i) => ({
        id: `p-${i}`,
        amountTotal: 10 * (i + 1),
        category: 'Other',
        expenseDate: `2026-07-0${i + 1}`,
        currency: 'USD',
        status: 'posted',
        encryptionScope: 'personal',
        group: null,
        paidByUser: { id: 'user-1' },
      }));
      expenseRepository.createQueryBuilder = jest
        .fn()
        .mockReturnValue(makeQb(exps));
      splitRepository.createQueryBuilder = jest
        .fn()
        .mockReturnValue(makeQb([]));

      const page1 = await service.listMyExpenses('user-1', 1, 3);
      const page2 = await service.listMyExpenses('user-1', 2, 3);

      expect(page1.data).toHaveLength(3);
      expect(page2.data).toHaveLength(2);
      expect(page1.meta.totalItems).toBe(5);
    });

    // Regression guard: TypeORM only rewrites raw QueryBuilder condition
    // strings when the token is an exact relation propertyPath
    // (`participantUser`) or exact physical column name
    // (`participant_user_id`) — `participantUserId` matches neither and is
    // left as unresolved literal SQL, which Postgres rejects with
    // "column split.participantuserid does not exist" on every call. Mocked
    // `where`/`andWhere` can't detect that by itself (they never parse the
    // string), so this test pins down the exact condition text passed in.
    // See expenses-split-query-mapping.spec.ts for the real-SQL-generation
    // check that would have caught the malformed identifier directly.
    it('filters group splits using the participantUser relation, not a participantUserId shorthand', async () => {
      const qb = makeQb([]);
      expenseRepository.createQueryBuilder = jest
        .fn()
        .mockReturnValue(makeQb([]));
      splitRepository.createQueryBuilder = jest.fn().mockReturnValue(qb);

      await service.listMyExpenses('user-1', 1, 20);

      const conditionArgs = qb.andWhere.mock.calls.map((call) => call[0]);
      expect(
        conditionArgs.some((condition: string) =>
          condition.includes('split.participantUser ='),
        ),
      ).toBe(true);
      expect(
        conditionArgs.some((condition: string) =>
          condition.includes('participantUserId'),
        ),
      ).toBe(false);
    });
  });

  // ── getCombinedMonthlyAnalytics ──────────────────────────────────────────

  describe('getCombinedMonthlyAnalytics', () => {
    const makeQb = (rows: any[]) => ({
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      innerJoinAndSelect: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue(rows),
    });

    it('includes the user share (amountOwed) of group expenses in the monthly category totals', async () => {
      // No 100%-personal expenses paid by the user this month.
      expenseRepository.createQueryBuilder = jest
        .fn()
        .mockReturnValue(makeQb([]));

      const groupExpense = {
        id: 'g-1',
        category: 'Food & Drinks',
        currency: 'USD',
        expenseDate: '2026-07-10',
        ledgerMonth: null,
      };
      const groupShareSplit = {
        id: 'sp-1',
        amountOwed: 500,
        expense: groupExpense,
      };

      // First call (inside the personal-expense branch) looks up splits for
      // the user's own paid personal expenses via `.find`; second, the
      // query-builder call, returns the splits where the user participates.
      splitRepository.find = jest.fn().mockResolvedValue([]);
      splitRepository.createQueryBuilder = jest
        .fn()
        .mockReturnValue(makeQb([groupShareSplit]));

      const result = await service.getCombinedMonthlyAnalytics(
        'user-1',
        '2026-07',
      );

      expect(result).toEqual([
        { category: 'Food & Drinks', amount: 500, currency: 'USD' },
      ]);
    });

    it('filters participant splits using the participantUser relation, not a participantUserId shorthand', async () => {
      expenseRepository.createQueryBuilder = jest
        .fn()
        .mockReturnValue(makeQb([]));
      splitRepository.find = jest.fn().mockResolvedValue([]);
      const qb = makeQb([]);
      splitRepository.createQueryBuilder = jest.fn().mockReturnValue(qb);

      await service.getCombinedMonthlyAnalytics('user-1', '2026-07');

      const conditionArgs = qb.andWhere.mock.calls.map((call) => call[0]);
      expect(
        conditionArgs.some((condition: string) =>
          condition.includes('split.participantUser ='),
        ),
      ).toBe(true);
      expect(
        conditionArgs.some((condition: string) =>
          condition.includes('participantUserId'),
        ),
      ).toBe(false);
    });

    it('counts a household expense at the full amount the user paid, not a split share', async () => {
      const householdExp = {
        id: 'hh-1',
        category: 'Utilities',
        currency: 'INR',
        expenseDate: '2026-08-01',
        ledgerMonth: '2026-08',
        amountTotal: 1000,
        transactionType: 'expense',
      };
      // 1st expenseRepo QB call = personal paid; 2nd = household-paid.
      expenseRepository.createQueryBuilder = jest
        .fn()
        .mockReturnValueOnce(makeQb([]))
        .mockReturnValueOnce(makeQb([householdExp]));
      splitRepository.find = jest.fn().mockResolvedValue([]);
      // Household split shares are excluded from the split branch.
      splitRepository.createQueryBuilder = jest
        .fn()
        .mockReturnValue(makeQb([]));

      const result = await service.getCombinedMonthlyAnalytics(
        'user-1',
        '2026-08',
      );

      expect(result).toEqual([
        { category: 'Utilities', amount: 1000, currency: 'INR' },
      ]);
    });

    it('nets a household refund against the payer contribution (Case 4)', async () => {
      const exp = {
        id: 'hh-e',
        category: 'Utilities',
        currency: 'INR',
        expenseDate: '2026-08-01',
        ledgerMonth: '2026-08',
        amountTotal: 1000,
        transactionType: 'expense',
      };
      const refund = {
        id: 'hh-r',
        category: 'Utilities',
        currency: 'INR',
        expenseDate: '2026-08-05',
        ledgerMonth: '2026-08',
        amountTotal: 400,
        transactionType: 'refund',
      };
      expenseRepository.createQueryBuilder = jest
        .fn()
        .mockReturnValueOnce(makeQb([]))
        .mockReturnValueOnce(makeQb([exp, refund]));
      splitRepository.find = jest.fn().mockResolvedValue([]);
      splitRepository.createQueryBuilder = jest
        .fn()
        .mockReturnValue(makeQb([]));

      const result = await service.getCombinedMonthlyAnalytics(
        'user-1',
        '2026-08',
      );

      // 1000 paid − 400 refunded = 600 net contribution.
      expect(result).toEqual([
        { category: 'Utilities', amount: 600, currency: 'INR' },
      ]);
    });
  });

  // ── TAG-BATCH-A — confirmed expense tag persistence ──────────────────────────
  describe('confirmed expense tag persistence (TAG-BATCH-A)', () => {
    const groupMember = {
      id: 'membership-id',
      role: 'member',
      joinStatus: 'active',
      user: { id: 'caller-id' },
    } as any;

    const baseGroupDto = {
      title: 'cipher:title',
      amountTotal: 100,
      currency: 'USD',
      category: 'Food',
      paidByUserId: 'caller-id',
      groupId: 'group-id',
      expenseDate: '2026-07-10',
      groupKeyVersionId: 'v1-id',
      splits: [
        { participantUserId: 'caller-id', splitType: 'equal', shareValue: 1 },
      ],
    };

    /** Prime the proven group create happy-path (mirrors the G-ROT create test). */
    const primeHappyPath = () => {
      userRepository.findOne.mockResolvedValue({ id: 'caller-id' } as any);
      groupMemberRepository.findOne.mockResolvedValue(groupMember);
      groupMemberRepository.find.mockResolvedValue([groupMember]);
      groupRepository.findOne.mockResolvedValue({
        id: 'group-id',
        currency: 'USD',
        isArchived: false,
      } as any);
      groupKeyVersionRepository.findOne.mockResolvedValue({
        id: 'v1-id',
        version: 1,
        status: 'ACTIVE',
      } as any);
      expenseRepository.save.mockImplementation(async (data: any) => ({
        ...data,
        id: 'exp-1',
      }));
      expenseRepository.findOne.mockResolvedValue({
        id: 'exp-1',
        title: 'cipher:title',
        amountTotal: 100,
        currency: 'USD',
        category: 'Food',
        expenseDate: '2026-07-10',
        status: 'posted',
        encryptionScope: 'group',
        isCarryForward: false,
        paidByGroupMember: { id: 'membership-id', user: { id: 'caller-id' } },
        ownerUser: { id: 'caller-id' },
        group: { id: 'group-id' },
        groupKeyVersion: { id: 'v1-id', version: 1 },
      } as any);
      splitRepository.find.mockResolvedValue([]);
      attachmentRepository.find.mockResolvedValue([]);
    };

    it('persists NO tag when the payload has none (total-only / manual create)', async () => {
      primeHappyPath();
      await service.createExpense('caller-id', { ...baseGroupDto } as any);
      expect(expenseTagRepositoryMock.save).not.toHaveBeenCalled();
    });

    it('persists confirmed tags with materialized ancestors and provenance', async () => {
      primeHappyPath();
      await service.createExpense('caller-id', {
        ...baseGroupDto,
        tags: [
          { tagId: 'milk', authority: 'USER_CONFIRMED', source: 'user', confidence: 0.9 },
        ],
      } as any);

      expect(expenseTagRepositoryMock.save).toHaveBeenCalledTimes(1);
      const savedRows = expenseTagRepositoryMock.save.mock.calls[0][0] as any[];
      const byId = new Map(savedRows.map((r) => [r.tagId, r]));
      // milk → dairy → grocery → food all persisted (queryable at every level).
      expect([...byId.keys()].sort()).toEqual(['dairy', 'food', 'grocery', 'milk']);
      expect(byId.get('milk')).toMatchObject({
        authority: 'USER_CONFIRMED',
        source: 'user',
        confidence: 0.9,
        taxonomyVersion: 1,
        createdByUser: { id: 'caller-id' },
        expense: expect.objectContaining({ id: 'exp-1' }),
      });
      // Derived ancestors are INFERRED/rule_based.
      expect(byId.get('food')).toMatchObject({ authority: 'INFERRED', source: 'rule_based' });
    });

    it('keeps USER_CONFIRMED over a later inferred ancestor (no silent downgrade)', async () => {
      primeHappyPath();
      await service.createExpense('caller-id', {
        ...baseGroupDto,
        tags: [
          { tagId: 'grocery', authority: 'USER_CONFIRMED', source: 'user' },
          { tagId: 'milk', authority: 'INFERRED', source: 'rule_based' },
        ],
      } as any);
      const savedRows = expenseTagRepositoryMock.save.mock.calls[0][0] as any[];
      const grocery = savedRows.find((r) => r.tagId === 'grocery');
      expect(grocery.authority).toBe('USER_CONFIRMED');
    });

    it('drops deprecated/unknown tags and persists nothing when none are valid', async () => {
      primeHappyPath();
      await service.createExpense('caller-id', {
        ...baseGroupDto,
        tags: [
          { tagId: 'misc', authority: 'USER_CONFIRMED' },
          { tagId: 'does-not-exist', authority: 'INFERRED' },
        ],
      } as any);
      expect(expenseTagRepositoryMock.save).not.toHaveBeenCalled();
    });

    it('never lets tags alter the expense financial fields', async () => {
      primeHappyPath();
      await service.createExpense('caller-id', {
        ...baseGroupDto,
        tags: [{ tagId: 'milk', authority: 'INFERRED' }],
      } as any);
      const createdExpense = (expenseRepository.create as jest.Mock).mock.calls[0][0];
      expect(createdExpense).toEqual(
        expect.objectContaining({ amountTotal: 100, currency: 'USD' }),
      );
      expect(createdExpense).not.toHaveProperty('tags');
      expect(createdExpense).not.toHaveProperty('tagId');
    });

    it('attaches tags only to the caller-owned expense (no cross-user assignment)', async () => {
      primeHappyPath();
      await service.createExpense('caller-id', {
        ...baseGroupDto,
        tags: [{ tagId: 'milk', authority: 'INFERRED' }],
      } as any);
      const createdExpense = (expenseRepository.create as jest.Mock).mock.calls[0][0];
      expect(createdExpense.ownerUser).toEqual({ id: 'caller-id' });
      const savedRows = expenseTagRepositoryMock.save.mock.calls[0][0] as any[];
      expect(savedRows.every((r) => r.createdByUser?.id === 'caller-id')).toBe(true);
      expect(savedRows.every((r) => r.expense?.id === 'exp-1')).toBe(true);
    });

    it('does not create tag assignments on an ordinary edit', async () => {
      const expense = {
        id: 'exp-1',
        version: 1,
        title: 'cipher:old',
        description: null,
        amountTotal: 100,
        currency: 'USD',
        category: 'Food',
        expenseDate: '2026-07-10',
        status: 'posted',
        encryptionScope: 'group',
        isCarryForward: false,
        paidByUser: { id: 'caller-id' },
        ownerUser: { id: 'caller-id' },
        group: { id: 'group-id' },
        groupKeyVersion: { id: 'v1-id', version: 1 },
      } as any;
      expenseRepository.findOne.mockResolvedValue(expense);
      userRepository.findOne.mockResolvedValue({ id: 'caller-id' } as any);
      groupMemberRepository.findOne.mockResolvedValue(groupMember);
      groupRepository.findOne.mockResolvedValue({
        id: 'group-id',
        currency: 'USD',
        isArchived: false,
      } as any);
      splitRepository.find.mockResolvedValue([]);
      attachmentRepository.find.mockResolvedValue([]);
      groupKeyVersionRepository.findOne.mockResolvedValue({
        id: 'v1-id',
        version: 1,
        status: 'ACTIVE',
      } as any);

      await service.updateExpense('caller-id', 'exp-1', {
        version: 1,
        title: 'cipher:new',
      } as any);

      expect(expenseTagRepositoryMock.save).not.toHaveBeenCalled();
    });
  });
});
