import { Injectable, Logger } from '@nestjs/common';
import { redactSensitiveKeys } from '../common/log-redaction.util';

export type ObservabilityLevel = 'log' | 'warn' | 'error';

/**
 * Secret-free structured observability emitter (BATCH-04 / W-PLAT-02).
 *
 * Future migration and security batches call `record(...)` to emit structured,
 * machine-parseable signals (state counts, decisions, failure counts, rollback
 * triggers) that an external log aggregator / dashboard can consume. It emits
 * ONE JSON line per event via the NestJS Logger — no new package, no external
 * backend wired in (the choice of metrics/dashboard backend is a deferred
 * infrastructure decision).
 *
 * SEC-W2 / SEC-W7: metadata is passed through `redactSensitiveKeys`, so known
 * sensitive keys (email, tokens, secrets, …) can never enter an observability
 * line. Callers must still avoid placing E2EE plaintext or raw PII in metadata.
 */
@Injectable()
export class ObservabilityService {
  private readonly logger = new Logger('Observability');

  /**
   * Emit one structured, sanitized observability event.
   * @param event  short stable event name, e.g. `migration.p2p_note.backfill`.
   * @param metadata safe, non-sensitive fields (counts, ids, decisions).
   * @param level  log level (default `log`).
   */
  record(
    event: string,
    metadata: Record<string, unknown> = {},
    level: ObservabilityLevel = 'log',
  ): void {
    const safe = redactSensitiveKeys(metadata);
    const line = JSON.stringify({
      event,
      ...safe,
      timestamp: new Date().toISOString(),
    });
    this.logger[level](line);
  }
}
