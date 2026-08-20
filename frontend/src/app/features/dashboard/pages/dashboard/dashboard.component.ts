import { Component, inject, OnInit, OnDestroy } from '@angular/core';
import { Subscription } from 'rxjs';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Store } from '@ngxs/store';
import { AuthState, Logout } from '../../../../core/auth/auth.state';
import { AuthService } from '../../../../core/auth/auth.service';
import { CreateExpenseModalComponent } from '../../../groups/components/create-expense-modal/create-expense-modal.component';
import { ConfirmModalComponent } from '../../../../shared/components/confirm-modal/confirm-modal.component';
import { ExportTransactionsModalComponent } from '../../components/export-transactions-modal/export-transactions-modal.component';

import { GroupsService } from '../../../groups/services/groups.service';
import { ExpensesService } from '../../../groups/services/expenses.service';
import { ExpensesUiStore } from '../../../groups/services/expenses-ui.store';
import { PendingInvitationResponse, Profile } from '@finmate/data-models';
import { GroupExpense } from '../../../groups/pages/group-detail/group-detail.component';
import { AiService } from '../../services/ai.service';
import { DropdownOption } from '../../../../shared/components/dropdown/dropdown.component';
import { DashboardHomeComponent } from '../../components/dashboard-home/dashboard-home.component';
import { DashboardAnalyticsComponent } from '../../components/dashboard-analytics/dashboard-analytics.component';
import { DashboardGoalsComponent } from '../../components/dashboard-goals/dashboard-goals.component';
import { DashboardSettingsComponent } from '../../components/dashboard-settings/dashboard-settings.component';
import { DashboardProfileComponent } from '../../components/dashboard-profile/dashboard-profile.component';
import { CATEGORY_OPTIONS } from '../../../../core/constants/app.constants';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    FormsModule,
    CreateExpenseModalComponent,
    ConfirmModalComponent,
    ExportTransactionsModalComponent,
    DashboardHomeComponent,
    DashboardAnalyticsComponent,
    DashboardGoalsComponent,
    DashboardSettingsComponent,
    DashboardProfileComponent,
  ],
  templateUrl: './dashboard.component.html',
})
export class DashboardComponent implements OnInit, OnDestroy {
  bankIconPath =
    'M3 22h18M6 18v-7M10 18v-7M14 18v-7M18 18v-7M12 2L2 7h20L12 2z';
  creditCardIconPath =
    'M19 4H5a3 3 0 00-3 3v10a3 3 0 003 3h14a3 3 0 003-3V7a3 3 0 00-3-3zM5 6h14a1 1 0 011 1v2H4V7a1 1 0 011-1zm14 12H5a1 1 0 01-1-1v-5h16v5a1 1 0 01-1 1z';
  usersIconPath =
    'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2 M9 11a4 4 0 100-8 4 4 0 000 8z M23 21v-2a4 4 0 00-3-3.87 M16 3.13a4 4 0 010 7.75';
  cogIconPath =
    'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z';
  bellIconPath =
    'M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9 M13.73 21a2 2 0 01-3.46 0';
  inboxIconPath =
    'M20 12h-4l-3 3h-2l-3-3H4V6h16v6z M20 4H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V6a2 2 0 00-2-2z';

  private destroy$ = new Subscription();
  categoryAnalytics: {
    category: string;
    amount: number;
    percentage: number;
  }[] = [];
  quickLogCategory = CATEGORY_OPTIONS[0].value; // Default to first category
  private store = inject(Store);
  private groupsService = inject(GroupsService);
  private expensesService = inject(ExpensesService);
  private expensesUiStore = inject(ExpensesUiStore);
  private authService = inject(AuthService);
  private aiService = inject(AiService);
  private router = inject(Router);

  get activeTab(): string {
    return this.expensesUiStore.activeTab();
  }

  protected readonly Math = Math;

  userName = 'User';
  userEmail = 'N/A';
  userDisplayName = '';
  monthlyExpenses = 0;

