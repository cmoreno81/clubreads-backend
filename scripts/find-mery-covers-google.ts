import 'dotenv/config';

import { mkdir, readFile, writeFile } from 'node:fs/promises';

import { prisma } from '../src/prisma.js';

const applyPreview = process.argv.includes('--apply-preview');
const retryErrors = process.argv.includes('--retry-errors');
const reportPath = 'reports/mery-covers-google-preview.json';
const GOOGLE_BOOKS_URL = 'https://www.googleapis.com/books/v1/volumes';
const REQUEST_INTERVAL_MS = 1_100;
let lastRequestAt = 0;

type GoogleVolume = {
  id?: string;
  volumeInfo?: {
    title?: string;
    authors?: string[];
    industryIdentifiers?: Array<{ type?: string; identifier?: string }>;
    imageLinks?: Record<string, string>;
  };
};

type ReportItem = {
  bookId: string;
  title: string;
  author: string;
  isbn: string | null;
  status: 'SAFE_ISBN' | 'SAFE_TITLE_AUTHOR' | 'NOT_FOUND' | 'ERROR';
  coverUrl: string | null;
  googleVolumeId: string | null;
  matchedTitle: string | null;
  matchedAuthors: string[];
  error?: string;
};

function normalize(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeIsbn(value: string) {
  return value.replace(/[^0-9Xx]/g, '').toUpperCase();
}

function baseTitle(value: string) {
  return normalize(
    value
      .replace(/\s*[([][^\])]*(?:#\d+|spanish edition|colecci[oó]n|n[ºo]\s*\d+)[^\])]*[\])]/gi, '')
      .replace(/\s*[([][^\])]*[\])]\s*$/g, ''),
  );
}

function sameTitle(left: string, right: string) {
  const a = baseTitle(left);
  const b = baseTitle(right);
  return Boolean(a && b && (a === b || normalize(left) === normalize(right)));
}

function sameAuthor(expected: string, candidates: string[]) {
  const author = normalize(expected);
  return candidates.some((candidate) => {
    const normalized = normalize(candidate);
    return normalized === author || normalized.includes(author) || author.includes(normalized);
  });
}

function coverFrom(volume: GoogleVolume) {
  const links = volume.volumeInfo?.imageLinks;
  const cover = links?.extraLarge ?? links?.large ?? links?.medium ??
    links?.small ?? links?.thumbnail ?? links?.smallThumbnail;
  return cover?.replace(/^http:/, 'https:').replace('&edge=curl', '') ?? null;
}

function volumeIsbns(volume: GoogleVolume) {
  return (volume.volumeInfo?.industryIdentifiers ?? [])
    .map((item) => normalizeIsbn(item.identifier ?? ''))
    .filter(Boolean);
}

async function search(query: string) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const elapsed = Date.now() - lastRequestAt;
    if (elapsed < REQUEST_INTERVAL_MS) {
      await new Promise((resolve) => setTimeout(resolve, REQUEST_INTERVAL_MS - elapsed));
    }
    const url = new URL(GOOGLE_BOOKS_URL);
    url.searchParams.set('q', query);
    url.searchParams.set('maxResults', '20');
    url.searchParams.set('printType', 'books');
    if (process.env.GOOGLE_BOOKS_API_KEY) {
      url.searchParams.set('key', process.env.GOOGLE_BOOKS_API_KEY);
    }
    lastRequestAt = Date.now();
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(12_000),
    });
    if (response.ok) {
      const body = await response.json() as { items?: GoogleVolume[] };
      return body.items ?? [];
    }
    if (response.status !== 429 && response.status !== 503) {
      throw new Error(`GOOGLE_BOOKS_HTTP_${response.status}`);
    }
    await response.body?.cancel();
    if (attempt < 2) {
      const retryAfter = Number(response.headers.get('retry-after'));
      await new Promise((resolve) => setTimeout(
        resolve,
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1_000 : 5_000 * (attempt + 1),
      ));
    } else {
      throw new Error(`GOOGLE_BOOKS_HTTP_${response.status}`);
    }
  }
  return [];
}

