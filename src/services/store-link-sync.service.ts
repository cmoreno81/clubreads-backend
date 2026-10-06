import { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import { parse } from 'csv-parse';
import { StoreFormat } from '@prisma/client';

import { prisma } from '../prisma.js';
import {
  cargarDeseosSinLibro,
  crearLibrosDeDeseos,
} from './wishlist-book-sync.service.js';

// Sincroniza BookStoreLink con el feed de productos de Casa del Libro (Awin):
// cruza cada libro del catálogo con las fichas de la tienda por ISBN o por
// título + autora, filtrando por idioma de la edición, y deja un enlace por
// libro, formato e idioma. Es la versión automática del cruce que se hizo a
// mano; mantiene las mismas reglas.

const STORE = 'CASA_DEL_LIBRO';
// Si el feed trae menos filas que esto algo ha ido mal (descarga cortada,
// URL equivocada): no se borra nada.
const MIN_ROWS_TO_PRUNE = 100_000;

const FORMAT_BY_CATEGORY: Record<string, StoreFormat> = {
  Libros: StoreFormat.PAPEL,
  Ebooks: StoreFormat.EBOOK,
  Audiolibros: StoreFormat.AUDIO,
};

// ── Normalización y similitud ────────────────────────────────────────────────

function stripAccents(value: string) {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function normTitle(value: string | null | undefined) {
  return stripAccents((value ?? '').toLowerCase())
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(
      /\b(edicion|ed\.|tapa (dura|blanda)|bolsillo|libro|novela|ebook|audiolibro|especial|limitada|coleccionista|bilingue|castellano|espanol)\b/g,
      ' ',
    )
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ');
}

export function authorTokens(value: string | null | undefined) {
  const text = stripAccents((value ?? '').toLowerCase()).replace(/[^a-z ]/g, ' ');
  return new Set(text.split(/\s+/).filter((w) => w.length > 2));
}

export function isbn13(value: string | null | undefined) {
  const d = (value ?? '').replace(/[^0-9Xx]/g, '');
  if (d.length === 13) return d;
  if (d.length === 10) {
    const core = `978${d.slice(0, 9)}`;
    const sum = [...core].reduce(
      (acc, c, i) => acc + (i % 2 === 0 ? 1 : 3) * Number(c),
      0,
    );
    return `${core}${(10 - (sum % 10)) % 10}`;
  }
  return '';
}

// Ratcliff/Obershelp, como difflib.SequenceMatcher.ratio().
function matchingChars(a: string, b: string): number {
  if (!a.length || !b.length) return 0;
  let best = 0;
  let endA = 0;
  let endB = 0;
  let prev = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        cur[j] = prev[j - 1]! + 1;
        if (cur[j]! > best) {
          best = cur[j]!;
          endA = i;
          endB = j;
        }
      }
    }
    prev = cur;
  }
  if (best === 0) return 0;
  return (
    best +
    matchingChars(a.slice(0, endA - best), b.slice(0, endB - best)) +
    matchingChars(a.slice(endA), b.slice(endB))
  );
}

export function titleSimilarity(a: string, b: string) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const sa = new Set(a.split(' '));
  const sb = new Set(b.split(' '));
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  const contain = short.length >= 8 && long.includes(short) ? 0.92 : 0;
  let inter = 0;
  for (const w of sa) if (sb.has(w)) inter++;
  const jaccard = inter / Math.max(1, new Set([...sa, ...sb]).size);
  const ratio = (2 * matchingChars(a, b)) / (a.length + b.length);
  return Math.max(contain, jaccard, ratio);
}

function authorOverlap(a: Set<string>, b: Set<string>) {
  if (!a.size || !b.size) return null;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / Math.max(1, Math.min(a.size, b.size));
}

// ── Idioma de la edición ─────────────────────────────────────────────────────

const MARKERS: Record<string, string> = {
  portugues: 'pt',
  ingles: 'en',
  frances: 'fr',
  catalan: 'ca',
  catala: 'ca',
  valenciano: 'ca',
  gallego: 'gl',
  euskera: 'eu',
  aleman: 'de',
  italiano: 'it',
};
const MARKER_RE =
  /\((portugues|ingles|frances|catalan|catala|valenciano|gallego|euskera|aleman|italiano)\)|-(portugues|ingles|frances|catalan|catala|valenciano|gallego|euskera|aleman|italiano)(?:[-/]|$)/;
const ES_GROUPS = ['84', '607', '950', '987', '956', '958', '959', '968', '970', '980', '9972', '9974'];

