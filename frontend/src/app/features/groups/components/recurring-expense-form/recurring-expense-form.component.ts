import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnChanges,
  SimpleChanges,
  inject,
} from '@angular/core';
import {
  ReactiveFormsModule,
  FormsModule,
  FormBuilder,
  Validators,
  AbstractControl,
  ValidationErrors,
} from '@angular/forms';
import { Store } from '@ngxs/store';
import { RecurringExpensesService } from '../../services/recurring-expenses.service';
import { SubmitButtonComponent } from '../../../../shared/components/submit-button/submit-button.component';
import { AuthState } from '../../../../core/auth/auth.state';
import {
  CreateRecurringExpenseDto,
  RecurringExpenseSplitInputDto,
  GroupMember,
  UpdateRecurringExpenseDto,
} from '@finmate/data-models';
import {
  DropdownComponent,
  DropdownOption,
} from '../../../../shared/components/dropdown/dropdown.component';

/**
 * Cross-field rule: the optional End Date must not fall before the Start Date.
 * Dates are `YYYY-MM-DD` strings, so a lexicographic compare is a date compare.
 */
function endDateNotBeforeStart(
  group: AbstractControl,
): ValidationErrors | null {
  const start = group.get('startDate')?.value;
  const end = group.get('endDate')?.value;
  if (!start || !end) return null;
  return end < start ? { endBeforeStart: true } : null;
}

@Component({
  selector: 'app-recurring-expense-form',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    FormsModule,
    SubmitButtonComponent,
    DropdownComponent,
  ],
  templateUrl: './recurring-expense-form.component.html',
  styleUrls: ['./recurring-expense-form.component.css'],
})
export class RecurringExpenseFormComponent implements OnChanges {
  private recurringExpensesService = inject(RecurringExpensesService);
  private fb = inject(FormBuilder);
  private store = inject(Store);

  currencyOptions: DropdownOption[] = [
    { value: 'USD', label: 'USD ($)' },
    { value: 'INR', label: 'INR (₹)' },
    { value: 'EUR', label: 'EUR (€)' },
  ];

  categoryOptions: DropdownOption[] = [
    { value: 'Food & Drinks', label: 'Food & Drinks' },
    { value: 'Housing & Rent', label: 'Housing & Rent' },
    { value: 'Utilities & Bills', label: 'Utilities & Bills' },
    { value: 'Subscription', label: 'Subscription' },
    { value: 'Travel & Commute', label: 'Travel & Commute' },
    { value: 'Entertainment', label: 'Entertainment' },
    { value: 'Others', label: 'Others' },
  ];

  frequencyOptions: DropdownOption[] = [
    { value: 'daily', label: 'Daily' },
    { value: 'weekly', label: 'Weekly' },
    { value: 'monthly', label: 'Monthly' },
    { value: 'yearly', label: 'Yearly' },
  ];

  get payerOptions(): DropdownOption[] {
    return this.availablePayers.map((p) => ({
      value: p.id,
      label: p.name,
    }));
  }

  @Input() groupId: string | null = null;
  @Input() groupCurrency!: string;
  @Input() members: GroupMember[] = [];
  @Input() template: any | null = null; // For editing existing template

  // Emits the saved template. `firstOccurrenceGenerated` tells the parent
  // whether a ledger expense was materialized now (start date = today), so it
  // can refresh the ledger in addition to the recurring list.
  @Output() saveSuccess = new EventEmitter<{
    firstOccurrenceGenerated?: boolean;
  }>();
  @Output() cancelled = new EventEmitter<void>();

  selectedUserIds = new Set<string>();
  isSubmitting = false;
  errorMessage = '';

  form = this.fb.group(
    {
      title: ['', [Validators.required, Validators.maxLength(160)]],
      description: [''],
      amountTotal: [
        null as number | null,
        [Validators.required, Validators.min(0.01)],
      ],
      currency: ['', [Validators.required]],
      category: [
        'Food & Drinks',
        [Validators.required, Validators.maxLength(64)],
      ],
      frequency: ['monthly' as const, [Validators.required]],
      startDate: [this.getTodayDateString(), [Validators.required]],
      endDate: [''],
      paidByUserId: ['', [Validators.required]],
    },
    { validators: [endDateNotBeforeStart] },
  );

  get currencySymbol(): string {
    const cur = this.form.get('currency')?.value;
    if (cur === 'INR') return '₹';
    if (cur === 'EUR') return '€';
    return '$';
  }

