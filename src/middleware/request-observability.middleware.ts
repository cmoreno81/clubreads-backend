import { randomUUID } from 'node:crypto';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { Logger } from 'pino';
import { ClubContextError } from '../services/club-context.service.js';
import { AuthError } from '../services/auth.service.js';
import { GoodreadsImportError } from '../services/goodreads-import.service.js';
import { HiddenUserSeriesError } from '../services/hidden-user-series.service.js';
import { PaginationError } from '../utils/cursor-pagination.js';

import {
  classifyError,
  correlatedUserId,
  errorLevel,
  logger,
  logAt,
  slowRequestMs,
} from '../logging/logger.js';

const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,100}$/;
const SAFE_ACTION = /^[A-Za-z][A-Za-z0-9]{0,79}$/;
const metrics = new Map<string, {
  requests: number; errors: number; slowRequests: number;
  totalDurationMs: number; maxDurationMs: number;
}>();

export function requestMetricsSnapshot() {
  return Array.from(metrics, ([endpoint, value]) => ({
    endpoint,
    ...value,
    averageDurationMs: value.requests
      ? Math.round((value.totalDurationMs / value.requests) * 100) / 100
      : 0,
  }));
}

export function resetRequestMetrics() {
  metrics.clear();
}

export function safeRequestId(value: unknown) {
  return typeof value === 'string' && SAFE_REQUEST_ID.test(value)
    ? value
    : randomUUID();
}

export function requestObservability(target: Logger = logger): RequestHandler {
  return (req, res, next) => {
    const requestId = safeRequestId(req.get('x-request-id'));
    const started = process.hrtime.bigint();
    res.setHeader('X-Request-ID', requestId);
    res.locals.requestId = requestId;

    res.once('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
      const rawAction = req.query?.action;
      const action = typeof rawAction === 'string' && SAFE_ACTION.test(rawAction)
        ? rawAction
        : undefined;
      const contentLength = Number(res.getHeader('content-length'));
      const status = res.statusCode;
      const slow = durationMs >= slowRequestMs();
      const requestedEndpoint = action ?? req.path;
      const endpoint = metrics.has(requestedEndpoint) || metrics.size < 200
        ? requestedEndpoint
        : 'other';
      const current = metrics.get(endpoint) ?? {
        requests: 0, errors: 0, slowRequests: 0,
        totalDurationMs: 0, maxDurationMs: 0,
      };
      current.requests += 1;
      current.errors += status >= 400 ? 1 : 0;
      current.slowRequests += slow ? 1 : 0;
      current.totalDurationMs += durationMs;
      current.maxDurationMs = Math.max(current.maxDurationMs, durationMs);
      metrics.set(endpoint, current);
      logAt(target, status >= 500 || slow ? 'warn' : 'info', {
        event: 'http_request',
        requestId,
        method: req.method,
        action,
        route: req.path,
        status,
        durationMs: Math.round(durationMs * 100) / 100,
        environment: process.env.NODE_ENV || 'development',
        responseBytes: Number.isSafeInteger(contentLength) && contentLength >= 0
          ? contentLength
          : undefined,
        slow,
        errorCategory: status >= 400 ? classifyError(undefined, status) : undefined,
        userRef: correlatedUserId(req.auth?.userId),
      }, 'request completed');
    });
    next();
  };
}

export function globalErrorHandler(target: Logger = logger): ErrorRequestHandler {
  return (error, _req, res, _next) => {
    const domainError =
      error instanceof ClubContextError ||
      error instanceof AuthError ||
      error instanceof GoodreadsImportError ||
      error instanceof HiddenUserSeriesError;
    const paginationError = error instanceof PaginationError;
    const explicitStatus = domainError
      ? error.statusCode
      : paginationError
        ? 400
        : error?.status;
    const status = typeof explicitStatus === 'number' && explicitStatus >= 400 && explicitStatus < 600
      ? explicitStatus
      : 500;
    logAt(target, errorLevel(status), {
      event: 'request_error',
      requestId: res.locals.requestId,
      status,
      category: classifyError(error, status),
      err: error,
    }, 'request failed');
    if (res.headersSent) return;
    if (status >= 500) {
      return res.status(500).json({
        ok: false,
        error: 'INTERNAL_ERROR',
        mensaje: 'Ha ocurrido un error interno',
      });
    }
    if (status === 403) {
      return res.status(status).json({
        ok: false,
        error: 'FORBIDDEN',
        mensaje: 'No tienes permiso para realizar esta acción',
      });
    }
    if (domainError || paginationError) {
      return res.status(status).json({
        ok: false,
        error: paginationError ? 'INVALID_PAGINATION' : error.code,
        mensaje: error.message,
      });
    }
    return res.status(status).json({
      ok: false,
      error: 'REQUEST_ERROR',
      mensaje: 'La petición no se pudo completar',
    });
  };
}
