import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

const password = randomBytes(32).toString('base64url');
const contents = `DISPOSABLE_DB_USER=clubreads_disposable_user
DISPOSABLE_DB_PASSWORD=${password}
DISPOSABLE_DB_PORT=55432
DATABASE_URL=postgresql://clubreads_disposable_user:${password}@127.0.0.1:55432/clubreads_disposable_test
ALLOW_DISPOSABLE_DB_WRITES=false
NODE_ENV=test
PORT=3000
TRUST_PROXY_HOPS=0
AUTH_EMAIL_MODE=capture
AUTH_CODE_CAPTURE_DIR=/tmp/clubreads-auth-codes
EXTERNAL_NOTIFICATIONS_ENABLED=false
CLOUDINARY_WRITES_ENABLED=false
COVER_BACKFILL_ENABLED=false
CRON_ENABLED=false
`;

await writeFile('.env.disposable', contents, { mode: 0o600, flag: 'wx' });
console.log('.env.disposable creado con credenciales locales aleatorias (no mostradas)');
