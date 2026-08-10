import { pathToFileURL } from 'node:url';

import { prisma } from '../prisma.js';
import { runMissingCoverBackfillJob } from '../services/missing-cover-backfill.service.js';

type CommandDependencies = {
  run?: typeof runMissingCoverBackfillJob;
  disconnect?: () => Promise<void>;
  output?: (value: string) => void;
  errorOutput?: (value: string) => void;
};

function parseLimit(args: string[]) {
  const index = args.indexOf('--limit');
  if (index < 0) return undefined;
  const value = Number(args[index + 1]);
  if (!Number.isSafeInteger(value) || value < 1 || value > 500) {
    throw new Error('INVALID_LIMIT');
  }
  return value;
}

export async function main(
  args = process.argv.slice(2),
  dependencies: CommandDependencies = {},
) {
  const run = dependencies.run ?? runMissingCoverBackfillJob;
  const disconnect = dependencies.disconnect ?? (() => prisma.$disconnect());
  const output = dependencies.output ?? console.log;
  const errorOutput = dependencies.errorOutput ?? console.error;
  try {
    const summary = await run({ limit: parseLimit(args) });
    output(JSON.stringify(summary));
    return 0;
  } catch {
    errorOutput(JSON.stringify({
      ok: false,
      error: 'COVER_BACKFILL_FAILED',
      mensaje: 'El trabajo de portadas no pudo completarse',
    }));
    return 1;
  } finally {
    await disconnect();
  }
}

const entrypoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === entrypoint) process.exitCode = await main();
