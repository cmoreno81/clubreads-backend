import {
  type ExternalUpcomingBook,
  fetchGoogleBooksUpcoming,
  fetchUpcomingFeed,
  fetchUpcomingSource,
  reconcileUpcomingBookSource,
  saveUpcomingBooks,
} from '../services/upcoming-release-sync.service.js';

export type UpcomingSyncSummary = {
  created: number;
  updated: number;
  total: number;
  configuredSources: number;
  errors: string[];
};

const htmlSources = () => [
  ...(process.env.UPCOMING_FNAC_URL
    ? [{ name: 'FNAC España', url: process.env.UPCOMING_FNAC_URL }]
    : []),
  ...(process.env.UPCOMING_CASA_DEL_LIBRO_URL
    ? [{ name: 'Casa del Libro', url: process.env.UPCOMING_CASA_DEL_LIBRO_URL }]
    : []),
];

const feeds = () =>
  (process.env.UPCOMING_FEED_URLS ?? process.env.UPCOMING_FEED_URL ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((url, index) => ({ name: `Feed autorizado ${index + 1}`, url }));

const googleQueries = () =>
  (process.env.UPCOMING_GOOGLE_QUERIES ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

export function hasConfiguredUpcomingSources() {
  return htmlSources().length + feeds().length + googleQueries().length > 0;
}

export async function runConfiguredUpcomingReleaseSync(): Promise<UpcomingSyncSummary> {
  const configuredHtmlSources = htmlSources();
  const configuredFeeds = feeds();
  const configuredQueries = googleQueries();
  const configuredSources =
    configuredHtmlSources.length + configuredFeeds.length + configuredQueries.length;
  const settled: PromiseSettledResult<ExternalUpcomingBook[]>[] = [];
  const successfulHtmlSources: Array<{
    name: string;
    items: ExternalUpcomingBook[];
  }> = [];

  for (const query of configuredQueries) {
    try {
      settled.push({ status: 'fulfilled', value: await fetchGoogleBooksUpcoming(query) });
    } catch (reason) {
      settled.push({ status: 'rejected', reason });
    }
  }
  for (const source of configuredHtmlSources) {
    try {
      const items = await fetchUpcomingSource(source.name, source.url);
      settled.push({
        status: 'fulfilled',
        value: items,
      });
      successfulHtmlSources.push({ name: source.name, items });
    } catch (reason) {
      settled.push({ status: 'rejected', reason });
    }
  }
  for (const feed of configuredFeeds) {
    try {
      settled.push({
        status: 'fulfilled',
        value: await fetchUpcomingFeed(feed.name, feed.url),
      });
    } catch (reason) {
      settled.push({ status: 'rejected', reason });
    }
  }

  const booksByKey = new Map<string, ExternalUpcomingBook>();
  const errors: string[] = [];
  for (const result of settled) {
    if (result.status === 'rejected') {
      errors.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
      continue;
    }
    for (const book of result.value) {
      const key =
        book.isbn?.replace(/\D/g, '') ||
        `${book.title}|${book.author ?? ''}`.toLowerCase();
      booksByKey.set(key, book);
    }
  }

  const summary = await saveUpcomingBooks([...booksByKey.values()]);
  for (const { name, items } of successfulHtmlSources) {
    await reconcileUpcomingBookSource(name, items);
  }
  return { ...summary, configuredSources, errors };
}