export function editionLanguage(title: string, url: string, ean: string) {
  const marked =
    MARKER_RE.exec(stripAccents(title.toLowerCase())) ??
    MARKER_RE.exec(stripAccents(url.toLowerCase()));
  if (marked) return MARKERS[marked[1] ?? marked[2] ?? ''] ?? 'xx';
  if (ean.startsWith('978')) {
    const g = ean.slice(3);
    if (g[0] === '0' || g[0] === '1') return 'en';
    if (g[0] === '2') return 'fr';
    if (g[0] === '3') return 'de';
    if (g.startsWith('88')) return 'it';
    if (['972', '989', '85'].some((p) => g.startsWith(p))) return 'pt';
    if (ES_GROUPS.some((p) => g.startsWith(p))) return 'es';
    return 'xx';
  }
  if (ean.startsWith('979')) {
    const g = ean.slice(3, 5);
    return g === '13' ? 'es' : g === '10' ? 'fr' : 'xx';
  }
  return 'xx';
}

// ── Cruce ────────────────────────────────────────────────────────────────────

export type CatalogBook = {
  id: string;
  nt: string;
  authors: Set<string>;
  isbn: string;
  wanted: Set<string>;
};

export type Candidate = {
  bookId: string;
  format: StoreFormat;
  language: string;
  ean: string | null;
  url: string;
  feedTitle: string;
  feedAuthor: string;
  confidence: number;
  stockStatus: string;
  /// Solo para dar de alta libros nuevos a partir de un deseo (no se guardan
  /// en BookStoreLink).
  imagenUrl?: string;
  categoria?: string;
};

const key = (c: { bookId: string; format: string; language: string }) =>
  `${c.bookId}|${c.format}|${c.language}`;

const STOCK_RANK: Record<string, number> = { Stock: 0, Disponibles: 0 };
const rank = (stock: string) => STOCK_RANK[stock] ?? 1;

// Desempate determinista (para que el resultado no cambie de un día a otro
// según el orden del feed): ISBN coincidente > con stock > título más corto
// (la edición normal, sin "Edición limitada"…) > URL.
function better(a: Candidate, b: Candidate) {
  if (a.confidence !== b.confidence) return a.confidence > b.confidence;
  if (rank(a.stockStatus) !== rank(b.stockStatus)) {
    return rank(a.stockStatus) < rank(b.stockStatus);
  }
  if (a.feedTitle.length !== b.feedTitle.length) {
    return a.feedTitle.length < b.feedTitle.length;
  }
  return a.url < b.url;
}

export type FeedRow = Record<string, string>;

export class LinkMatcher {
  private readonly byIsbn = new Map<string, CatalogBook[]>();
  private readonly byAuthor = new Map<string, CatalogBook[]>();
  readonly best = new Map<string, Candidate>();
  rows = 0;

  constructor(books: CatalogBook[]) {
    for (const b of books) {
      if (b.isbn) this.byIsbn.set(b.isbn, [...(this.byIsbn.get(b.isbn) ?? []), b]);
      for (const w of b.authors) {
        const list = this.byAuthor.get(w);
        if (list) list.push(b);
        else this.byAuthor.set(w, [b]);
      }
    }
  }

  add(row: FeedRow) {
    const top = (row.merchant_category ?? '').split('>')[0]!.trim();
    const format = FORMAT_BY_CATEGORY[top];
    if (!format) return;
    this.rows++;
    const stock = row.stock_status ?? '';
    if (stock === 'Agotados') return;

    const url = row.merchant_deep_link ?? '';
    if (!url.startsWith('https://www.casadellibro.com/')) return;
    const fromUrl = /\/(\d{10,13}[0-9X]?)\/\d+\/?$/.exec(url)?.[1] ?? '';
    const ean = isbn13(row.ean || row.isbn || fromUrl);
    const title = row.product_name ?? '';
    const author = row['BooksNL:author'] ?? '';
    const tokens = authorTokens(author);

    const candidates = new Set<CatalogBook>(this.byIsbn.get(ean) ?? []);
    for (const w of tokens) for (const b of this.byAuthor.get(w) ?? []) candidates.add(b);
    if (candidates.size === 0) return;

    const language = editionLanguage(title, url, ean);
    const nt = normTitle(title);
    for (const book of candidates) {
      if (!book.wanted.has(language)) continue;
      const a = authorOverlap(book.authors, tokens);
      const s = titleSimilarity(book.nt, nt);
      const isbnHit = Boolean(book.isbn) && ean === book.isbn;
      let confidence: number;
      if (isbnHit && s >= 0.6 && (a === null || a >= 0.5)) confidence = 1;
      else if (a !== null && a >= 0.5 && s >= 0.92) confidence = Math.min(s, 0.999);
      else continue;

      const candidate: Candidate = {
        bookId: book.id,
        format,
        language,
        ean: ean || null,
        url,
        feedTitle: title.slice(0, 300),
        feedAuthor: author.slice(0, 300),
        confidence: Math.round(confidence * 1000) / 1000,
        stockStatus: stock,
        imagenUrl: row.merchant_image_url || undefined,
        categoria: row.merchant_category || undefined,
      };
      const k = key(candidate);
      const current = this.best.get(k);
      if (!current || better(candidate, current)) this.best.set(k, candidate);
    }
  }
}

// ── Lectura del feed ─────────────────────────────────────────────────────────