async function findMatch(book: { title: string; isbn: string | null; author: { name: string } | null }) {
  const isbn = normalizeIsbn(book.isbn ?? '');
  if (isbn.length === 10 || isbn.length === 13) {
    const volumes = await search(`isbn:${isbn}`);
    const exact = volumes.find((volume) => volumeIsbns(volume).includes(isbn) && coverFrom(volume));
    if (exact) return { volume: exact, status: 'SAFE_ISBN' as const };
  }

  const author = book.author?.name ?? '';
  if (!author) return null;
  const volumes = await search(`intitle:${book.title} inauthor:${author}`);
  const exact = volumes.find((volume) => {
    const info = volume.volumeInfo;
    return Boolean(
      info?.title &&
      sameTitle(book.title, info.title) &&
      sameAuthor(author, info.authors ?? []) &&
      coverFrom(volume),
    );
  });
  return exact ? { volume: exact, status: 'SAFE_TITLE_AUTHOR' as const } : null;
}

async function preview() {
  let retryBookIds: string[] | undefined;
  if (retryErrors) {
    const previous = JSON.parse(await readFile(reportPath, 'utf8')) as ReportItem[];
    retryBookIds = previous.filter((item) => item.status === 'ERROR').map((item) => item.bookId);
  }
  const books = await prisma.book.findMany({
    where: {
      createdBy: { name: 'Mery' },
      deletedAt: null,
      OR: [{ coverUrl: null }, { coverUrl: '' }],
      ...(retryBookIds ? { id: { in: retryBookIds } } : {}),
    },
    select: { id: true, title: true, isbn: true, author: { select: { name: true } } },
    orderBy: { title: 'asc' },
  });
  const report: ReportItem[] = [];
  for (let index = 0; index < books.length; index += 1) {
    const book = books[index];
    process.stdout.write(`[${index + 1}/${books.length}] ${book.title}\n`);
    try {
      const match = await findMatch(book);
      const info = match?.volume.volumeInfo;
      report.push({
        bookId: book.id,
        title: book.title,
        author: book.author?.name ?? '',
        isbn: book.isbn,
        status: match?.status ?? 'NOT_FOUND',
        coverUrl: match ? coverFrom(match.volume) : null,
        googleVolumeId: match?.volume.id ?? null,
        matchedTitle: info?.title ?? null,
        matchedAuthors: info?.authors ?? [],
      });
    } catch (error) {
      report.push({
        bookId: book.id,
        title: book.title,
        author: book.author?.name ?? '',
        isbn: book.isbn,
        status: 'ERROR',
        coverUrl: null,
        googleVolumeId: null,
        matchedTitle: null,
        matchedAuthors: [],
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  await mkdir('reports', { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
  const count = (status: ReportItem['status']) => report.filter((item) => item.status === status).length;
  console.log(JSON.stringify({
    total: report.length,
    safeIsbn: count('SAFE_ISBN'),
    safeTitleAuthor: count('SAFE_TITLE_AUTHOR'),
    notFound: count('NOT_FOUND'),
    errors: count('ERROR'),
    reportPath,
  }));
}

async function apply() {
  const report = JSON.parse(await readFile(reportPath, 'utf8')) as ReportItem[];
  const safe = report.filter((item) =>
    (item.status === 'SAFE_ISBN' || item.status === 'SAFE_TITLE_AUTHOR') && item.coverUrl,
  );
  const results: Array<{ count: number }> = [];
  for (let index = 0; index < safe.length; index += 20) {
    const chunk = safe.slice(index, index + 20);
    results.push(...await prisma.$transaction(
      chunk.map((item) => prisma.book.updateMany({
        where: {
          id: item.bookId,
          createdBy: { name: 'Mery' },
          OR: [{ coverUrl: null }, { coverUrl: '' }],
        },
        data: { coverUrl: item.coverUrl! },
      })),
    ));
  }
  console.log(JSON.stringify({ candidates: safe.length, updated: results.reduce((sum, item) => sum + item.count, 0) }));
}

(applyPreview ? apply() : preview())
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
