import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

export interface AiResponse {
  text: string;
}

@Injectable({
  providedIn: 'root',
})
export class AiService {
  private http = inject(HttpClient);

  sendMessage(
    prompt: string,
    systemInstruction?: string,
  ): Observable<AiResponse> {
    return this.http.post<AiResponse>(`${environment.apiBaseUrl}/ai/proxy`, {
      prompt,
      systemInstruction,
    });
  }
}
