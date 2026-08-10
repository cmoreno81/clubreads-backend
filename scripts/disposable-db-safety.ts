const EXPECTED_DATABASE = 'clubreads_disposable_test';
const ALLOWED_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const ALLOWED_PORTS = new Set(['55432']);
const RAILWAY_PATTERN = /(^|\.)railway\.app$|(^|\.)rlwy\.net$|railway/i;

export type DisposableDatabaseTarget = {
  host: string;
  port: string;
  database: string;
  locality: 'local' | 'remote';
};

export function inspectDisposableDatabaseUrl(
  rawUrl = process.env.DATABASE_URL,
): DisposableDatabaseTarget {
  if (!rawUrl) throw new Error('DATABASE_URL no está definida');

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('DATABASE_URL no se puede interpretar; operación cancelada');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('DATABASE_URL no usa PostgreSQL; operación cancelada');
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  const host = url.hostname.toLowerCase();
  const port = url.port || '5432';
  const locality = ALLOWED_HOSTS.has(host) ? 'local' : 'remote';

  if (!host || !database || !url.username) {
    throw new Error('DATABASE_URL está incompleta; operación cancelada');
  }
  if (RAILWAY_PATTERN.test(host)) {
    throw new Error('Los destinos Railway están prohibidos');
  }
  if (locality !== 'local') throw new Error('Los hosts remotos están prohibidos');
  if (database !== EXPECTED_DATABASE) {
    throw new Error(`La base debe llamarse exactamente ${EXPECTED_DATABASE}`);
  }
  if (!ALLOWED_PORTS.has(port)) {
    throw new Error('El puerto debe ser el puerto local desechable 55432');
  }
  return { host, port, database, locality };
}

export function assertDisposableDatabaseWritesAllowed(
  rawUrl = process.env.DATABASE_URL,
) {
  const target = inspectDisposableDatabaseUrl(rawUrl);
  if (process.env.ALLOW_DISPOSABLE_DB_WRITES !== 'true') {
    throw new Error('Se exige ALLOW_DISPOSABLE_DB_WRITES=true');
  }
  return target;
}

export function printDisposableTarget(target: DisposableDatabaseTarget) {
  console.log(`Host: ${target.host}`);
  console.log(`Puerto: ${target.port}`);
  console.log(`Base: ${target.database}`);
  console.log(`Destino: ${target.locality}`);
}

if (process.argv[1]?.endsWith('disposable-db-safety.ts')) {
  printDisposableTarget(assertDisposableDatabaseWritesAllowed());
}
