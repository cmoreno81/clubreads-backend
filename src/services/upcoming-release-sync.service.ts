import { prisma } from "../prisma.js";
import {
  canonicalBookKey,
  findBookByIdentity,
  normalizeBookIsbn,
} from "./book-identity.service.js";

export type ExternalUpcomingBook = {
  title: string;
  author?: string | null;
  isbn?: string | null;
  coverUrl?: string | null;
  publicationDate: Date;
  publisher?: string | null;
  genre?: string | null;
  source: string;
  sourceUrl: string;
  externalId?: string | null;
};

export type ReleaseWindow = "upcoming" | "available";

function strings(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(strings);
  if (typeof value === "string") return [value.trim()].filter(Boolean);
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return strings(object.name ?? object.value ?? "");
  }
  return [];
}

function jsonLdBlocks(html: string) {
  const blocks: unknown[] = [];
  const regex =
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(regex)) {
    try {
      blocks.push(JSON.parse(match[1]!.trim()));
    } catch (_) {
      // Un bloque mal formado no impide procesar el resto de la página.
    }
  }
  return blocks;
}

function flattenJsonLd(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(flattenJsonLd);
  if (!value || typeof value !== "object") return [];
  const object = value as Record<string, unknown>;
  return [
    object,
    ...flattenJsonLd(object["@graph"]),
    ...flattenJsonLd(object.itemListElement),
    ...flattenJsonLd(object.item),
  ];
}

export function parseUpcomingJsonLd(
  html: string,
  source: string,
  pageUrl: string,
  now = new Date(),
): ExternalUpcomingBook[] {
  const results = new Map<string, ExternalUpcomingBook>();
  const nodes = jsonLdBlocks(html).flatMap(flattenJsonLd);
  for (const node of nodes) {
    const type = strings(node["@type"]).join(" ").toLowerCase();
    if (!type.includes("book") && !type.includes("product")) continue;
    const title = strings(node.name ?? node.headline)[0];
    const rawDate = strings(
      node.datePublished ?? node.releaseDate ?? node.availabilityStarts,
    )[0];
    if (!title || !rawDate) continue;
    const publicationDate = new Date(rawDate);
    if (Number.isNaN(publicationDate.getTime()) || publicationDate <= now)
      continue;
    const offers = (node.offers ?? {}) as Record<string, unknown>;
    const sourceUrl = strings(node.url ?? offers.url)[0] ?? pageUrl;
    const author = strings(node.author)[0] ?? null;
    const isbn = strings(node.isbn ?? node.sku ?? node.gtin13)[0] ?? null;
    const image = strings(node.image)[0] ?? null;
    const publisher = strings(node.publisher ?? node.brand)[0] ?? null;
    const genre = strings(node.genre ?? node.category)[0] ?? null;
    const key = normalizeBookIsbn(isbn) ?? canonicalBookKey(title, author);
    results.set(key, {
      title,
      author,
      isbn,
      coverUrl: image,
      publicationDate,
      publisher,
      genre,
      source,
      sourceUrl,
      externalId: strings(node["@id"] ?? node.sku)[0] ?? null,
    });
  }
  return [...results.values()];
}

export async function fetchUpcomingSource(source: string, url: string) {
  if (new URL(url).hostname.endsWith("casadellibro.com")) {
    return fetchCasaDelLibroUpcoming(source, url);
  }
  const response = await fetch(url, {
    headers: {
      "user-agent": "ClubReads metadata sync/1.0 (+contacto editorial)",
      accept: "text/html,application/xhtml+xml",
    },
  });
  if (!response.ok) throw new Error(`${source}: HTTP ${response.status}`);
  return parseUpcomingJsonLd(await response.text(), source, url);
}

function htmlAttribute(tag: string, name: string) {
  const match = tag.match(
    new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i"),
  );
  return match?.[1]?.trim() || null;
}

function metaContent(html: string, key: string) {
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0];
    if (
      htmlAttribute(tag, "property")?.toLowerCase() === key.toLowerCase() ||
      htmlAttribute(tag, "name")?.toLowerCase() === key.toLowerCase()
    ) {
      return htmlAttribute(tag, "content");
    }
  }
  return null;
}

export function extractCasaDelLibroProductUrls(html: string, pageUrl: string) {
  const urls = new Set<string>();
  const pattern = /href=["'](\/libro-[^"'?#]+\/[0-9Xx-]{10,17}\/[0-9]+)["']/gi;
  for (const match of html.matchAll(pattern)) {
    urls.add(new URL(match[1]!, pageUrl).toString());
  }
  return [...urls];
}

