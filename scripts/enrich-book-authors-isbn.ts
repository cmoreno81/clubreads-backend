import 'dotenv/config';

import { mkdir, writeFile } from 'node:fs/promises';

import { prisma } from '../src/prisma.js';

type Result = {
  bookId: string;
  title: string;
  isbn: string;
  status: 'SAFE' | 'AMBIGUOUS' | 'NOT_FOUND' | 'TITLE_MISMATCH' | 'ERROR';
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

function compatibleTitle(local: string, remote: string) {
  const left = normalized(local);
  const right = normalized(remote);
  return Boolean(
    left &&
    right &&
    (left === right ||
      (left.length >= 7 && right.startsWith(`${left} `)) ||
      (right.length >= 7 && left.startsWith(`${right} `))),
  );
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(12_000),
    headers: {
      Accept: 'application/json',
      'User-Agent': 'ClubReads/1.0 (ISBN author enrichment)',
    },
  });
  if (!response.ok) throw new Error(`OPEN_LIBRARY_HTTP_${response.status}`);
  return response.json() as Promise<T>;
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
  const books = (await prisma.book.findMany({
    where: { deletedAt: null, authorId: null, isbn: { not: null } },
    select: { id: true, title: true, isbn: true },
    orderBy: { title: 'asc' },
  })).map((book) => ({
    ...book,
    isbn: String(book.isbn).replace(/[^0-9Xx]/g, '').toUpperCase(),
  })).filter((book) => book.isbn.length === 10 || book.isbn.length === 13);

  const api = new URL('https://openlibrary.org/api/books');
  api.searchParams.set('bibkeys', books.map((book) => `ISBN:${book.isbn}`).join(','));
  api.searchParams.set('jscmd', 'data');
  api.searchParams.set('format', 'json');
  const editions = await getJson<Record<string, {
    key?: string;
    title?: string;
  }>>(api.toString());
  const results: Result[] = [];

  for (let index = 0; index < books.length; index += 1) {
    const book = books[index];
    console.log(`[${index + 1}/${books.length}] ${book.title}`);
    try {
      const edition = editions[`ISBN:${book.isbn}`];
      if (!edition?.key || !edition.title) {
        results.push({
          bookId: book.id,
          title: book.title,
          isbn: book.isbn,
          status: 'NOT_FOUND',
          author: null,
          evidence: 'Open Library no tiene una edición para este ISBN',
          applied: false,
        });
        continue;
      }
      if (!compatibleTitle(book.title, edition.title)) {
        results.push({
          bookId: book.id,
          title: book.title,
          isbn: book.isbn,
          status: 'TITLE_MISMATCH',
          author: null,
          evidence: `El ISBN corresponde a «${edition.title}»`,
          applied: false,
        });
        continue;
      }
      const editionData = await getJson<{
        works?: Array<{ key?: string }>;
      }>(`https://openlibrary.org${edition.key}.json`);
      const workKey = editionData.works?.length === 1
        ? editionData.works[0].key
        : null;
      if (!workKey) {
        results.push({
          bookId: book.id,
          title: book.title,
          isbn: book.isbn,
          status: 'AMBIGUOUS',
          author: null,
          evidence: 'La edición no está vinculada a una única obra',
          applied: false,
        });
        continue;
      }
      const work = await getJson<{
        authors?: Array<{ author?: { key?: string } }>;
      }>(`https://openlibrary.org${workKey}.json`);
      const authorKey = work.authors?.length === 1
        ? work.authors[0].author?.key
        : null;
      if (!authorKey) {
        results.push({
          bookId: book.id,
          title: book.title,
          isbn: book.isbn,
          status: 'AMBIGUOUS',
          author: null,
          evidence: 'La obra no identifica un único autor principal',
          applied: false,
        });
        continue;
      }
      const authorData = await getJson<{ name?: string }>(
        `https://openlibrary.org${authorKey}.json`,
      );
      const authorName = authorData.name?.trim();
      if (!authorName) {
        results.push({
          bookId: book.id,
          title: book.title,
          isbn: book.isbn,
          status: 'AMBIGUOUS',
          author: null,
          evidence: 'La ficha del autor no contiene nombre',
          applied: false,
        });
        continue;
      }
      let applied = false;
      if (apply) {
        await saveAuthor(book.id, authorName);
        applied = true;
      }
      results.push({
        bookId: book.id,
        title: book.title,
        isbn: book.isbn,
        status: 'SAFE',
        author: authorName,
        evidence: 'ISBN, edición, obra y autor principal verificados',
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
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  await mkdir('reports', { recursive: true });
  const path = apply
    ? 'reports/book-authors-isbn-apply.json'
    : 'reports/book-authors-isbn-preview.json';
  await writeFile(path, JSON.stringify(results, null, 2), 'utf8');
  for (const status of ['SAFE', 'AMBIGUOUS', 'NOT_FOUND', 'TITLE_MISMATCH', 'ERROR'] as const) {
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
