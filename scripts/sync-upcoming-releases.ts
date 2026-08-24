import "dotenv/config";
import {
  type ExternalUpcomingBook,
  fetchGoogleBooksUpcoming,
  fetchUpcomingFeed,
  fetchUpcomingSource,
  saveUpcomingBooks,
} from "../src/services/upcoming-release-sync.service.js";
import { prisma } from "../src/prisma.js";

const htmlSources = [
  ...(process.env.UPCOMING_FNAC_URL
    ? [{ name: "FNAC España", url: process.env.UPCOMING_FNAC_URL }]
    : []),
  ...(process.env.UPCOMING_CASA_DEL_LIBRO_URL
    ? [{ name: "Casa del Libro", url: process.env.UPCOMING_CASA_DEL_LIBRO_URL }]
    : []),
];

const jsonFeeds = (
  process.env.UPCOMING_FEED_URLS ??
  process.env.UPCOMING_FEED_URL ??
  ""
)
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean)
  .map((url, index) => ({ name: `Feed autorizado ${index + 1}`, url }));

const googleQueries = (process.env.UPCOMING_GOOGLE_QUERIES ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

try {
  const settled: PromiseSettledResult<ExternalUpcomingBook[]>[] = [];
  // Secuencial para no agotar la cuota ni provocar respuestas 503 del
  // proveedor al lanzar varias búsquedas simultáneas.
  for (const query of googleQueries) {
    try {
      settled.push({
        status: "fulfilled",
        value: await fetchGoogleBooksUpcoming(query),
      });
    } catch (reason) {
      settled.push({ status: "rejected", reason });
    }
  }
  for (const source of htmlSources) {
    try {
      settled.push({
        status: "fulfilled",
        value: await fetchUpcomingSource(source.name, source.url),
      });
    } catch (reason) {
      settled.push({ status: "rejected", reason });
    }
  }
  for (const feed of jsonFeeds) {
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
  for (const result of settled) {
    if (result.status !== "fulfilled") continue;
    for (const book of result.value) {
      const key =
        book.isbn?.replace(/\D/g, "") ||
        `${book.title}|${book.author ?? ""}`.toLowerCase();
      booksByKey.set(key, book);
    }
  }
  const books = [...booksByKey.values()];
  for (const result of settled) {
    if (result.status === "rejected") console.error(result.reason);
  }
  const summary = await saveUpcomingBooks(books);
  console.log(JSON.stringify(summary, null, 2));
  if (settled.length === 0) {
    console.warn(
      "No hay fuentes configuradas. Usa UPCOMING_FEED_URL con un feed JSON autorizado.",
    );
  } else if (summary.total === 0) {
    console.warn(
      "Las fuentes no devolvieron ningún lanzamiento futuro válido.",
    );
  }
} finally {
  await prisma.$disconnect();
}