function casaDelLibroGenreUrl(html: string) {
  const nodes = jsonLdBlocks(html).flatMap(flattenJsonLd);
  for (const node of nodes) {
    const type = strings(node["@type"]).join(" ").toLowerCase();
    if (!type.includes("book") && !type.includes("product")) continue;
    const genre = strings(node.genre)[0];
    if (genre) return genre;
  }
  return null;
}

function casaDelLibroLanguage(html: string) {
  const nodes = jsonLdBlocks(html).flatMap(flattenJsonLd);
  for (const node of nodes) {
    const type = strings(node["@type"]).join(" ").toLowerCase();
    if (!type.includes("book") && !type.includes("product")) continue;
    const language = strings(node.inLanguage)[0]?.toLowerCase();
    if (language) return language.split(/[-_]/)[0];
  }
  const embeddedLanguage = html.match(
    /["']inLanguage["']\s*:\s*["']([a-z]{2}(?:[-_][a-z]{2})?)["']/i,
  )?.[1];
  return embeddedLanguage?.toLowerCase().split(/[-_]/)[0] ?? null;
}

/**
 * Casa del Libro mezcla ficción y no ficción en su página general de
 * lanzamientos. Usamos una lista positiva: una categoría desconocida no se
 * publica hasta poder clasificarla con seguridad.
 */
export function classifyCasaDelLibroFictionGenre(genreUrl: string | null) {
  if (!genreUrl) return null;
  const path = (() => {
    try {
      return new URL(genreUrl, "https://www.casadellibro.com").pathname.toLowerCase();
    } catch (_) {
      return genreUrl.toLowerCase();
    }
  })();
  const isFiction =
    path.startsWith("/libros/literatura/") ||
    path.startsWith("/libros/juvenil/") ||
    path.startsWith("/libros/comics/") ||
    path.startsWith("/libros/comics-y-manga-infantil-y-juvenil/");
  if (!isFiction) return null;

  if (/romantica|romantica-y-erotica|romance/.test(path)) return "Romance";
  if (/fantasia|fantastica|fantasy|magia/.test(path)) {
    return path.includes("/juvenil/") ? "Fantasía juvenil" : "Fantasía";
  }
  if (/novela-negra|thriller|policiaca|misterio/.test(path)) return "Thriller";
  if (/historica/.test(path)) return "Novela histórica";
  if (/terror/.test(path)) return "Terror";
  if (/comic|manga|novela-grafica/.test(path)) return "Cómic";
  if (/juvenil/.test(path)) return "Juvenil";
  return "Narrativa";
}

export function parseCasaDelLibroDetail(
  html: string,
  source: string,
  sourceUrl: string,
  now = new Date(),
  window: ReleaseWindow = "upcoming",
): ExternalUpcomingBook | null {
  const rawDate = metaContent(html, "book:release_date");
  const titleParts = (metaContent(html, "og:title") ?? "")
    .split("|")
    .map((value) => value.trim())
    .filter(Boolean);
  const title = titleParts[0];
  if (!title || !rawDate || !/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) return null;
  const publicationDate = new Date(`${rawDate}T12:00:00.000Z`);
  const oldestNovelty = new Date(now);
  oldestNovelty.setMonth(oldestNovelty.getMonth() - 9);
  const outsideWindow = window === "upcoming"
    ? publicationDate <= now
    : publicationDate > now || publicationDate < oldestNovelty;
  if (Number.isNaN(publicationDate.getTime()) || outsideWindow) {
    return null;
  }
  const isbn = metaContent(html, "book:isbn");
  const publisherPart = titleParts.find((value) =>
    /^editorial\s+/i.test(value),
  );
  const language = casaDelLibroLanguage(html);
  if (language && language !== "es") return null;
  const genre = classifyCasaDelLibroFictionGenre(casaDelLibroGenreUrl(html));
  if (!genre) return null;
  return {
    title,
    author: metaContent(html, "book:author"),
    isbn,
    coverUrl: metaContent(html, "og:image"),
    publicationDate,
    publisher: publisherPart?.replace(/^editorial\s+/i, "") ?? null,
    genre,
    source,
    sourceUrl,
    externalId: sourceUrl.split("/").filter(Boolean).at(-1) ?? null,
  };
}

async function fetchText(source: string, url: string) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(10_000),
    headers: {
      "user-agent": "ClubReads metadata sync/1.0 (+contacto editorial)",
      accept: "text/html,application/xhtml+xml",
      "accept-language": "es-ES,es;q=0.9",
    },
  });
  if (!response.ok) throw new Error(`${source}: HTTP ${response.status}`);
  return response.text();
}

