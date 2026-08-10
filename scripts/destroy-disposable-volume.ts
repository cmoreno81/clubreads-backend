import { spawn } from 'node:child_process';
import { inspectDisposableDatabaseUrl, printDisposableTarget } from './disposable-db-safety.js';

printDisposableTarget(inspectDisposableDatabaseUrl());
if (process.env.CONFIRM_DISPOSABLE_VOLUME_DELETE !== 'DELETE_CLUBREADS_DISPOSABLE_VOLUME') {
  throw new Error('Segunda autorización requerida: CONFIRM_DISPOSABLE_VOLUME_DELETE=DELETE_CLUBREADS_DISPOSABLE_VOLUME');
}

await new Promise<void>((resolve, reject) => {
  const child = spawn('docker', [
    'compose', '--env-file', '.env.disposable', '-f',
    'docker-compose.disposable.yml', 'down', '--volumes',
  ], { stdio: 'inherit' });
  child.once('error', reject);
  child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`docker compose terminó con código ${code}`)));
});
