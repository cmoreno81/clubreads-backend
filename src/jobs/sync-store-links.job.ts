import { createReadStream } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createGunzip } from 'node:zlib';

import { prisma } from '../prisma.js';
import { enrichStoreLinksFromPages } from '../services/store-link-page.service.js';
import {
  syncStoreLinks,
  syncStoreLinksFromUrl,
} from '../services/store-link-sync.service.js';

// Uso:
//   npx tsx src/jobs/sync-store-links.job.ts --dry-run
//   npx tsx src/jobs/sync-store-links.job.ts --dry-run --file ~/Downloads/datafeed.csv.gz
//   npx tsx src/jobs/sync-store-links.job.ts --pages-only --limit 5 [--dry-run]
// Sin --file usa AWIN_FEED_URL. --dry-run calcula los cambios sin escribirlos.
export function hasStoreFeedConfigured() {
  return Boolean(process.env.AWIN_FEED_URL?.trim());
}

export async function runStoreLinkSync(options: { dryRun?: boolean } = {}) {
  const url = process.env.AWIN_FEED_URL?.trim();
  if (!url) throw new Error('AWIN_FEED_URL_MISSING');
  return syncStoreLinksFromUrl(url, options);
}

/// Pasada nocturna completa: feed de Awin y, después, los formatos que el feed
/// no trae (ebook, audiolibro) leídos de las fichas. Si lo segundo falla, no
/// invalida lo primero.
export async function runStoreLinkNightly() {
  const feed = await runStoreLinkSync();
  const pages = await enrichStoreLinksFromPages().catch((error) => ({
    error: error instanceof Error ? error.message : String(error),
  }));
  return { feed, pages };
}

export async function main(args = process.argv.slice(2)) {
  const dryRun = args.includes('--dry-run');
  const fileIndex = args.indexOf('--file');
  const limitIndex = args.indexOf('--limit');
  try {
    if (args.includes('--pages-only')) {
      const limit = limitIndex >= 0 ? Number(args[limitIndex + 1]) : undefined;
      console.log(JSON.stringify(await enrichStoreLinksFromPages({ dryRun, limit })));
      return 0;
    }
    const summary =
      fileIndex >= 0
        ? await syncStoreLinks(
            createReadStream(args[fileIndex + 1]!).pipe(createGunzip()),
            { dryRun },
          )
        : await runStoreLinkSync({ dryRun });
    console.log(JSON.stringify(summary));
    return 0;
  } catch (error) {
    console.error(
      JSON.stringify({
        ok: false,
        error: 'STORE_LINK_SYNC_FAILED',
        detalle: error instanceof Error ? error.message : String(error),
      }),
    );
    return 1;
  } finally {
    await prisma.$disconnect();
  }
}

const entrypoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === entrypoint) process.exitCode = await main();