  /**
   * "Total Personal Balance" = money the user has left this month: their monthly
   * income minus what they've spent this month. It is NOT a running sum of
   * expenses. Negative means they have spent more than their income.
   */
  get totalBalance(): number {
    return (this.userProfile?.monthlyIncome || 0) - this.monthlyExpenses;
  }
  activeGroupsCount = 0;
  personalExpenses: GroupExpense[] = [];
  myExpenses: any[] = []; // personal + group shares
  totalMyExpenses = 0;
  /** 1-based page of the unified /expenses/me list currently loaded. */
  expensesPage = 1;
  private readonly expensesPageSize = 50;
  /**
   * Monotonic id for /expenses/me fetches (refresh + load-more share it). A
   * response is applied only when it is still the latest request, so a late/
   * out-of-order reply can never overwrite fresher data or append onto a list
   * that was just reloaded — the request-sequence equivalent of switchMap.
   */
  private myExpensesSeq = 0;
  /** True while infinite scroll is appending a subsequent page. */
  isLoadingMoreExpenses = false;
  expenseViewFilter: 'all' | 'personal' | 'group_share' = 'all';
  get isExpenseModalOpen(): boolean {
    return this.expensesUiStore.showCreateExpenseModal();
  }
  set isExpenseModalOpen(val: boolean) {
    this.expensesUiStore.showCreateExpenseModal.set(val);
  }
  isLoading = true;
  isLoggingOut = false;

  // AI Chat Bot State
  isAiChatOpen = false;
  aiOptIn = false;
  aiMessages: { sender: 'user' | 'ai'; text: string; time: Date }[] = [];
  aiInput = '';
  isAiLoading = false;

  // Profile and Budget Trackers
  userProfile: Profile | null = null;
  pendingInvitations: PendingInvitationResponse[] = [];
  incomePercentage = 0;
  budgetPercentage = 0;

  // Edit Budget/Income State
  isEditingIncome = false;
  newIncome = 0;
  newBudget = 0;
  newCurrency = 'USD';

  currencyOptions: DropdownOption[] = [
    { value: 'USD', label: 'USD ($)', description: 'US Dollar' },
    { value: 'INR', label: 'INR (₹)', description: 'Indian Rupee' },
    { value: 'EUR', label: 'EUR (€)', description: 'Euro' },
    { value: 'GBP', label: 'GBP (£)', description: 'British Pound' },
    { value: 'JPY', label: 'JPY (¥)', description: 'Japanese Yen' },
    { value: 'CAD', label: 'CAD (C$)', description: 'Canadian Dollar' },
    { value: 'AUD', label: 'AUD (A$)', description: 'Australian Dollar' },
  ];

  // Track edit mode
  selectedExpenseForEdit: GroupExpense | null = null;

  // Confirm delete modal state
  isDeleteConfirmOpen = false;
  deleteExpenseId: string | null = null;

  // Export transactions modal state
  isExportModalOpen = false;

  ngOnInit() {
    const user = this.store.selectSnapshot(AuthState.getUser);
    if (user?.email) {
      this.userName = user.email.split('@')[0];
      this.userEmail = user.email;
    }
    this.aiOptIn = localStorage.getItem('finmate_ai_opt_in') === 'true';
    this.fetchStaticData();
    this.refreshExpenseData();

    const sub = this.expensesUiStore.expenseCreated$.subscribe(() => {
      this.refreshExpenseData();
    });
    this.destroy$.add(sub);
  }

  ngOnDestroy() {
    this.destroy$.unsubscribe();
  }

  /**
   * Refreshes only expense-derived data.
   * Call after any expense create / edit / delete so that stats stay current
   * without reloading profile, groups, or invitations (which did not change).
   */
  refreshExpenseData() {
    this.isLoading = true;

    // 1. Fetch personal + group-share expenses (unified list). Reloads the whole
    //    window the user has already scrolled through (pages 1..expensesPage in
    //    one request) rather than collapsing to page 1 — so a create/edit/delete
    //    keeps the user's loaded context (the newest row lands at the top). On
    //    first load expensesPage is 1, so this is a single first page.
    const loadedPages = Math.max(1, this.expensesPage);
    const seq = ++this.myExpensesSeq;
    this.expensesService
      .getMyExpenses({ page: 1, limit: this.expensesPageSize * loadedPages })
      .subscribe({
        next: (res) => {
          // A newer fetch superseded this one — drop the stale response.
          if (seq !== this.myExpensesSeq) return;
          const items = this.extractExpenseItems(res);
          this.myExpenses = items;
          this.totalMyExpenses = this.extractExpenseTotal(res, items.length);
          // Keep personalExpenses for backwards compat with existing templates
          this.personalExpenses = items.filter(
            (e) => e.expenseType === 'PERSONAL' || !e.expenseType,
          ) as GroupExpense[];
          // Note: "Total Personal Balance" is derived (income − monthly spend) via
          // the totalBalance getter — no longer a running sum of expenses here.
          this.isLoading = false;
        },
        error: () => {
          if (seq !== this.myExpensesSeq) return;
          this.isLoading = false;
        },
      });

    // 2. Combined monthly total (personal + group shares)
    this.expensesService.getCombinedMonthlyTotal().subscribe({
      next: (total) => {
        this.monthlyExpenses = total;
        this.recalculatePercentages();
      },
      error: () => {
        // Fallback to personal-only if combined endpoint fails
        this.expensesService.getMonthlyAnalytics('personal').subscribe({
          next: (res) => {
            const currentMonthStr = new Date().toISOString().slice(0, 7);
            const currentMonthData = res.find(
              (r) => r.month === currentMonthStr,
            );
            this.monthlyExpenses = currentMonthData
              ? currentMonthData.total
              : 0;
            this.recalculatePercentages();
          },
        });
      },
    });

    // 3. Fetch category analytics
    this.expensesService.getCategoryAnalytics('personal').subscribe({
      next: (res) => {
        const total = res.reduce((sum, item) => sum + Number(item.total), 0);
        this.categoryAnalytics = res
          .map((item) => ({
            category: item.category,
            amount: Number(item.total),
            percentage:
              total > 0 ? Math.round((Number(item.total) / total) * 100) : 0,
          }))
          .sort((a, b) => b.amount - a.amount);
      },
      error: () => {
        console.error('Failed to fetch category analytics');
      },
    });
  }

