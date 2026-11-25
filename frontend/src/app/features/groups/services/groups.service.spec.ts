import { TestBed } from '@angular/core/testing';
import {
  HttpClientTestingModule,
  HttpTestingController,
} from '@angular/common/http/testing';
import { GroupsService } from './groups.service';
import { Store } from '@ngxs/store';
import { ClientEncryptionService } from '../../../core/services/encryption.service';
import { GroupKeyService } from '../../../core/services/group-key.service';
import { ExpenseDecryptionService } from '../../../core/services/expense-decryption.service';

describe('GroupsService', () => {
  let service: GroupsService;
  let httpMock: HttpTestingController;
  let encryptionServiceSpy: any;
  let groupKeyServiceSpy: any;
  let storeMock: any;

  beforeEach(() => {
    encryptionServiceSpy = {
      decrypt: jest
        .fn()
        .mockImplementation((val) => Promise.resolve(`decrypted:${val}`)),
    };
    groupKeyServiceSpy = {
      getGroupDataKey: jest.fn().mockResolvedValue('mock-group-key'),
    };
    storeMock = {
      selectSnapshot: jest
        .fn()
        .mockReturnValue({ email: 'test@finmate.local', userId: 'user-1' }),
    };

    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        GroupsService,
        { provide: ClientEncryptionService, useValue: encryptionServiceSpy },
        { provide: GroupKeyService, useValue: groupKeyServiceSpy },
        { provide: Store, useValue: storeMock },
        {
          provide: ExpenseDecryptionService,
          useValue: {
            decryptExpenses: jest
              .fn()
              .mockImplementation((expenses) => Promise.resolve(expenses)),
            decryptExpense: jest
              .fn()
              .mockImplementation((expense) => Promise.resolve(expense)),
          },
        },
      ],
    });

    service = TestBed.inject(GroupsService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  // --- GET endpoints ---
  describe('getGroups', () => {
    it('should fetch all groups', (done) => {
      service.getGroups().subscribe((res) => {
        expect(res).toBeDefined();
        done();
      });

      const req = httpMock.expectOne('/api/v1/groups');
      expect(req.request.method).toBe('GET');
      req.flush({ data: [], meta: { totalItems: 0 } });
    });
  });

  describe('getGroup', () => {
    it('should fetch a single group by ID', (done) => {
      service.getGroup('group-1').subscribe((group) => {
        expect(group.id).toBe('group-1');
        done();
      });

      const req = httpMock.expectOne('/api/v1/groups/group-1');
      expect(req.request.method).toBe('GET');
      req.flush({ id: 'group-1', name: 'Test Group' });
    });
  });

  describe('getMembers', () => {
    it('should fetch members of a group', (done) => {
      service.getMembers('group-1').subscribe((members) => {
        expect(members).toHaveLength(1);
        done();
      });

      const req = httpMock.expectOne('/api/v1/groups/group-1/members');
      expect(req.request.method).toBe('GET');
      req.flush([{ id: 'member-1', role: 'owner' }]);
    });
  });

  describe('getBalances', () => {
    it('should fetch settlements and balances', (done) => {
      service.getBalances('group-1').subscribe((res) => {
        expect(res).toBeDefined();
        done();
      });

      const req = httpMock.expectOne(
        '/api/v1/groups/group-1/settlements/balances',
      );
      expect(req.request.method).toBe('GET');
      req.flush({ balances: [], suggestedSettlements: [] });
    });
  });

  describe('getHistoryLogs', () => {
    it('should fetch and decrypt audit logs', (done) => {
      const mockLogs = {
        data: [
          {
            id: 'log-1',
            action: 'expense.created',
            metadata: {
              title: 'enc-title',
              newTitle: 'enc-new-title',
              previousTitle: 'enc-prev-title',
            },
          },
        ],
      };

      service.getHistoryLogs('group-1').subscribe((res) => {
        expect(res.data[0].metadata.title).toBe('decrypted:enc-title');
        expect(res.data[0].metadata.newTitle).toBe('decrypted:enc-new-title');
        expect(res.data[0].metadata.previousTitle).toBe(
          'decrypted:enc-prev-title',
        );
        done();
      });

      const req = httpMock.expectOne(
        (r) => r.url === '/api/v1/groups/group-1/history',
      );
      expect(req.request.method).toBe('GET');
      // Paginated by default (page 1, limit 20) for infinite scroll.
      expect(req.request.params.get('page')).toBe('1');
      expect(req.request.params.get('limit')).toBe('20');
      req.flush(mockLogs);
    });

    it('passes an explicit page for infinite scroll', (done) => {
      service.getHistoryLogs('group-1', 3).subscribe(() => done());

      const req = httpMock.expectOne(
        (r) => r.url === '/api/v1/groups/group-1/history',
      );
      expect(req.request.params.get('page')).toBe('3');
      req.flush({ data: [] });
    });
  });

  describe('getDeletedExpenses', () => {
    it('should fetch soft-deleted expenses', (done) => {
      service.getDeletedExpenses('group-1').subscribe((res) => {
        expect(res.data).toEqual([]);
        done();
      });

      const req = httpMock.expectOne('/api/v1/groups/group-1/expenses/deleted');
      expect(req.request.method).toBe('GET');
      req.flush({ data: [] });
    });
  });

  describe('getCarryForward', () => {
    it('should fetch carry-forward balances for the filtered date range', (done) => {
      service
        .getCarryForward('group-1', { from: '2026-06-01', to: '2026-08-31' })
        .subscribe((res) => {
          expect(res).toEqual([]);
          done();
        });

      const req = httpMock.expectOne(
        '/api/v1/groups/group-1/carry-forward?from=2026-06-01&to=2026-08-31',
      );
      expect(req.request.method).toBe('GET');
      req.flush([]);
    });
  });

  describe('getContributions', () => {
    it('should fetch contribution percentages for a month', (done) => {
      service.getContributions('group-1', '2026-06').subscribe((res) => {
        expect(res).toBeDefined();
        done();
      });

      const req = httpMock.expectOne(
        '/api/v1/groups/group-1/contributions?month=2026-06',
      );
      expect(req.request.method).toBe('GET');
      req.flush([]);
    });
  });

  describe('getInviteDetails', () => {
    it('should fetch invite metadata by token', (done) => {
      service.getInviteDetails('token-abc').subscribe((res) => {
        expect(res).toBeDefined();
        done();
      });

      const req = httpMock.expectOne('/api/v1/invite-links/token-abc');
      expect(req.request.method).toBe('GET');
      req.flush({ groupName: 'Test' });
    });
  });

  describe('getPendingInvitations', () => {
    it('should fetch pending invitations for current user', (done) => {
      service.getPendingInvitations().subscribe((res) => {
        expect(res).toEqual([]);
        done();
      });

      const req = httpMock.expectOne('/api/v1/groups/invitations/pending');
      expect(req.request.method).toBe('GET');
      req.flush([]);
    });
  });

  // --- POST endpoints ---
  describe('createGroup', () => {
    it('should create a new group', (done) => {
      const groupData = { name: 'New Group', groupType: 'default' as const };

      service.createGroup(groupData).subscribe((group) => {
        expect(group.name).toBe('New Group');
        done();
      });

      const req = httpMock.expectOne('/api/v1/groups');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(groupData);
      req.flush({ id: 'g-new', name: 'New Group' });
    });
  });

  describe('regenerateInviteToken', () => {
    it('should regenerate invite token via POST', (done) => {
      service.regenerateInviteToken('group-1').subscribe(() => done());

      const req = httpMock.expectOne(
        '/api/v1/groups/group-1/invite-link/regenerate',
      );
      expect(req.request.method).toBe('POST');
      req.flush({ id: 'group-1' });
    });
  });

  describe('joinGroup', () => {
    it('should join a group via invite token', (done) => {
      service.joinGroup('invite-token-123').subscribe(() => done());

      const req = httpMock.expectOne('/api/v1/groups/join/invite-token-123');
      expect(req.request.method).toBe('POST');
      req.flush({ id: 'member-new' });
    });
  });

  describe('inviteMember', () => {
    it('should invite a member to a group', (done) => {
      const payload = { email: 'new@member.com', role: 'member' };

      service.inviteMember('group-1', payload).subscribe(() => done());

      const req = httpMock.expectOne('/api/v1/groups/group-1/members');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(payload);
      req.flush({ id: 'member-new' });
    });
  });

  describe('updateContributions', () => {
    it('should save contribution percentages', (done) => {
      const payload = { month: '2026-06', contributions: [] };

      service
        .updateContributions('group-1', payload as any)
        .subscribe(() => done());

      const req = httpMock.expectOne('/api/v1/groups/group-1/contributions');
      expect(req.request.method).toBe('POST');
      req.flush([]);
    });
  });

  describe('closeMonth', () => {
    it('should close a ledger month', (done) => {
      service.closeMonth('group-1', '2026-06').subscribe((res) => {
        expect(res.nextLedgerMonth).toBe('2026-07');
        done();
      });

      const req = httpMock.expectOne('/api/v1/groups/group-1/close-month');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ ledgerMonth: '2026-06' });
      req.flush({ nextLedgerMonth: '2026-07', carryForwardExpenseCount: 2 });
    });
  });

  // --- PATCH endpoints ---
  describe('updateGroup', () => {
    it('should update a group', (done) => {
      const groupData = { name: 'Updated Name' };

      service.updateGroup('group-1', groupData as any).subscribe(() => done());

      const req = httpMock.expectOne('/api/v1/groups/group-1');
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual(groupData);
      req.flush({ id: 'group-1', name: 'Updated Name' });
    });
  });

  describe('updateMember', () => {
    it('should update a member role', (done) => {
      const payload = { role: 'admin' };

      service
        .updateMember('group-1', 'member-1', payload)
        .subscribe(() => done());

      const req = httpMock.expectOne('/api/v1/groups/group-1/members/member-1');
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual(payload);
      req.flush({ id: 'member-1', role: 'admin' });
    });
  });

  // --- DELETE endpoints ---
  describe('removeMember', () => {
    it('should remove a member from a group', (done) => {
      service.removeMember('group-1', 'member-1').subscribe(() => done());

      const req = httpMock.expectOne('/api/v1/groups/group-1/members/member-1');
      expect(req.request.method).toBe('DELETE');
      req.flush(null);
    });
  });
});