  getTodayDateString(): string {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  getCurrentUserId(): string | null {
    // AU-6: the access token lives in memory only (AuthState), never localStorage.
    return this.store.selectSnapshot(AuthState.getUser)?.userId || null;
  }

  get availablePayers() {
    if (this.groupId) {
      // Pending (Contact-backed) members have no User account and can't be
      // selected as payer in this User-keyed flow.
      return this.members
        .filter((m) => !!m.user)
        .map((m) => ({
          id: m.user!.id,
          name: m.user!.displayName || m.user!.email,
        }));
    } else {
      const currentUserId = this.getCurrentUserId();
      return currentUserId ? [{ id: currentUserId, name: 'You' }] : [];
    }
  }

  get availableParticipants() {
    if (this.groupId) {
      return this.members
        .filter((m) => m.role !== 'spectator' && !!m.user)
        .map((m) => ({
          id: m.user!.id,
          name: m.user!.displayName || m.user!.email,
        }));
    } else {
      const currentUserId = this.getCurrentUserId();
      return currentUserId ? [{ id: currentUserId, name: 'You' }] : [];
    }
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['template'] && this.template) {
      this.form.patchValue({
        title: this.template.title,
        description: this.template.description || '',
        amountTotal: this.template.amountTotal,
        currency: this.template.currency,
        category: this.template.category,
        frequency: this.template.frequency,
        startDate: this.template.startDate,
        endDate: this.template.endDate || '',
        paidByUserId: this.template.paidByUserId,
      });

      this.selectedUserIds.clear();
      if (this.template.splits) {
        this.template.splits.forEach((s: any) => {
          if (s.participantUserId) {
            this.selectedUserIds.add(s.participantUserId);
          }
        });
      }
      return;
    }

    if (changes['members'] && this.members) {
      this.selectedUserIds.clear();
      this.members.forEach((m) => {
        if (
          m.user &&
          (m.joinStatus === 'active' || m.joinStatus === 'invited') &&
          m.role !== 'spectator'
        ) {
          this.selectedUserIds.add(m.user.id);
        }
      });

      const currentUserId = this.getCurrentUserId();
      const registeredMembers = this.members.filter((m) => !!m.user);
      if (
        currentUserId &&
        registeredMembers.some((m) => m.user!.id === currentUserId)
      ) {
        this.form.patchValue({ paidByUserId: currentUserId });
      } else if (registeredMembers.length > 0) {
        this.form.patchValue({ paidByUserId: registeredMembers[0].user!.id });
      }
    }

    if (changes['groupCurrency'] && this.groupCurrency) {
      this.form.patchValue({ currency: this.groupCurrency });
    }

    if (!this.groupId) {
      const currentUserId = this.getCurrentUserId();
      if (currentUserId) {
        this.form.patchValue({ paidByUserId: currentUserId, currency: 'USD' });
        this.selectedUserIds.clear();
        this.selectedUserIds.add(currentUserId);
      }
    }
  }

  toggleParticipant(userId: string) {
    if (this.selectedUserIds.has(userId)) {
      this.selectedUserIds.delete(userId);
    } else {
      this.selectedUserIds.add(userId);
    }
  }

  onSubmit() {
    if (this.form.valid && this.selectedUserIds.size > 0) {
      this.isSubmitting = true;
      this.errorMessage = '';

      const val = this.form.value;
      const splits: RecurringExpenseSplitInputDto[] = Array.from(
        this.selectedUserIds,
      ).map((userId) => ({
        participantUserId: userId,
        splitType: 'equal' as const,
        shareValue: 1,
      }));

      const payload: CreateRecurringExpenseDto = {
        title: val.title!,
        description: val.description || undefined,
        amountTotal: val.amountTotal!,
        currency: val.currency!,
        category: val.category!,
        frequency: val.frequency!,
        startDate: val.startDate!,
        endDate: val.endDate || undefined,
        paidByUserId: val.paidByUserId!,
        groupId: this.groupId ?? undefined,
        splits,
      };

      const request$ = this.template
        ? this.recurringExpensesService.updateRecurringExpense(
            this.template.id,
            {
              ...payload,
              version: this.template.version,
            } satisfies UpdateRecurringExpenseDto,
          )
        : this.recurringExpensesService.createRecurringExpense(payload);

      request$.subscribe({
        next: (saved) => {
          this.isSubmitting = false;
          // `saved` carries firstOccurrenceGenerated on create; updates omit it.
          this.saveSuccess.emit(saved ?? {});
        },
        error: (err) => {
          this.isSubmitting = false;
          this.errorMessage =
            err.error?.message || 'Failed to save recurring expense';
        },
      });
    }
  }
}