  /**
   * Loads profile, group count, and pending invitations.
   * Call once on init. Re-call only when these change (invitation accept/decline,
   * group join/leave). Profile is updated locally by saveIncome() after edits.
   */
  fetchStaticData() {
    // Fetch active groups to count them
    this.groupsService.getGroups().subscribe({
      next: (res) => {
        this.activeGroupsCount = res.meta?.totalItems || res.data?.length || 0;
      },
      error: () => {
        console.error('Failed to fetch active groups');
      },
    });

    // Fetch profile (once per mount; saveIncome() updates it locally on success)
    this.authService.getMe().subscribe({
      next: (res) => {
        this.userProfile = res.profile;
        this.userDisplayName = (res as any).user?.displayName || '';
        this.newIncome = res.profile.monthlyIncome || 0;
        this.newBudget = res.profile.monthlyBudget || 0;
        this.newCurrency = res.profile.defaultCurrency || 'USD';
        // Server-side consent flag is authoritative; localStorage is only a
        // pre-login hint. Keep both in sync.
        const serverOptIn = (res as any).user?.aiOptIn;
        if (typeof serverOptIn === 'boolean') {
          this.aiOptIn = serverOptIn;
          localStorage.setItem(
            'finmate_ai_opt_in',
            serverOptIn ? 'true' : 'false',
          );
        }
        this.recalculatePercentages();
      },
      error: () => {
        console.error('Failed to fetch profile');
      },
    });

    // Fetch pending invitations
    this.groupsService.getPendingInvitations().subscribe({
      next: (res) => {
        this.pendingInvitations = res;
      },
      error: () => {
        console.error('Failed to fetch pending invitations');
      },
    });
  }

  recalculatePercentages() {
    this.incomePercentage = this.userProfile?.monthlyIncome
      ? Math.round(
          (this.monthlyExpenses / this.userProfile.monthlyIncome) * 100,
        )
      : 0;
    this.budgetPercentage = this.userProfile?.monthlyBudget
      ? Math.round(
          (this.monthlyExpenses / this.userProfile.monthlyBudget) * 100,
        )
      : 0;
  }

  get incomeProgressWidth(): number {
    const income = this.userProfile?.monthlyIncome;
    return income ? Math.min((this.monthlyExpenses / income) * 100, 100) : 0;
  }

  get budgetProgressWidth(): number {
    const budget = this.userProfile?.monthlyBudget;
    return budget ? Math.min((this.monthlyExpenses / budget) * 100, 100) : 0;
  }

  toggleEditIncome() {
    this.isEditingIncome = !this.isEditingIncome;
    if (this.isEditingIncome && this.userProfile) {
      this.newIncome = this.userProfile.monthlyIncome || 0;
      this.newBudget = this.userProfile.monthlyBudget || 0;
      this.newCurrency = this.userProfile.defaultCurrency || 'USD';
    }
  }

  saveIncome() {
    this.authService
      .updateProfile({
        defaultCurrency: this.newCurrency,
        monthlyIncome: Number(this.newIncome),
        monthlyBudget: Number(this.newBudget),
      })
      .subscribe({
        next: (res) => {
          this.userProfile = res.profile;
          this.isEditingIncome = false;
          this.recalculatePercentages();
        },
        error: (err) => {
          alert(err.error?.message || 'Failed to update profile settings.');
        },
      });
  }

