import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { QueryFailedError, EntityNotFoundError } from 'typeorm';
import { randomUUID } from 'crypto';
import { redactUrl } from '../common/log-redaction.util';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let errorCode = 'SYS_INTERNAL_ERROR';
    let message = 'An unexpected internal server error occurred';
    let details: { field: string; issue: string }[] | undefined = undefined;

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const resBody = exception.getResponse() as any;

      if (typeof resBody === 'string') {
        message = resBody;
      } else if (typeof resBody === 'object' && resBody !== null) {
        message = resBody.message || exception.message;
        if (resBody.errorCode) {
          errorCode = resBody.errorCode;
        }
        if (resBody.details) {
          details = resBody.details;
        }

        // Extract class-validator array formatting
        if (
          statusCode === HttpStatus.BAD_REQUEST &&
          Array.isArray(resBody.message)
        ) {
          errorCode = 'VAL_INVALID_INPUT';
          message = 'Input validation failed: ' + resBody.message.join(', ');
          details = [];
          for (const msg of resBody.message) {
            if (typeof msg === 'string') {
              const firstSpace = msg.indexOf(' ');
              if (firstSpace !== -1) {
                const field = msg.substring(0, firstSpace);
                const issue = msg.substring(firstSpace + 1);
                details.push({ field, issue });
              } else {
                details.push({ field: 'input', issue: msg });
              }
            }
          }
        }
      }
    } else if (exception instanceof EntityNotFoundError) {
      statusCode = HttpStatus.NOT_FOUND;
      errorCode = 'RES_NOT_FOUND';
      message = exception.message || 'The requested resource was not found';
    } else if (exception instanceof QueryFailedError) {
      const driverError = exception.driverError;
      this.logger.error(
        `Database Exception: ${exception.message}`,
        exception.stack,
      );

      if (driverError && driverError.code === '23505') {
        statusCode = HttpStatus.CONFLICT;
        errorCode = 'RES_ALREADY_EXISTS';
        message =
          driverError.detail ||
          'Database unique constraint violation: resource already exists';
      } else if (driverError && driverError.code === '23503') {
        statusCode = HttpStatus.BAD_REQUEST;
        errorCode = 'VAL_INVALID_INPUT';
        message =
          driverError.detail ||
          'Database foreign key constraint violation: referenced resource does not exist';
      } else if (
        driverError &&
        ['22P02', '22007', '22001', '22003', '23502', '23514'].includes(
          driverError.code,
        )
      ) {
        statusCode = HttpStatus.BAD_REQUEST;
        errorCode = 'VAL_INVALID_INPUT';
        message =
          driverError.code === '23502'
            ? 'Invalid input: a required field was missing or empty'
            : driverError.code === '23514'
              ? 'Invalid input: constraint violation'
              : 'Invalid input format: ' +
                (driverError.message || exception.message);
      } else if (
        driverError &&
        (String(driverError.code).startsWith('08') ||
          [
            'ECONNREFUSED',
            'ETIMEDOUT',
            'ENOTFOUND',
            'EPIPE',
            'ECONNRESET',
          ].includes(driverError.code) ||
          String(driverError.message).toLowerCase().includes('connect') ||
          String(exception.message).toLowerCase().includes('connection'))
      ) {
        statusCode = HttpStatus.SERVICE_UNAVAILABLE;
        errorCode = 'SYS_SERVICE_UNAVAILABLE';
        message =
          'Database service is temporarily unavailable. Please try again later.';
      } else {
        statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
        errorCode = 'SYS_INTERNAL_ERROR';
        message = 'Database query operation failed';
      }
    } else {
      // Unhandled generic errors
      const err = exception as Error;
      this.logger.error(
        `Unhandled Exception [${(err as any)?.constructor?.name ?? 'Unknown'}]: ${err?.message || exception}`,
        err?.stack,
      );

      const errMsg = String(err?.message || exception).toLowerCase();
      const errCode = (err as any)?.code;
      if (
        errCode === 'ECONNREFUSED' ||
        errCode === 'ETIMEDOUT' ||
        errCode === 'ENOTFOUND' ||
        errCode === 'EPIPE' ||
        errCode === 'ECONNRESET' ||
        errMsg.includes('connection') ||
        errMsg.includes('connect') ||
        errMsg.includes('database down') ||
        errMsg.includes('checkout timeout')
      ) {
        statusCode = HttpStatus.SERVICE_UNAVAILABLE;
        errorCode = 'SYS_SERVICE_UNAVAILABLE';
        message =
          'Database service is temporarily unavailable. Please try again later.';
      }
    }

    // Map status codes to custom error codes if they weren't explicitly set above
    if (
      errorCode === 'SYS_INTERNAL_ERROR' &&
      statusCode !== HttpStatus.INTERNAL_SERVER_ERROR
    ) {
      switch (statusCode) {
        case HttpStatus.BAD_REQUEST:
          errorCode = 'VAL_INVALID_INPUT';
          break;
        case HttpStatus.UNAUTHORIZED: {
          const msgStr = String(message).toLowerCase();
          if (msgStr.includes('expired')) {
            errorCode = 'AUTH_TOKEN_EXPIRED';
          } else if (
            msgStr.includes('missing') ||
            msgStr.includes('authorization')
          ) {
            errorCode = 'AUTH_MISSING_TOKEN';
          } else {
            errorCode = 'AUTH_INVALID_TOKEN';
          }
          break;
        }
        case HttpStatus.FORBIDDEN:
          errorCode = 'RES_FORBIDDEN';
          break;
        case HttpStatus.NOT_FOUND:
          errorCode = 'RES_NOT_FOUND';
          break;
        case HttpStatus.CONFLICT:
          errorCode = 'RES_ALREADY_EXISTS';
          break;
        case HttpStatus.PRECONDITION_FAILED:
          errorCode = 'CON_VERSION_CONFLICT';
          break;
        case HttpStatus.TOO_MANY_REQUESTS:
          errorCode = 'CON_LIMIT_RATE';
          break;
        case HttpStatus.SERVICE_UNAVAILABLE:
          errorCode = 'SYS_SERVICE_UNAVAILABLE';
          break;
        case HttpStatus.GATEWAY_TIMEOUT:
          errorCode = 'SYS_TIMEOUT';
          break;
      }
    }

    // Define retryability based on error classifications
    const retryable = [
      'CON_VERSION_CONFLICT',
      'CON_LIMIT_RATE',
      'SYS_SERVICE_UNAVAILABLE',
      'SYS_TIMEOUT',
    ].includes(errorCode);

    const errorPayload: Record<string, any> = {
      success: false,
      message: typeof message === 'string' ? message : String(message),
      errorCode,
    };

    if (statusCode === HttpStatus.INTERNAL_SERVER_ERROR) {
      const errorId = randomUUID();
      const correlationId =
        request.headers['x-correlation-id'] ||
        request.headers['x-request-id'] ||
        randomUUID();
      const err = exception as Error;

      this.logger.error(
        JSON.stringify({
          message: `Unexpected 500 Internal Server Error: ${err?.message || exception}`,
          path: redactUrl(request.url), // SEC-W2: no token/email query values in logs
          userId: request.user?.id || null,
          correlationId,
          errorId,
          serviceName: 'HttpExceptionFilter',
          timestamp: new Date().toISOString(),
          stack: err?.stack || null,
        }),
      );

      errorPayload.message =
        'An unexpected error occurred. Please try again later.';
      errorPayload.errorId = errorId;
    } else {
      errorPayload.data = null;
      errorPayload.statusCode = statusCode;
      errorPayload.timestamp = new Date().toISOString();
      errorPayload.path = request.url;
      errorPayload.details = details;
      errorPayload.retryable = retryable;
    }

    // If this is a rate-limit response, provide user-friendly message and headers
    if (statusCode === HttpStatus.TOO_MANY_REQUESTS) {
      // Override the framework exception message — never expose "ThrottlerException: Too Many Requests"
      errorPayload.message =
        'Too many requests. Please wait a few seconds and try again.';

      const throttleCtx = request.throttleContext || {};
      const retryAfterSec = throttleCtx.retryAfter || 60;

      // Set informative headers for clients
      try {
        response.setHeader('Retry-After', String(retryAfterSec));
        if (throttleCtx.limit) {
          response.setHeader('X-RateLimit-Limit', String(throttleCtx.limit));
        }
        if (typeof throttleCtx.remaining !== 'undefined') {
          response.setHeader(
            'X-RateLimit-Remaining',
            String(throttleCtx.remaining),
          );
        }
      } catch (e) {
        // ignore header set errors
      }

      errorPayload.retryAfter = retryAfterSec;

      // Structured logging for rate limit exceeded
      try {
        const timestamp = new Date().toISOString();
        const method = request.method;
        const url = redactUrl(request.url); // SEC-W2: redact sensitive query values
        const userId =
          request.user?.id ||
          request.user?.userId ||
          throttleCtx.userId ||
          'anonymous';
        const ip =
          request.ip ||
          request.headers['x-forwarded-for'] ||
          request.socket?.remoteAddress ||
          null;
        const responseTime = request.startTime
          ? `${Date.now() - request.startTime}ms`
          : 'N/A';

        this.logger.warn(
          JSON.stringify({
            timestamp,
            method,
            url,
            userId,
            ip,
            status: statusCode,
            responseTime,
            throttleKey: throttleCtx.throttleKey || ip,
            profile: throttleCtx.profile || 'unknown',
            limit: throttleCtx.limit ?? 'N/A',
            remaining: throttleCtx.remaining ?? 'N/A',
          }),
        );
      } catch {
        // audit logging is best-effort — never let it break the error response
      }
    }

    response.status(statusCode).send(errorPayload);
  }
}
