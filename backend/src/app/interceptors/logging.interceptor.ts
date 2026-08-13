import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { redactUrl, hashIp } from '../common/log-redaction.util';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('RequestLogger');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const ctx = context.switchToHttp();
    const req = ctx.getRequest();
    const res = ctx.getResponse();

    if (!req.startTime) {
      req.startTime = Date.now();
    }

    return next.handle().pipe(
      tap({
        next: () => {
          this.logRequest(req, res);
        },
        error: (err) => {
          this.logRequest(req, res, err);
        },
      }),
    );
  }

  private logRequest(req: any, res: any, error?: any) {
    const timestamp = new Date().toISOString();
    const method = req.method;
    // SEC-W2: strip sensitive query-param values (tokens/email) from logged URLs
    const url = redactUrl(req.originalUrl || req.url);
    // SEC-W2: hash the client IP so raw addresses never enter request logs
    // (same SHA-256 scheme as audit_logs.ipHash; SEC-W9 owns which IP is trusted)
    const ip = hashIp(
      req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress,
    );
    const responseTime = req.startTime
      ? `${Date.now() - req.startTime}ms`
      : 'N/A';
    const status = error
      ? error.status || error.statusCode || 500
      : res.statusCode;
    const userId =
      req?.user?.id ||
      req?.user?.userId ||
      req?.throttleContext?.userId ||
      'anonymous';

    const throttleCtx = req?.throttleContext || {};
    const throttleKey = throttleCtx.throttleKey || ip;
    const limit = throttleCtx.limit !== undefined ? throttleCtx.limit : 'N/A';
    const remaining =
      throttleCtx.remaining !== undefined ? throttleCtx.remaining : 'N/A';

    const logMessage = JSON.stringify({
      timestamp,
      method,
      url,
      userId,
      ip,
      status,
      responseTime,
      throttleKey,
      limit,
      remaining,
    });

    if (status >= 500) {
      this.logger.error(logMessage);
    } else if (status >= 400) {
      this.logger.warn(logMessage);
    } else {
      this.logger.log(logMessage);
    }
  }
}