export async function fetchCasaDelLibroUpcoming(
  source: string,
  pageUrl: string,
  window: ReleaseWindow = "upcoming",
) {
  const listingHtml = await fetchText(source, pageUrl);
  const productUrls = extractCasaDelLibroProductUrls(listingHtml, pageUrl);
  const results: ExternalUpcomingBook[] = [];
  // Una concurrencia pequeña evita castigar al proveedor y mantiene el proceso
  // dentro del tiempo razonable de un trabajo periódico.
  for (let index = 0; index < productUrls.length; index += 4) {
    const batch = productUrls.slice(index, index + 4);
    const settled = await Promise.allSettled(
      batch.map(async (productUrl) =>
        parseCasaDelLibroDetail(
          await fetchText(source, productUrl),
          source,
          productUrl,
          new Date(),
          window,
        ),
      ),
    );
    for (const result of settled) {
      if (result.status === "fulfilled" && result.value) results.push(result.value);
    }
  }
  const unique = new Map<string, ExternalUpcomingBook>();
  for (const item of results) {
    unique.set(normalizeBookIsbn(item.isbn) ?? canonicalBookKey(item.title, item.author), item);
  }
  return [...unique.values()];
}

type UpcomingFeedItem = {
  title?: unknown;
  author?: unknown;
  isbn?: unknown;
  coverUrl?: unknown;
  publicationDate?: unknown;
  publisher?: unknown;
  genre?: unknown;
  sourceUrl?: unknown;
  externalId?: unknown;
};

export function parseUpcomingFeed(
  payload: unknown,
  source: string,
  feedUrl: string,
  now = new Date(),
): ExternalUpcomingBook[] {
  const rawItems = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object"
      ? ((payload as { items?: unknown }).items ?? [])
      : [];
  if (!Array.isArray(rawItems)) {
    throw new Error(
      `${source}: el feed debe ser una lista o un objeto con "items"`,
    );
  }
  const results = new Map<string, ExternalUpcomingBook>();
  for (const rawItem of rawItems) {
    if (!rawItem || typeof rawItem !== "object") continue;
    const item = rawItem as UpcomingFeedItem;
    const title = strings(item.title)[0];
    const rawDate = strings(item.publicationDate)[0];
    if (!title || !rawDate || !/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) continue;
    const publicationDate = new Date(`${rawDate}T12:00:00.000Z`);
    if (Number.isNaN(publicationDate.getTime()) || publicationDate <= now)
      continue;
    const author = strings(item.author)[0] ?? null;
    const isbn = strings(item.isbn)[0] ?? null;
    const sourceUrl = strings(item.sourceUrl)[0] ?? feedUrl;
    const key = normalizeBookIsbn(isbn) ?? canonicalBookKey(title, author);
    results.set(key, {
      title,
      author,
      isbn,
      coverUrl: strings(item.coverUrl)[0] ?? null,
      publicationDate,
      publisher: strings(item.publisher)[0] ?? null,
      genre: strings(item.genre)[0] ?? null,
      source,
      sourceUrl,
      externalId: strings(item.externalId)[0] ?? null,
    });
  }
  return [...results.values()];
}

export async function fetchUpcomingFeed(source: string, url: string) {
  const response = await fetch(url, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`${source}: HTTP ${response.status}`);
  return parseUpcomingFeed(await response.json(), source, url);
}

type GoogleBooksResponse = {
  items?: Array<{
    id?: string;
    volumeInfo?: {
      title?: string;
      authors?: string[];
      publisher?: string;
      publishedDate?: string;
      industryIdentifiers?: Array<{ type?: string; identifier?: string }>;
      imageLinks?: { thumbnail?: string; smallThumbnail?: string };
      categories?: string[];
      infoLink?: string;
      language?: string;
    };
  }>;
};

