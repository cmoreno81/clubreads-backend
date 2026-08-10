import { spawn } from 'node:child_process';
import { resolve, sep } from 'node:path';

export function postgresEnvironment(rawUrl: string) {
  const url = new URL(rawUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('La conexión debe usar PostgreSQL');
  }

  const { DATABASE_URL: _databaseUrl, ...baseEnvironment } = process.env;
  const environment: NodeJS.ProcessEnv = {
    ...baseEnvironment,
    PGHOST: url.hostname,
    PGPORT: url.port || '5432',
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
  };
  const sslMode = url.searchParams.get('sslmode');
  if (sslMode) environment.PGSSLMODE = sslMode;
  return environment;
}

export function assertOutsideRepository(candidate: string) {
  const repository = resolve(process.cwd());
  const target = resolve(candidate);
  if (target === repository || target.startsWith(`${repository}${sep}`)) {
    throw new Error('La ruta de backup debe estar fuera del repositorio');
  }
  return target;
}

export function assertSafeRestoreTarget(rawUrl: string) {
  const url = new URL(rawUrl);
  const databaseName = decodeURIComponent(url.pathname.slice(1));
  if (!['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) {
    throw new Error('La restauración solo admite PostgreSQL local');
  }
  if (!/(test|temp|tmp|restore|scratch|disposable)/i.test(databaseName)) {
    throw new Error('La base de destino debe tener un nombre inequívoco de prueba');
  }
  return databaseName;
}

export function runSafe(
  command: string,
  args: string[],
  environment: NodeJS.ProcessEnv = process.env,
) {
  return new Promise<void>((resolveRun, reject) => {
    const child = spawn(command, args, {
      env: environment,
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    child.once('error', () =>
      reject(new Error(`No se pudo ejecutar ${command}`)),
    );
    child.once('exit', (code) =>
      code === 0
        ? resolveRun()
        : reject(new Error(`${command} terminó con código ${code}`)),
    );
  });
}
