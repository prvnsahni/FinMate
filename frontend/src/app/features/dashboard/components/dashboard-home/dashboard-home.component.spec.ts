import { NGXS_OPTIONS, Store } from '@ngxs/store';
import { ZK_DB_NAME } from '../../../../core/services/zk-key-vault.service';
import { ZkKeyVaultService } from '../../../../core/services/zk-key-vault.service';

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DashboardHomeComponent } from './dashboard-home.component';
import { NO_ERRORS_SCHEMA } from '@angular/core';

describe('DashboardHomeComponent', () => {
  let component: DashboardHomeComponent;
  let fixture: ComponentFixture<DashboardHomeComponent>;

  const mockProfile = {
    monthlyIncome: 5000,
    monthlyBudget: 2000,
    defaultCurrency: 'USD',
  };

  const mockExpenses = [
    {
      id: 'exp-1',
      title: 'Groceries',
      amountTotal: 150,
      category: 'Food & Drinks',
      expenseDate: new Date(),
    },
  ];

  const mockInvitations = [
    { membershipId: 'invite-1', name: 'Household Group', ownerName: 'Alice' },
  ];

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: Store,
          useValue: {
            selectSnapshot: jest
              .fn()
              .mockReturnValue({ email: 'test@example.com' }),
          },
        },
        { provide: NGXS_OPTIONS, useValue: {} },
        {
          provide: ZK_DB_NAME,
          useValue: 'finmate_zk_vault_test_' + Math.random(),
        },
        ZkKeyVaultService,
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(DashboardHomeComponent);
    component = fixture.componentInstance;

    // Set default input values
    component.userName = 'John';
    component.totalBalance = 150;
    component.monthlyExpenses = 150;
    component.activeGroupsCount = 1;
    component.personalExpenses = mockExpenses;
    component.pendingInvitations = mockInvitations;
    component.userProfile = mockProfile;
    component.incomePercentage = 3;
    component.budgetPercentage = 8;
  });

  it('should create', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('should display the greeting and username', () => {
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain(
      'Welcome back, John',
    );
  });

  it('should emit openExpenseModalEvent on log expense click', () => {
    fixture.detectChanges();
    const emitSpy = jest.spyOn(component.openExpenseModalEvent, 'emit');

    const logExpenseBtn = Array.from(
      fixture.nativeElement.querySelectorAll('button'),
    ).find((btn) =>
      (btn as HTMLButtonElement).textContent?.includes('Log Expense'),
    ) as HTMLButtonElement;
    logExpenseBtn.click();

    expect(emitSpy).toHaveBeenCalledWith({});
  });

  it('should emit acceptInvitationEvent on accept click', () => {
    fixture.detectChanges();
    const emitSpy = jest.spyOn(component.acceptInvitationEvent, 'emit');

    // Find the accept button specifically by text
    const acceptBtn = Array.from(
      fixture.nativeElement.querySelectorAll('button'),
    ).find(
      (btn) => (btn as HTMLButtonElement).textContent?.trim() === 'Accept',
    ) as HTMLButtonElement;
    expect(acceptBtn).toBeTruthy();
    expect(acceptBtn.textContent?.trim()).toBe('Accept');

    acceptBtn.click();
    expect(emitSpy).toHaveBeenCalledWith(mockInvitations[0]);
  });

  describe('tag chips (TAG-BATCH-B2)', () => {
    beforeEach(() => {
      component.tagNameMap = new Map([
        ['milk', 'Milk'],
        ['grocery', 'Grocery'],
        ['dairy', 'Dairy'],
        ['food', 'Food'],
        ['fuel', 'Fuel'],
      ]);
    });

    it('resolves chips, drops unknown/deprecated ids, sorts user-authored first', () => {
      const expense = {
        id: 'e1',
        tags: [
          { tagId: 'grocery', authority: 'INFERRED', source: 'rule_based' },
          { tagId: 'milk', authority: 'USER_CONFIRMED', source: 'user' },
          { tagId: 'zzz-unknown', authority: 'INFERRED', source: 'rule_based' },
        ],
      };
      const chips = component.rowTagChips(expense);
      expect(chips.map((c) => c.label)).toEqual(['Milk', 'Grocery']);
      expect(chips.find((c) => c.tagId === 'milk')?.inferred).toBe(false);
      expect(chips.find((c) => c.tagId === 'grocery')?.inferred).toBe(true);
    });

    it('renders safely for expenses with no tags', () => {
      expect(component.rowTagChips({ id: 'e' })).toEqual([]);
      expect(component.rowTagOverflowCount({ id: 'e', tags: [] })).toBe(0);
    });

    it('caps visible chips and reports the overflow count', () => {
      const expense = {
        id: 'e1',
        tags: [
          { tagId: 'milk', authority: 'USER_CONFIRMED', source: 'user' },
          { tagId: 'dairy', authority: 'INFERRED', source: 'rule_based' },
          { tagId: 'grocery', authority: 'INFERRED', source: 'rule_based' },
          { tagId: 'food', authority: 'INFERRED', source: 'rule_based' },
          { tagId: 'fuel', authority: 'INFERRED', source: 'rule_based' },
        ],
      };
      expect(component.rowTagChips(expense).length).toBe(4);
      expect(component.rowTagOverflowCount(expense)).toBe(1);
    });

    it('renders tag chips in the dashboard expense row', () => {
      component.myExpenses = [
        {
          id: 'exp-1',
          title: 'Milk',
          amountTotal: 120,
          myShare: 120,
          category: 'Food & Drinks',
          expenseDate: new Date(),
          expenseType: 'PERSONAL',
          tags: [{ tagId: 'milk', authority: 'USER_CONFIRMED', source: 'user' }],
        },
      ];
      fixture.detectChanges();
      const chips = fixture.nativeElement.querySelector(
        '[data-testid="expense-tag-chips"]',
      );
      expect(chips?.textContent).toContain('Milk');
    });
  });

  describe('infinite scroll', () => {
    it('emits loadMoreExpensesEvent when scrolled near the bottom', () => {
      fixture.detectChanges();
      const emitSpy = jest.spyOn(component.loadMoreExpensesEvent, 'emit');

      // 900 - 750 - 100 = 50px from the bottom (< 200 threshold).
      const target = {
        scrollHeight: 900,
        scrollTop: 750,
        clientHeight: 100,
      } as HTMLElement;
      component.onExpenseListScroll({ target } as unknown as Event);

      expect(emitSpy).toHaveBeenCalled();
    });

    it('does not emit loadMoreExpensesEvent when far from the bottom', () => {
      fixture.detectChanges();
      const emitSpy = jest.spyOn(component.loadMoreExpensesEvent, 'emit');

      // 900 - 100 - 100 = 700px from the bottom (>= 200 threshold).
      const target = {
        scrollHeight: 900,
        scrollTop: 100,
        clientHeight: 100,
      } as HTMLElement;
      component.onExpenseListScroll({ target } as unknown as Event);

      expect(emitSpy).not.toHaveBeenCalled();
    });

    it('shows the loading-more spinner while a page is appending', () => {
      component.myExpenses = mockExpenses;
      component.isLoadingMoreExpenses = true;
      fixture.detectChanges();

      const spinner = fixture.nativeElement.querySelector(
        '[data-testid="expenses-loading-more"]',
      );
      expect(spinner).toBeTruthy();
    });

    it('shows the end-of-list message once no more pages remain', () => {
      component.myExpenses = mockExpenses;
      component.isLoadingMoreExpenses = false;
      component.hasMoreExpenses = false;
      fixture.detectChanges();

      const end = fixture.nativeElement.querySelector(
        '[data-testid="expenses-end"]',
      );
      expect(end).toBeTruthy();
    });
  });
});