export function parseGoogleBooksUpcoming(
  payload: GoogleBooksResponse,
  now = new Date(),
): ExternalUpcomingBook[] {
  const results = new Map<string, ExternalUpcomingBook>();
  for (const item of payload.items ?? []) {
    const info = item.volumeInfo;
    const title = info?.title?.trim();
    const rawDate = info?.publishedDate?.trim();
    if (!title || !rawDate || !/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) continue;
    const publicationDate = new Date(`${rawDate}T12:00:00.000Z`);
    if (Number.isNaN(publicationDate.getTime()) || publicationDate <= now)
      continue;
    const author = info?.authors?.[0]?.trim() || null;
    const isbn =
      info?.industryIdentifiers?.find((value) => value.type === "ISBN_13")
        ?.identifier ??
      info?.industryIdentifiers?.find((value) => value.type === "ISBN_10")
        ?.identifier ??
      null;
    const coverUrl = (
      info?.imageLinks?.thumbnail ??
      info?.imageLinks?.smallThumbnail ??
      null
    )?.replace(/^http:/, "https:");
    const key = normalizeBookIsbn(isbn) ?? canonicalBookKey(title, author);
    results.set(key, {
      title,
      author,
      isbn,
      coverUrl,
      publicationDate,
      publisher: info?.publisher?.trim() || null,
      genre: info?.categories?.[0]?.trim() || null,
      source: "Google Books",
      sourceUrl:
        info?.infoLink ??
        `https://books.google.com/books?id=${encodeURIComponent(item.id ?? "")}`,
      externalId: item.id ?? null,
    });
  }
  return [...results.values()];
}

export async function fetchGoogleBooksUpcoming(query: string) {
  const url = new URL("https://www.googleapis.com/books/v1/volumes");
  url.searchParams.set("q", query);
  url.searchParams.set("printType", "books");
  url.searchParams.set("langRestrict", "es");
  url.searchParams.set("maxResults", "20");
  if (process.env.GOOGLE_BOOKS_API_KEY) {
    url.searchParams.set("key", process.env.GOOGLE_BOOKS_API_KEY);
  }
  const response = await fetch(url, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Google Books: HTTP ${response.status}`);
  return parseGoogleBooksUpcoming(
    (await response.json()) as GoogleBooksResponse,
  );
}

export async function saveUpcomingBooks(items: ExternalUpcomingBook[]) {
  const fallbackGenre = await prisma.genre.upsert({
    where: { name: "Sin género" },
    update: {},
    create: { name: "Sin género" },
  });
  let created = 0;
  let updated = 0;
  for (const item of items) {
    const author = item.author?.trim()
      ? await prisma.author.upsert({
          where: { name: item.author.trim() },
          update: {},
          create: { name: item.author.trim() },
        })
      : null;
    const genre = item.genre?.trim()
      ? await prisma.genre.upsert({
          where: { name: item.genre.trim() },
          update: {},
          create: { name: item.genre.trim() },
        })
      : fallbackGenre;
    const existing = await findBookByIdentity(prisma, {
      title: item.title,
      authorName: author?.name,
      isbn: item.isbn,
    });
    const normalizedIsbn = normalizeBookIsbn(item.isbn);
    const data = {
      publicationDate: item.publicationDate,
      publicationYear: item.publicationDate.getFullYear(),
      publisher: item.publisher?.trim() || undefined,
      coverUrl: item.coverUrl?.trim() || undefined,
      isbn: item.isbn?.trim() || undefined,
      normalizedIsbn: normalizedIsbn ?? undefined,
      genreId: genre.id,
    };
    const book = existing
      ? await prisma.book.update({ where: { id: existing.id }, data })
      : await prisma.book.create({
          data: {
            title: item.title.trim(),
            authorId: author?.id,
            canonicalKey: canonicalBookKey(item.title, author?.name ?? ""),
            ...data,
          },
        });
    existing ? updated++ : created++;
    await prisma.bookSource.upsert({
      where: {
        source_sourceUrl: { source: item.source, sourceUrl: item.sourceUrl },
      },
      update: {
        bookId: book.id,
        externalId: item.externalId,
        lastCheckedAt: new Date(),
      },
      create: {
        bookId: book.id,
        source: item.source,
        sourceUrl: item.sourceUrl,
        externalId: item.externalId,
      },
    });
  }
  return { created, updated, total: items.length };
}

export async function reconcileUpcomingBookSource(
  source: string,
  activeItems: ExternalUpcomingBook[],
) {
  if (activeItems.length === 0) return 0;
  const activeUrls = activeItems.map(({ sourceUrl }) => sourceUrl);
  const result = await prisma.bookSource.deleteMany({
    where: { source, sourceUrl: { notIn: activeUrls } },
  });
  return result.count;
}