/// Convierte la respuesta del feed (CSV, con o sin gzip) en un flujo de texto.
export async function feedStreamFromResponse(response: Response) {
  if (!response.ok || !response.body) {
    throw new Error(`FEED_HTTP_${response.status}`);
  }
  const iterator = (response.body as unknown as AsyncIterable<Uint8Array>)[
    Symbol.asyncIterator
  ]();
  const first = await iterator.next();
  if (first.done) throw new Error('FEED_EMPTY');
  const head = first.value;
  async function* chunks() {
    yield head;
    for (;;) {
      const next = await iterator.next();
      if (next.done) return;
      yield next.value;
    }
  }
  const source = Readable.from(chunks());
  const gzipped = head[0] === 0x1f && head[1] === 0x8b;
  return gzipped ? source.pipe(createGunzip()) : source;
}

export async function loadCatalog() {
  const books = await prisma.book.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      title: true,
      isbn: true,
      language: true,
      author: { select: { name: true } },
    },
  });
  return books.map<CatalogBook>((b) => ({
    id: b.id,
    nt: normTitle(b.title),
    authors: authorTokens(b.author?.name),
    isbn: isbn13(b.isbn),
    wanted: new Set(['es', ...(b.language && b.language !== 'es' ? [b.language] : [])]),
  }));
}

export type StoreLinkSyncSummary = {
  ok: boolean;
  dryRun: boolean;
  feedRows: number;
  matched: number;
  created: number;
  updated: number;
  removed: number;
  pruned: boolean;
  /// Libros nuevos del catálogo creados a partir de deseos sin libro.
  librosDeDeseos: number;
};

export async function syncStoreLinks(
  input: Readable,
  options: { dryRun?: boolean; altaDeDeseos?: boolean } = {},
): Promise<StoreLinkSyncSummary> {
  const dryRun = options.dryRun ?? false;
  const matcher = new LinkMatcher(await loadCatalog());
  // Deseos que aún no tienen libro del catálogo: se buscan en el mismo feed.
  const deseos =
    options.altaDeDeseos === false ? null : await cargarDeseosSinLibro();
  const deseosMatcher = deseos ? new LinkMatcher(deseos.catalogo) : null;

  const parser = input.pipe(
    parse({
      columns: true,
      bom: true,
      relax_quotes: true,
      relax_column_count: true,
      skip_records_with_error: true,
    }),
  );
  for await (const row of parser as AsyncIterable<FeedRow>) {
    matcher.add(row);
    deseosMatcher?.add(row);
  }

  const existing = await prisma.bookStoreLink.findMany({ where: { store: STORE } });
  const existingByKey = new Map(existing.map((e) => [key(e), e]));
  let created = 0;
  let updated = 0;
  for (const candidate of matcher.best.values()) {
    const current = existingByKey.get(key(candidate));
    if (!current) {
      created++;
      if (!dryRun) {
        const { imagenUrl: _imagen, categoria: _categoria, ...datos } = candidate;
        await prisma.bookStoreLink.create({ data: { ...datos, store: STORE } });
      }
    } else if (
      current.url !== candidate.url ||
      current.stockStatus !== candidate.stockStatus ||
      current.ean !== candidate.ean ||
      current.source !== 'FEED'
    ) {
      updated++;
      if (!dryRun) {
        await prisma.bookStoreLink.update({
          where: { id: current.id },
          data: {
            // El feed manda sobre lo leído de la ficha. Si la ficha de papel
            // cambia, se vuelve a mirar qué otros formatos enlaza.
            source: 'FEED',
            ...(current.url !== candidate.url ? { pageCheckedAt: null } : {}),
            url: candidate.url,
            ean: candidate.ean,
            feedTitle: candidate.feedTitle,
            feedAuthor: candidate.feedAuthor,
            confidence: candidate.confidence,
            stockStatus: candidate.stockStatus,
          },
        });
      }
    }
  }

  // Enlaces que ya no salen en el feed (ficha retirada, agotado, libro
  // fusionado…): solo se borran si el feed se leyó entero.
  const canPrune = matcher.rows >= MIN_ROWS_TO_PRUNE;
  // Los enlaces leídos de la ficha (source PAGE) los gestiona
  // store-link-page.service.ts: aquí no se tocan.
  const stale = canPrune
    ? existing.filter((e) => e.source === 'FEED' && !matcher.best.has(key(e)))
    : [];
  if (!dryRun && stale.length > 0) {
    await prisma.bookStoreLink.deleteMany({
      where: { id: { in: stale.map((e) => e.id) } },
    });
  }

  return {
    ok: true,
    dryRun,
    feedRows: matcher.rows,
    matched: matcher.best.size,
    created,
    updated,
    removed: stale.length,
    pruned: canPrune,
    librosDeDeseos:
      deseos && deseosMatcher
        ? await crearLibrosDeDeseos(deseosMatcher.best, deseos.grupos, dryRun)
        : 0,
  };
}

export async function syncStoreLinksFromUrl(
  url: string,
  options: { dryRun?: boolean } = {},
) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20 * 60_000) });
  return syncStoreLinks(await feedStreamFromResponse(response), options);
}
