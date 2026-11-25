import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ReactiveFormsModule } from '@angular/forms';
import { Store } from '@ngxs/store';
import { RecurringExpenseFormComponent } from './recurring-expense-form.component';
import { RecurringExpensesService } from '../../services/recurring-expenses.service';
import { AuthState } from '../../../../core/auth/auth.state';
import { of } from 'rxjs';

describe('RecurringExpenseFormComponent', () => {
  let component: RecurringExpenseFormComponent;
  let fixture: ComponentFixture<RecurringExpenseFormComponent>;

  beforeEach(async () => {
    const spy = {
      createRecurringExpense: jest.fn().mockReturnValue(of({ id: '1' })),
      updateRecurringExpense: jest.fn().mockReturnValue(of({ id: '1' })),
    };
    const mockStore = {
      selectSnapshot: jest.fn((selector: unknown) =>
        selector === AuthState.getUser
          ? { userId: 'user-1', email: 'test@example.com' }
          : null,
      ),
    };

    await TestBed.configureTestingModule({
      imports: [ReactiveFormsModule, RecurringExpenseFormComponent],
      providers: [
        { provide: RecurringExpensesService, useValue: spy },
        { provide: Store, useValue: mockStore },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(RecurringExpenseFormComponent);
    component = fixture.componentInstance;
    component.groupId = 'group-1';
    component.groupCurrency = 'USD';
    component.members = [];
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should initialize form with defaults', () => {
    expect(component.form.get('category')?.value).toBe('Food & Drinks');
    expect(component.form.get('frequency')?.value).toBe('monthly');
  });

  it('should trigger cancel output on cancel click', () => {
    jest.spyOn(component.cancelled, 'emit');
    component.cancelled.emit();
    expect(component.cancelled.emit).toHaveBeenCalled();
  });

  it('flags the form invalid when the end date is before the start date', () => {
    component.form.patchValue({
      startDate: '2026-07-10',
      endDate: '2026-07-05',
    });
    expect(component.form.hasError('endBeforeStart')).toBe(true);
    expect(component.form.valid).toBe(false);
  });

  it('accepts an end date on or after the start date (and an empty end date)', () => {
    component.form.patchValue({
      startDate: '2026-07-10',
      endDate: '2026-07-10',
    });
    expect(component.form.hasError('endBeforeStart')).toBe(false);

    component.form.patchValue({ endDate: '' });
    expect(component.form.hasError('endBeforeStart')).toBe(false);
  });
});