  get filteredMyExpenses(): any[] {
    if (this.expenseViewFilter === 'personal') {
      return this.myExpenses.filter(
        (e) => e.expenseType === 'PERSONAL' || !e.expenseType,
      );
    }
    if (this.expenseViewFilter === 'group_share') {
      return this.myExpenses.filter((e) => e.expenseType === 'GROUP_SHARE');
    }
    return this.myExpenses;
  }

  setExpenseViewFilter(filter: 'all' | 'personal' | 'group_share'): void {
    this.expenseViewFilter = filter;
  }

  /** More pages of the unified list remain to fetch (filter-independent — the
   *  in-view filtering is client-side over whatever has been loaded). */
  get hasMoreMyExpenses(): boolean {
    return this.myExpenses.length < this.totalMyExpenses;
  }

  /**
   * Infinite scroll: fetch the next page of /expenses/me and append it to the
   * loaded list. Guards against duplicate in-flight requests and stops once
   * every page has loaded. Mirrors the group ledger's loadMoreExpenses.
   */
  loadMoreMyExpenses(): void {
    if (this.isLoading || this.isLoadingMoreExpenses) return;
    if (!this.hasMoreMyExpenses) return;
    this.isLoadingMoreExpenses = true;
    const nextPage = this.expensesPage + 1;
    const seq = ++this.myExpensesSeq;
    this.expensesService
      .getMyExpenses({ page: nextPage, limit: this.expensesPageSize })
      .subscribe({
        next: (res) => {
          // A newer fetch (e.g. a mutation reload) superseded this page — dropping
          // it avoids appending stale rows onto a freshly reloaded list.
          if (seq !== this.myExpensesSeq) return;
          const items = this.extractExpenseItems(res);
          this.myExpenses = [...this.myExpenses, ...items];
          this.totalMyExpenses = this.extractExpenseTotal(
            res,
            this.totalMyExpenses,
          );
          this.personalExpenses = this.myExpenses.filter(
            (e) => e.expenseType === 'PERSONAL' || !e.expenseType,
          ) as GroupExpense[];
          this.expensesPage = nextPage;
          this.isLoadingMoreExpenses = false;
        },
        error: () => {
          if (seq !== this.myExpensesSeq) return;
          this.isLoadingMoreExpenses = false;
        },
      });
  }

  /** Pulls the expense array out of the paginated /expenses/me response,
   *  tolerating both the unwrapped and doubly-nested shapes. */
  private extractExpenseItems(res: any): any[] {
    return Array.isArray(res?.data)
      ? res.data
      : Array.isArray(res?.data?.data)
        ? res.data.data
        : [];
  }

  /** Total item count from the paginated response, falling back to `fallback`. */
  private extractExpenseTotal(res: any, fallback: number): number {
    return res?.meta?.totalItems ?? res?.data?.meta?.totalItems ?? fallback;
  }

  openGroupExpense(event: { groupId: string; expenseId: string }): void {
    this.router.navigate(['/groups', event.groupId], {
      queryParams: { highlight: event.expenseId },
    });
  }

  handleProfileUpdated(res: any): void {
    this.userProfile = res.profile;
    if (res.user?.displayName !== undefined) {
      this.userDisplayName = res.user.displayName || '';
      this.userName = res.user.displayName || this.userName;
    }
  }

  acceptInvitation(invite: PendingInvitationResponse) {
    this.groupsService
      .updateMember(invite.id, invite.membershipId, { joinStatus: 'active' })
      .subscribe({
        next: () => {
          // Groups, invitations, AND expense data all change on accept:
          // the newly joined group's expense splits are now visible in My Expenses.
          this.fetchStaticData();
          this.refreshExpenseData();
          this.router.navigate(['/groups', invite.id]);
        },
        error: (err) => {
          alert(err.error?.message || 'Failed to accept invitation');
        },
      });
  }

  declineInvitation(invite: PendingInvitationResponse) {
    this.groupsService.removeMember(invite.id, invite.membershipId).subscribe({
      next: () => {
        // Only the invitations list changed; re-fetch static data.
        this.fetchStaticData();
      },
      error: (err) => {
        alert(err.error?.message || 'Failed to decline invitation');
      },
    });
  }

