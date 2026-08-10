import { createHmac, randomBytes } from 'node:crypto';
import pino, { type Logger, type LoggerOptions } from 'pino';

const SENSITIVE_KEYS = /authorization|cookie|token|password|passwordhash|code|codigo|email|body|comment|comentario|review|resena|query|url/i;
const REDACTED = '[REDACTED]';
const processHashKey = process.env.LOG_HASH_KEY?.trim() || randomBytes(32).toString('hex');

export function positiveMilliseconds(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export const slowRequestMs = () => positiveMilliseconds(process.env.SLOW_REQUEST_MS, 1_000);
export const slowPrismaQueryMs = () => positiveMilliseconds(process.env.PRISMA_SLOW_QUERY_MS, 500);

function sanitizeString(value: string) {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, `Bearer ${REDACTED}`)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, REDACTED)
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, REDACTED);
}

export function redactSensitive(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: sanitizeString(value.message),
      stack: value.stack ? sanitizeString(value.stack) : undefined,
      ...redactSensitive(Object.fromEntries(Object.entries(value)), seen) as object,
    };
  }
  if (typeof value === 'string') return sanitizeString(value);
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => redactSensitive(item, seen));
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    SENSITIVE_KEYS.test(key) ? REDACTED : redactSensitive(item, seen),
  ]));
}

const options: LoggerOptions = {
  level: process.env.LOG_LEVEL?.trim() || 'info',
  base: undefined,
  timestamp: pino.stdTimeFunctions.isoTime,
  serializers: {
    err: (error) => redactSensitive(error),
  },
  redact: {
    paths: [
      '*.authorization', '*.cookie', '*.set-cookie', '*.token', '*.accessToken',
      '*.refreshToken', '*.password', '*.passwordHash', '*.code', '*.codigo',
      '*.email', '*.body', '*.query', '*.url',
    ],
    censor: REDACTED,
  },
};

export const logger = pino(options);

export function logAt(
  target: Logger,
  level: 'debug' | 'info' | 'warn' | 'error',
  fields: Record<string, unknown>,
  message: string,
) {
  target[level](redactSensitive(fields) as Record<string, unknown>, message);
}

export function correlatedUserId(userId: string | undefined) {
  if (!userId || !process.env.LOG_HASH_KEY?.trim()) return undefined;
  return createHmac('sha256', processHashKey).update(userId).digest('hex').slice(0, 20);
}

export type ErrorCategory =
  | 'validation'
  | 'authentication_authorization'
  | 'rate_limiting'
  | 'external_dependency'
  | 'postgresql_prisma'
  | 'internal';

export function classifyError(error: unknown, status?: number): ErrorCategory {
  if (status === 400 || (error instanceof Error && /validation|pagination/i.test(error.name))) return 'validation';
  if (status === 401 || status === 403) return 'authentication_authorization';
  if (status === 429) return 'rate_limiting';
  if (error instanceof Error && /Prisma|P\d{4}|database|postgres/i.test(`${error.name} ${error.message}`)) return 'postgresql_prisma';
  if (error instanceof Error && /fetch|timeout|AbortError|external/i.test(`${error.name} ${error.message}`)) return 'external_dependency';
  return 'internal';
}

export function errorLevel(status: number) {
  if (status >= 500) return 'error' as const;
  if (status >= 400) return 'warn' as const;
  return 'info' as const;
}

export function backgroundError(event: string, fields: Record<string, unknown> = {}) {
  return (error: unknown) => logAt(logger, 'error', {
    event,
    ...fields,
    err: error,
  }, 'background operation failed');
}
