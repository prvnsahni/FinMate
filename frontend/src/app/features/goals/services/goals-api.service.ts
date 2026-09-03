import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import {
  CreateGoalPayload,
  Goal,
  GoalProjection,
  UpdateGoalPayload,
} from '../goal.model';

/**
 * Goals API client (BATCH-11). Talks to the CURRENT Goals endpoints. Only ever
 * sends ciphertext titles + numeric/enum fields — never plaintext.
 */
@Injectable({ providedIn: 'root' })
export class GoalsApiService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiBaseUrl}/goals`;

  list(): Observable<Goal[]> {
    return this.http.get<Goal[]>(this.base);
  }

  get(id: string): Observable<Goal> {
    return this.http.get<Goal>(`${this.base}/${id}`);
  }

  create(payload: CreateGoalPayload): Observable<Goal> {
    return this.http.post<Goal>(this.base, payload);
  }

  update(id: string, payload: UpdateGoalPayload): Observable<Goal> {
    return this.http.patch<Goal>(`${this.base}/${id}`, payload);
  }

  remove(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}`);
  }

  projection(
    id: string,
    assumedMonthlyContribution?: number,
  ): Observable<GoalProjection> {
    let params = new HttpParams();
    if (assumedMonthlyContribution != null) {
      params = params.set(
        'assumedMonthlyContribution',
        String(assumedMonthlyContribution),
      );
    }
    return this.http.get<GoalProjection>(`${this.base}/${id}/projection`, {
      params,
    });
  }
}
