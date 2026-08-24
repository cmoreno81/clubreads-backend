import { prisma } from '../prisma.js';
import {
  canonicalBookKey,
  findBookByIdentity,
  normalizeBookIsbn,
} from './book-identity.service.js';

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

function strings(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(strings);
  if (typeof value === 'string') return [value.trim()].filter(Boolean);
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return strings(object.name ?? object.value ?? '');
  }
  return [];
}

function jsonLdBlocks(html: string) {
  const blocks: unknown[] = [];
  const regex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
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
  if (!value || typeof value !== 'object') return [];
  const object = value as Record<string, unknown>;
  return [
    object,
    ...flattenJsonLd(object['@graph']),
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
    const type = strings(node['@type']).join(' ').toLowerCase();
    if (!type.includes('book') && !type.includes('product')) continue;
    const title = strings(node.name ?? node.headline)[0];
    const rawDate = strings(
      node.datePublished ?? node.releaseDate ?? node.availabilityStarts,
    )[0];
    if (!title || !rawDate) continue;
    const publicationDate = new Date(rawDate);
    if (Number.isNaN(publicationDate.getTime()) || publicationDate <= now) continue;
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
      externalId: strings(node['@id'] ?? node.sku)[0] ?? null,
    });
  }
  return [...results.values()];
}

export async function fetchUpcomingSource(source: string, url: string) {
  const response = await fetch(url, {
    headers: {
      'user-agent': 'ClubReads metadata sync/1.0 (+contacto editorial)',
      accept: 'text/html,application/xhtml+xml',
    },
  });
  if (!response.ok) throw new Error(`${source}: HTTP ${response.status}`);
  return parseUpcomingJsonLd(await response.text(), source, url);
}

export async function saveUpcomingBooks(items: ExternalUpcomingBook[]) {
  const fallbackGenre = await prisma.genre.upsert({
    where: { name: 'Sin género' },
    update: {},
    create: { name: 'Sin género' },
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
    };
    const book = existing
      ? await prisma.book.update({ where: { id: existing.id }, data })
      : await prisma.book.create({
          data: {
            title: item.title.trim(),
            authorId: author?.id,
            genreId: genre.id,
            canonicalKey: canonicalBookKey(item.title, author?.name ?? ''),
            ...data,
          },
        });
    existing ? updated++ : created++;
    await prisma.bookSource.upsert({
      where: { source_sourceUrl: { source: item.source, sourceUrl: item.sourceUrl } },
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
