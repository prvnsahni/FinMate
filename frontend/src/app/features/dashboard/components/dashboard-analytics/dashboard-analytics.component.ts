import { Component, Input } from '@angular/core';
import { AnalyticsChartsComponent } from '../../../groups/components/analytics-charts/analytics-charts.component';
import { CustomTagNameEntry } from '../../../../core/services/custom-tag.service';

@Component({
  selector: 'app-dashboard-analytics',
  standalone: true,
  imports: [AnalyticsChartsComponent],
  templateUrl: './dashboard-analytics.component.html',
})
export class DashboardAnalyticsComponent {
  @Input() userProfile: any = null;
  /** TAG-C6-DISPLAY — personal custom-tag names for the analytics charts (F1/F3). */
  @Input() customTagNames?: Map<string, CustomTagNameEntry>;
}
