import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DashboardAnalyticsComponent } from './dashboard-analytics.component';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ExpensesService } from '../../../groups/services/expenses.service';
import { of } from 'rxjs';

describe('DashboardAnalyticsComponent', () => {
  let component: DashboardAnalyticsComponent;
  let fixture: ComponentFixture<DashboardAnalyticsComponent>;

  beforeEach(async () => {
    const mockExpensesService = {
      getCategoryAnalytics: jest.fn().mockReturnValue(of([])),
      getMonthlyAnalytics: jest.fn().mockReturnValue(of([])),
      // TAG-BATCH-B1: analytics-charts now also loads tag distribution + taxonomy.
      getTagAnalytics: jest.fn().mockReturnValue(of([])),
      getTaxonomy: jest.fn().mockReturnValue(of([])),
    };

    await TestBed.configureTestingModule({
      imports: [DashboardAnalyticsComponent],
      providers: [{ provide: ExpensesService, useValue: mockExpensesService }],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(DashboardAnalyticsComponent);
    component = fixture.componentInstance;
    component.userProfile = { defaultCurrency: 'INR' };
  });

  it('should create', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('should render the charts title', () => {
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain(
      'Personal Expenses Analytics',
    );
  });
});
