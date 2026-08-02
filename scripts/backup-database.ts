import 'dotenv/config';

import { spawn } from 'node:child_process';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL no está definida');

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const output = `/private/tmp/clubreads-pre-canonical-${stamp}.dump`;

function run(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'inherit', 'inherit'] });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} terminó con ${code}`)));
  });
}

const postgresBin = '/opt/homebrew/opt/postgresql@18/bin';
await run(`${postgresBin}/pg_dump`, ['--format=custom', '--no-owner', '--no-acl', `--file=${output}`, connectionString]);
await run(`${postgresBin}/pg_restore`, ['--list', output]);
console.log(JSON.stringify({ ok: true, output }));
