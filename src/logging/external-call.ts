import type { Logger } from 'pino';
import { logger, logAt } from './logger.js';

export async function observeExternalCall<T>(
  provider: string,
  operation: string,
  execute: () => Promise<T>,
  target: Logger = logger,
) {
  const started = process.hrtime.bigint();
  try {
    const result = await execute();
    const status = typeof (result as { status?: unknown })?.status === 'number'
      ? (result as { status: number }).status
      : undefined;
    logAt(target, status && status >= 500 ? 'warn' : 'info', {
      event: 'external_call', provider, operation,
      durationMs: Math.round(Number(process.hrtime.bigint() - started) / 10_000) / 100,
      status,
    }, 'external call completed');
    return result;
  } catch (error) {
    logAt(target, 'warn', {
      event: 'external_call', provider, operation,
      durationMs: Math.round(Number(process.hrtime.bigint() - started) / 10_000) / 100,
      outcome: error instanceof Error && error.name === 'AbortError' ? 'timeout' : 'error',
      errorCategory: 'external_dependency',
    }, 'external call failed');
    throw error;
  }
}
