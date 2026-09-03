import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { ErrorResponse } from '@finmate/data-models';
import { catchError, throwError } from 'rxjs';

/**
 * REC-1 defense-in-depth (client-side).
 *
 * The SERVER is authoritative: it rejects any new Class-A E2EE write with
 * 409 `REC_RECOVERY_REQUIRED` when the user has no recovery material. This
 * interceptor detects that response and emits a dedicated event so the app can
 * launch the EXISTING recovery-setup flow before the user retries the action.
 * A client-side check is never sufficient on its own — this only improves UX.
 */
export const RECOVERY_REQUIRED_ERROR_CODE = 'REC_RECOVERY_REQUIRED';
export const RECOVERY_REQUIRED_EVENT = 'finmate:recovery-required';

export interface RecoveryRequiredEventDetail {
  /** The URL that was blocked, so the app can offer to retry after setup. */
  url: string;
  method: string;
}

function isRecoveryRequired(error: HttpErrorResponse): boolean {
  if (error.status !== 409) return false;
  const body = error.error as Partial<ErrorResponse> | null;
  return (
    typeof body === 'object' &&
    body !== null &&
    body.errorCode === RECOVERY_REQUIRED_ERROR_CODE
  );
}

export const recoveryRequiredInterceptor: HttpInterceptorFn = (req, next) => {
  return next(req).pipe(
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse && isRecoveryRequired(error)) {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent<RecoveryRequiredEventDetail>(
              RECOVERY_REQUIRED_EVENT,
              { detail: { url: req.url, method: req.method } },
            ),
          );
        }
      }
      return throwError(() => error);
    }),
  );
};
