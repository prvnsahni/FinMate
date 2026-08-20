import { TestBed, ComponentFixture } from '@angular/core/testing';
import { signal } from '@angular/core';
import { DashboardComponent } from './dashboard.component';
import { Store } from '@ngxs/store';
import { GroupsService } from '../../../groups/services/groups.service';
import { ExpensesService } from '../../../groups/services/expenses.service';
import { ExpensesUiStore } from '../../../groups/services/expenses-ui.store';
import { AuthService } from '../../../../core/auth/auth.service';
import { of, Subject } from 'rxjs';
import { FormsModule } from '@angular/forms';
import { provideRouter, Router } from '@angular/router';
import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { NO_ERRORS_SCHEMA } from '@angular/core';

describe('DashboardComponent', () => {
  let component: DashboardComponent;
  let fixture: ComponentFixture<DashboardComponent>;
  let mockStore: jest.Mocked<Store>;
  let mockGroupsService: jest.Mocked<GroupsService>;
  let mockExpensesService: any;
  let mockExpensesUiStore: any;
  let mockAuthService: jest.Mocked<AuthService>;

  const mockUser = {
    id: 'user-1',
    email: 'john@example.com',
    displayName: 'John Doe',
  };

  const mockExpenses = [
    {
      id: 'exp-1',
      title: 'Groceries',
      amountTotal: 150,
      expenseDate: new Date(),
    },
    { id: 'exp-2', title: 'Rent', amountTotal: 1200, expenseDate: new Date() },
  ];

  const mockAnalytics = [
    { month: new Date().toISOString().slice(0, 7), total: 1350 },
  ];

  const mockProfile = {
    profile: {
      monthlyIncome: 5000,
      monthlyBudget: 2000,
      defaultCurrency: 'USD',
    },
  };

  beforeEach(async () => {
    mockStore = {
      selectSnapshot: jest.fn().mockReturnValue(mockUser),
    } as any;

    mockGroupsService = {
      getGroups: jest.fn().mockReturnValue(of({ meta: { totalItems: 3 } })),
      getPendingInvitations: jest.fn().mockReturnValue(of([])),
      updateMember: jest.fn().mockReturnValue(of({})),
      removeMember: jest.fn().mockReturnValue(of({})),
    } as any;

    mockExpensesService = {
      getExpenses: jest.fn().mockReturnValue(of({ data: mockExpenses })),
      getMyExpenses: jest.fn().mockReturnValue(of({ data: mockExpenses })),
      getCombinedMonthlyTotal: jest.fn().mockReturnValue(of(1350)),
      getMonthlyAnalytics: jest.fn().mockReturnValue(of(mockAnalytics)),
      getCategoryAnalytics: jest.fn().mockReturnValue(of([])),
      deleteExpense: jest.fn().mockReturnValue(of({})),
    };

    mockExpensesUiStore = {
      expenseCreated$: of(),
      activeTab: signal('Home'),
      showCreateExpenseModal: signal(false),
    };

    mockAuthService = {
      getMe: jest.fn().mockReturnValue(of(mockProfile)),
      updateProfile: jest.fn().mockReturnValue(of(mockProfile)),
    } as any;

    await TestBed.configureTestingModule({
      imports: [DashboardComponent],
      providers: [
        { provide: Store, useValue: mockStore },
        { provide: GroupsService, useValue: mockGroupsService },
        { provide: ExpensesService, useValue: mockExpensesService },
        { provide: ExpensesUiStore, useValue: mockExpensesUiStore },
        { provide: AuthService, useValue: mockAuthService },
        provideRouter([]),
      ],
    })
      .overrideComponent(DashboardComponent, {
        set: {
          imports: [CommonModule, FormsModule, CurrencyPipe, DatePipe],
          schemas: [NO_ERRORS_SCHEMA],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(DashboardComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should read user from store and fetch data on init', () => {
    fixture.detectChanges(); // triggers ngOnInit

    expect(mockStore.selectSnapshot).toHaveBeenCalled();
    expect(component.userName).toBe('john');
    // Total Personal Balance = monthly income − monthly spend (5000 − 1350).
    expect(component.totalBalance).toBe(3650);
    expect(component.monthlyExpenses).toBe(1350);
    expect(component.activeGroupsCount).toBe(3);
    expect(component.incomePercentage).toBe(27); // 1350/5000 * 100
    expect(component.budgetPercentage).toBe(68); // 1350/2000 * 100
  });

  it('should toggle editing income and budget', () => {
    fixture.detectChanges();
    expect(component.isEditingIncome).toBe(false);

    component.toggleEditIncome();
    expect(component.isEditingIncome).toBe(true);
    expect(component.newIncome).toBe(5000);
    expect(component.newBudget).toBe(2000);

    component.toggleEditIncome();
    expect(component.isEditingIncome).toBe(false);
  });

  it('should save updated income, budget, and default currency', () => {
    fixture.detectChanges();
    component.toggleEditIncome();
    component.newIncome = 6000;
    component.newBudget = 3000;
    component.newCurrency = 'EUR';

    const updatedProfile = {
      profile: {
        monthlyIncome: 6000,
        monthlyBudget: 3000,
        defaultCurrency: 'EUR',
      },
    };
    mockAuthService.updateProfile.mockReturnValue(of(updatedProfile));

    component.saveIncome();

    expect(mockAuthService.updateProfile).toHaveBeenCalledWith({
      defaultCurrency: 'EUR',
      monthlyIncome: 6000,
      monthlyBudget: 3000,
    });
    expect(component.isEditingIncome).toBe(false);
    expect(component.incomePercentage).toBe(23); // 1350 / 6000 = 22.5 => 23
    expect(component.budgetPercentage).toBe(45); // 1350 / 3000 = 45
  });

  it('should accept a group invitation and redirect to group details', () => {
    fixture.detectChanges();
    const mockInvite = { id: 'group-1', membershipId: 'member-1' };
    const router = TestBed.inject(Router);
    const navigateSpy = jest.spyOn(router, 'navigate').mockResolvedValue(true);

    component.acceptInvitation(mockInvite);

    expect(mockGroupsService.updateMember).toHaveBeenCalledWith(
      'group-1',
      'member-1',
      { joinStatus: 'active' },
    );
    expect(navigateSpy).toHaveBeenCalledWith(['/groups', 'group-1']);
  });

  it('should decline a group invitation', () => {
    fixture.detectChanges();
    const mockInvite = { id: 'group-1', membershipId: 'member-1' };

    component.declineInvitation(mockInvite);

    expect(mockGroupsService.removeMember).toHaveBeenCalledWith(
      'group-1',
      'member-1',
    );
  });

  it('should delete a personal expense', () => {
    fixture.detectChanges();
    component.confirmDeleteExpense('exp-1');
    expect(component.isDeleteConfirmOpen).toBe(true);
    expect(component.deleteExpenseId).toBe('exp-1');

    component.onDeleteConfirmed();
    expect(mockExpensesService.deleteExpense).toHaveBeenCalledWith('exp-1');
    expect(component.isDeleteConfirmOpen).toBe(false);
  });

  describe('infinite scroll (my expenses)', () => {
    it('reports more pages remain when total exceeds the loaded count', () => {
      mockExpensesService.getMyExpenses.mockReturnValue(
        of({ data: mockExpenses, meta: { totalItems: 5 } }),
      );
      fixture.detectChanges(); // triggers ngOnInit → refreshExpenseData

      expect(component.myExpenses.length).toBe(2);
      expect(component.totalMyExpenses).toBe(5);
      expect(component.hasMoreMyExpenses).toBe(true);
    });

    it('mutation refresh reloads the whole loaded window (pages 1..N), not just page 1', () => {
      mockExpensesService.getMyExpenses.mockReturnValue(
        of({ data: mockExpenses, meta: { totalItems: 5 } }),
      );
      fixture.detectChanges(); // initial load: page 1
      component.loadMoreMyExpenses(); // scrolled to page 2
      expect(component.expensesPage).toBe(2);

      // A create/edit/delete calls refreshExpenseData: it must reload pages 1..2
      // in ONE request (limit = pageSize × loadedPages) and keep the user's window
      // instead of collapsing back to a single first page.
      component.refreshExpenseData();
      expect(mockExpensesService.getMyExpenses).toHaveBeenLastCalledWith({
        page: 1,
        limit: 100,
      });
      expect(component.expensesPage).toBe(2); // context preserved, not reset to 1
    });

    it('drops a stale my-expenses response so it cannot overwrite a newer one (GOAL 4)', () => {
      const older = new Subject<{ data: unknown[]; meta: { totalItems: number } }>();
      const newer = new Subject<{ data: unknown[]; meta: { totalItems: number } }>();
      mockExpensesService.getMyExpenses
        .mockReturnValueOnce(older.asObservable())
        .mockReturnValueOnce(newer.asObservable());

      fixture.detectChanges(); // fetch #1 (older) — pending
      component.refreshExpenseData(); // fetch #2 (newer) — pending

      newer.next({
        data: [{ id: 'new-1', title: 'Newer', amountTotal: 5 }],
        meta: { totalItems: 1 },
      });
      newer.complete();
      expect(component.myExpenses.map((e: { id: string }) => e.id)).toEqual(['new-1']);

      // Older (stale) arrives later — must be ignored.
      older.next({
        data: [{ id: 'stale-1', title: 'Stale', amountTotal: 9 }],
        meta: { totalItems: 1 },
      });
      older.complete();
      expect(component.myExpenses.map((e: { id: string }) => e.id)).toEqual(['new-1']);
    });

    it('appends the next page and advances the page cursor on loadMore', () => {
      mockExpensesService.getMyExpenses.mockReturnValue(
        of({ data: mockExpenses, meta: { totalItems: 5 } }),
      );
      fixture.detectChanges();

      const nextPage = [
        {
          id: 'exp-3',
          title: 'Coffee',
          amountTotal: 5,
          expenseDate: new Date(),
        },
      ];
      mockExpensesService.getMyExpenses.mockReturnValue(
        of({ data: nextPage, meta: { totalItems: 5 } }),
      );

      component.loadMoreMyExpenses();

      expect(mockExpensesService.getMyExpenses).toHaveBeenLastCalledWith({
        page: 2,
        limit: 50,
      });
      expect(component.expensesPage).toBe(2);
      expect(component.myExpenses.map((e) => e.id)).toEqual([
        'exp-1',
        'exp-2',
        'exp-3',
      ]);
      expect(component.isLoadingMoreExpenses).toBe(false);
    });

    it('does not fetch more when everything is already loaded', () => {
      mockExpensesService.getMyExpenses.mockReturnValue(
        of({ data: mockExpenses, meta: { totalItems: 2 } }),
      );
      fixture.detectChanges();
      mockExpensesService.getMyExpenses.mockClear();

      component.loadMoreMyExpenses();

      expect(component.hasMoreMyExpenses).toBe(false);
      expect(mockExpensesService.getMyExpenses).not.toHaveBeenCalled();
    });
  });
});