  openExpenseModal(expense?: GroupExpense, category?: string) {
    if (category) {
      this.quickLogCategory = category;
      this.selectedExpenseForEdit = null;
    } else {
      this.quickLogCategory = expense
        ? expense.category
        : CATEGORY_OPTIONS[0].value;
      this.selectedExpenseForEdit = expense || null;
    }
    this.isExpenseModalOpen = true;
  }

  closeExpenseModal() {
    this.selectedExpenseForEdit = null;
    this.isExpenseModalOpen = false;
  }

  onExpenseCreated() {
    this.refreshExpenseData();
  }

  openExportModal() {
    this.isExportModalOpen = true;
  }

  closeExportModal() {
    this.isExportModalOpen = false;
  }

  confirmDeleteExpense(expenseId: string) {
    this.deleteExpenseId = expenseId;
    this.isDeleteConfirmOpen = true;
  }

  onDeleteConfirmed() {
    if (this.deleteExpenseId) {
      this.expensesService.deleteExpense(this.deleteExpenseId).subscribe({
        next: () => {
          this.isDeleteConfirmOpen = false;
          this.deleteExpenseId = null;
          this.refreshExpenseData();
        },
        error: (err) => {
          this.isDeleteConfirmOpen = false;
          this.deleteExpenseId = null;
          alert(err.error?.message || 'Failed to delete expense');
        },
      });
    }
  }

  onDeleteCancelled() {
    this.isDeleteConfirmOpen = false;
    this.deleteExpenseId = null;
  }

  logout() {
    if (this.isLoggingOut) {
      return;
    }

    // The Logout action clears the session and redirects to Login centrally
    // (see AuthState) — no navigation needed here.
    this.isLoggingOut = true;
    this.store.dispatch(new Logout());
  }

  // AI Chat Bot Methods
  toggleAiChat() {
    this.isAiChatOpen = !this.isAiChatOpen;
    if (this.isAiChatOpen && this.aiOptIn && this.aiMessages.length === 0) {
      this.initAiGreeting();
    }
  }

  toggleAiOptIn(event: any) {
    this.aiOptIn = event.target.checked;
    localStorage.setItem('finmate_ai_opt_in', this.aiOptIn ? 'true' : 'false');
    // Consent is enforced server-side (AI_OPT_IN_REQUIRED) — persist it there.
    this.authService.updateProfile({ aiOptIn: this.aiOptIn } as any).subscribe({
      error: () => console.error('Failed to persist AI opt-in preference'),
    });
    if (this.aiOptIn && this.aiMessages.length === 0) {
      this.initAiGreeting();
    }
  }

  initAiGreeting() {
    this.aiMessages = [
      {
        sender: 'ai',
        text: `Hi ${this.userName}! I'm your FinMate AI financial assistant. I can see you've spent ${this.monthlyExpenses} USD of your ${this.userProfile?.monthlyBudget || 0} USD monthly budget. Ask me anything about your categories or how to optimize your spending!`,
        time: new Date(),
      },
    ];
  }

  sendAiMessage(customPrompt?: string) {
    const prompt = (customPrompt || this.aiInput).trim();
    if (!prompt) return;

    // Add user message
    this.aiMessages.push({
      sender: 'user',
      text: prompt,
      time: new Date(),
    });

    if (!customPrompt) {
      this.aiInput = '';
    }

    this.isAiLoading = true;

    // Construct the context-aware system instruction
    const budget = this.userProfile?.monthlyBudget || 0;
    const income = this.userProfile?.monthlyIncome || 0;
    const systemInstruction =
      `You are FinMate's personal financial AI companion. The current user is ${this.userName}. ` +
      `Their current monthly personal spending is ${this.monthlyExpenses} USD, relative to a monthly budget of ${budget} USD (${this.budgetPercentage}% utilization) and a monthly salary of ${income} USD. ` +
      `Their remaining balance this month (income minus spending) is ${this.totalBalance} USD. ` +
      `Answer in a concise, friendly, and professional tone (max 3-4 sentences). Do not mention database IDs, keys, or technical jargon. Give actionable financial tips.`;

    this.aiService.sendMessage(prompt, systemInstruction).subscribe({
      next: (res) => {
        this.aiMessages.push({
          sender: 'ai',
          text: res.text,
          time: new Date(),
        });
        this.isAiLoading = false;
      },
      error: (err) => {
        this.aiMessages.push({
          sender: 'ai',
          text: `Sorry, I encountered an error: ${err.error?.message || 'Failed to contact AI service.'}`,
          time: new Date(),
        });
        this.isAiLoading = false;
      },
    });
  }
}
