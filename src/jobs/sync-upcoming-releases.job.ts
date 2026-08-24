import {
  type ExternalUpcomingBook,
  fetchGoogleBooksUpcoming,
  fetchUpcomingFeed,
  fetchUpcomingSource,
  fetchCasaDelLibroUpcoming,
  reconcileUpcomingBookSource,
  saveUpcomingBooks,
  syncCasaDelLibroCliches,
} from "../services/upcoming-release-sync.service.js";

export type UpcomingSyncSummary = {
  created: number;
  updated: number;
  total: number;
  configuredSources: number;
  errors: string[];
};

const htmlSources = () => [
  ...(process.env.UPCOMING_FNAC_URL
    ? [{ name: "FNAC España", url: process.env.UPCOMING_FNAC_URL }]
    : []),
  ...(process.env.UPCOMING_CASA_DEL_LIBRO_URL
    ? [{ name: "Casa del Libro", url: process.env.UPCOMING_CASA_DEL_LIBRO_URL }]
    : []),
];

const noveltySources = () => [
  {
    name: "Casa del Libro · Novedades ficción",
    url:
      process.env.NEW_RELEASES_CASA_DEL_LIBRO_URL ??
      "https://www.casadellibro.com/novedades-libros",
  },
  {
    name: "Casa del Libro · Novedades juvenil",
    url:
      process.env.NEW_RELEASES_CASA_DEL_LIBRO_JUVENILE_URL ??
      "https://www.casadellibro.com/libros/juvenil/473000000/ordenar11?idioma=7",
  },
];

const feeds = () =>
  (process.env.UPCOMING_FEED_URLS ?? process.env.UPCOMING_FEED_URL ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((url, index) => ({ name: `Feed autorizado ${index + 1}`, url }));

const googleQueries = () =>
  (process.env.UPCOMING_GOOGLE_QUERIES ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

export function hasConfiguredUpcomingSources() {
  return (
    htmlSources().length +
      noveltySources().length +
      feeds().length +
      googleQueries().length >
    0
  );
}

export async function runConfiguredUpcomingReleaseSync(): Promise<UpcomingSyncSummary> {
  const configuredHtmlSources = htmlSources();
  const configuredNoveltySources = noveltySources();
  const configuredFeeds = feeds();
  const configuredQueries = googleQueries();
  const configuredSources =
    configuredHtmlSources.length +
    configuredNoveltySources.length +
    configuredFeeds.length +
    configuredQueries.length;
  const settled: PromiseSettledResult<ExternalUpcomingBook[]>[] = [];
  const successfulHtmlSources: Array<{
    name: string;
    items: ExternalUpcomingBook[];
  }> = [];

  for (const query of configuredQueries) {
    try {
      settled.push({
        status: "fulfilled",
        value: await fetchGoogleBooksUpcoming(query),
      });
    } catch (reason) {
      settled.push({ status: "rejected", reason });
    }
  }
  for (const source of configuredHtmlSources) {
    try {
      const items = await fetchUpcomingSource(source.name, source.url);
      settled.push({
        status: "fulfilled",
        value: items,
      });
      successfulHtmlSources.push({ name: source.name, items });
    } catch (reason) {
      settled.push({ status: "rejected", reason });
    }
  }
  for (const source of configuredNoveltySources) {
    try {
      const items = await fetchCasaDelLibroUpcoming(
        source.name,
        source.url,
        "available",
      );
      settled.push({ status: "fulfilled", value: items });
      successfulHtmlSources.push({ name: source.name, items });
    } catch (reason) {
      settled.push({ status: "rejected", reason });
    }
  }
  for (const feed of configuredFeeds) {
    try {
      settled.push({
        status: "fulfilled",
        value: await fetchUpcomingFeed(feed.name, feed.url),
      });
    } catch (reason) {
      settled.push({ status: "rejected", reason });
    }
  }

  const booksByKey = new Map<string, ExternalUpcomingBook>();
  const errors: string[] = [];
  for (const result of settled) {
    if (result.status === "rejected") {
      errors.push(
        result.reason instanceof Error
          ? result.reason.message
          : String(result.reason),
      );
      continue;
    }
    for (const book of result.value) {
      const key =
        book.isbn?.replace(/\D/g, "") ||
        `${book.title}|${book.author ?? ""}`.toLowerCase();
      booksByKey.set(key, book);
    }
  }

  const summary = await saveUpcomingBooks([...booksByKey.values()]);
  for (const { name, items } of successfulHtmlSources) {
    await reconcileUpcomingBookSource(name, items);
  }
  try {
    await syncCasaDelLibroCliches(
      process.env.CASA_DEL_LIBRO_CLICHES_URL ??
        "https://www.casadellibro.com/libros-juveniles-segun-su-cliche",
    );
  } catch (reason) {
    errors.push(
      reason instanceof Error
        ? `Casa del Libro · Clichés: ${reason.message}`
        : `Casa del Libro · Clichés: ${String(reason)}`,
    );
  }
  return { ...summary, configuredSources, errors };
}
