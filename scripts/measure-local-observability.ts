import { EventEmitter } from 'node:events';

import {
  requestMetricsSnapshot,
  requestObservability,
  resetRequestMetrics,
} from '../src/middleware/request-observability.middleware.js';

const actions = [
  'comentariosLectura',
  'dashboardGeneral',
  'historialClubvision',
  'catalogoGeneral',
  'notificaciones',
] as const;

resetRequestMetrics();
for (const action of actions) {
  const response = new EventEmitter() as any;
  const headers = new Map<string, unknown>();
  response.locals = {};
  response.statusCode = 200;
  response.setHeader = (name: string, value: unknown) => headers.set(name.toLowerCase(), value);
  response.getHeader = (name: string) => headers.get(name.toLowerCase());
  await new Promise<void>((resolve) => {
    response.once('finish', resolve);
    requestObservability()({
      method: 'GET', path: '/api', query: { action },
      get: () => undefined,
    } as any, response, () => {
      headers.set('content-length', 2);
      response.emit('finish');
    });
  });
}

process.stdout.write(`${JSON.stringify({
  event: 'local_observability_smoke_summary',
  scope: 'middleware_only_no_database',
  metrics: requestMetricsSnapshot().map((metric) => ({
    endpoint: metric.endpoint,
    requests: metric.requests,
    totalDurationMs: Math.round(metric.totalDurationMs * 100) / 100,
    averageDurationMs: metric.averageDurationMs,
  })),
})}\n`);
