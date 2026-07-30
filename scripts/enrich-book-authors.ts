import 'dotenv/config';

import { mkdir, writeFile } from 'node:fs/promises';

import { prisma } from '../src/prisma.js';

type Candidate = {
  title: string;
  authors: string[];
  isbns: string[];
};

type Result = {
  bookId: string;
  title: string;
  isbn: string | null;
  status: 'SAFE_ISBN' | 'SAFE_CONSENSUS' | 'AMBIGUOUS' | 'NOT_FOUND' | 'ERROR';
  author: string | null;
  evidence: string;
  applied: boolean;
};

const apply = process.argv.includes('--apply');

function normalized(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizedIsbn(value: string | null | undefined) {
  return String(value ?? '').replace(/[^0-9Xx]/g, '').toUpperCase();
}

function exactTitle(left: string, right: string) {
  return normalized(left) === normalized(right);
}

function sameAuthor(left: string, right: string) {
  const a = normalized(left);
  const b = normalized(right);
  return Boolean(a && b && (a === b || a.includes(b) || b.includes(a)));
}

async function requestGoogleBooks(query: string, includeKey: boolean): Promise<Response> {
  const url = new URL('https://www.googleapis.com/books/v1/volumes');
  url.searchParams.set('q', query);
  url.searchParams.set('maxResults', '20');
  url.searchParams.set('printType', 'books');
  if (includeKey && process.env.GOOGLE_BOOKS_API_KEY) {
    url.searchParams.set('key', process.env.GOOGLE_BOOKS_API_KEY);
  }
  return fetch(url, {
    signal: AbortSignal.timeout(12_000),
    headers: { Accept: 'application/json' },
  });
}

async function googleBooks(query: string): Promise<Candidate[]> {
  let response = await requestGoogleBooks(query, true);
  if (response.status === 429 && process.env.GOOGLE_BOOKS_API_KEY) {
    await response.body?.cancel();
    response = await requestGoogleBooks(query, false);
  }
  if (!response.ok) throw new Error(`GOOGLE_BOOKS_HTTP_${response.status}`);
  const payload = await response.json() as {
    items?: Array<{
      volumeInfo?: {
        title?: string;
        authors?: string[];
        industryIdentifiers?: Array<{ identifier?: string }>;
      };
    }>;
  };
  return (payload.items ?? []).map((item) => ({
    title: item.volumeInfo?.title?.trim() ?? '',
    authors: (item.volumeInfo?.authors ?? []).map((value) => value.trim()).filter(Boolean),
    isbns: (item.volumeInfo?.industryIdentifiers ?? [])
      .map((value) => normalizedIsbn(value.identifier))
      .filter(Boolean),
  })).filter((item) => item.title && item.authors.length > 0);
}

async function openLibrary(title: string): Promise<Candidate[]> {
  const url = new URL('https://openlibrary.org/search.json');
  url.searchParams.set('title', title);
  url.searchParams.set('limit', '20');
  url.searchParams.set('fields', 'title,author_name,isbn');
  const response = await fetch(url, {
    signal: AbortSignal.timeout(12_000),
    headers: {
      Accept: 'application/json',
      'User-Agent': 'ClubReads/1.0 (author-enrichment)',
    },
  });
  if (!response.ok) throw new Error(`OPEN_LIBRARY_HTTP_${response.status}`);
  const payload = await response.json() as {
    docs?: Array<{ title?: string; author_name?: string[]; isbn?: string[] }>;
  };
  return (payload.docs ?? []).map((item) => ({
    title: item.title?.trim() ?? '',
    authors: (item.author_name ?? []).map((value) => value.trim()).filter(Boolean),
    isbns: (item.isbn ?? []).map(normalizedIsbn).filter(Boolean),
  })).filter((item) => item.title && item.authors.length > 0);
}

function uniqueAuthor(candidates: Candidate[]) {
  const names = candidates
    .flatMap((candidate) => candidate.authors.slice(0, 1))
    .filter(Boolean);
  const unique = names.filter(
    (name, index) => names.findIndex((other) => sameAuthor(name, other)) === index,
  );
  return unique.length === 1 ? unique[0] : null;
}

async function saveAuthor(bookId: string, authorName: string) {
  await prisma.$transaction(async (tx) => {
    const existing = await tx.author.findFirst({
      where: { name: { equals: authorName, mode: 'insensitive' } },
    });
    const author = existing ?? await tx.author.create({ data: { name: authorName } });
    await tx.book.updateMany({
      where: { id: bookId, authorId: null },
      data: { authorId: author.id },
    });
  });
}

async function main() {
  const books = await prisma.book.findMany({
    where: { deletedAt: null, authorId: null },
    select: { id: true, title: true, isbn: true },
    orderBy: { title: 'asc' },
  });
  const results: Result[] = [];

  for (let index = 0; index < books.length; index += 1) {
    const book = books[index];
    const isbn = normalizedIsbn(book.isbn);
    console.log(`[${index + 1}/${books.length}] ${book.title}`);
    try {
      let status: Result['status'] = 'NOT_FOUND';
      let author: string | null = null;
      let evidence = '';

      if (isbn.length === 10 || isbn.length === 13) {
        const candidates = (await googleBooks(`isbn:${isbn}`))
          .filter((candidate) => candidate.isbns.includes(isbn));
        author = uniqueAuthor(candidates);
        if (author) {
          status = 'SAFE_ISBN';
          evidence = `Google Books confirma el ISBN ${isbn}`;
        } else if (candidates.length > 0) {
          status = 'AMBIGUOUS';
          evidence = 'El ISBN devuelve más de un autor';
        }
      }

      if (!author && status === 'NOT_FOUND') {
        const [google, open] = await Promise.all([
          googleBooks(`intitle:${book.title}`),
          openLibrary(book.title),
        ]);
        const googleExact = google.filter((candidate) => exactTitle(book.title, candidate.title));
        const openExact = open.filter((candidate) => exactTitle(book.title, candidate.title));
        const googleAuthor = uniqueAuthor(googleExact);
        const openAuthor = uniqueAuthor(openExact);
        if (googleAuthor && openAuthor && sameAuthor(googleAuthor, openAuthor)) {
          author = googleAuthor;
          status = 'SAFE_CONSENSUS';
          evidence = 'Google Books y Open Library coinciden en título y autor';
        } else if (googleExact.length > 0 || openExact.length > 0) {
          status = 'AMBIGUOUS';
          evidence = 'Las fuentes no ofrecen un único autor coincidente';
        }
      }

      let applied = false;
      if (apply && author && status.startsWith('SAFE_')) {
        await saveAuthor(book.id, author);
        applied = true;
      }
      results.push({
        bookId: book.id,
        title: book.title,
        isbn: book.isbn,
        status,
        author,
        evidence,
        applied,
      });
    } catch (error) {
      results.push({
        bookId: book.id,
        title: book.title,
        isbn: book.isbn,
        status: 'ERROR',
        author: null,
        evidence: error instanceof Error ? error.message : String(error),
        applied: false,
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  await mkdir('reports', { recursive: true });
  const path = apply
    ? 'reports/book-authors-multiprovider-apply.json'
    : 'reports/book-authors-multiprovider-preview.json';
  await writeFile(path, JSON.stringify(results, null, 2), 'utf8');
  for (const status of ['SAFE_ISBN', 'SAFE_CONSENSUS', 'AMBIGUOUS', 'NOT_FOUND', 'ERROR'] as const) {
    console.log(`${status}: ${results.filter((item) => item.status === status).length}`);
  }
  console.log(`Aplicados: ${results.filter((item) => item.applied).length}`);
  console.log(`Informe: ${path}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
