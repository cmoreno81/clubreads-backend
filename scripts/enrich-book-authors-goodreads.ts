import 'dotenv/config';

import { mkdir, writeFile } from 'node:fs/promises';

import { prisma } from '../src/prisma.js';

type GoodreadsBook = {
  '@type'?: string;
  name?: string;
  isbn?: string;
  author?: Array<{ name?: string }> | { name?: string };
};

type Result = {
  bookId: string;
  title: string;
  goodreadsTitle: string | null;
  status: 'SAFE' | 'AMBIGUOUS' | 'BROKEN_LINK' | 'TITLE_MISMATCH' | 'ERROR';
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
    .replace(/&(?:amp|apos|quot);/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function canonicalTitle(value: string) {
  return normalized(value)
    .replace(/\b(?:saga|serie|series|trilogia|trilogy)\b.*$/g, '')
    .replace(/\b(?:vol|volume|book|libro)\s*\d+\b.*$/g, '')
    .replace(/\s+\d+\s*$/g, '')
    .trim();
}

function compatibleTitle(local: string, remote: string) {
  const left = canonicalTitle(local);
  const right = canonicalTitle(remote);
  return Boolean(
    left &&
    right &&
    (left === right ||
      (left.length >= 8 && right.startsWith(`${left} `)) ||
      (right.length >= 8 && left.startsWith(`${right} `))),
  );
}

function extractJsonLd(html: string): GoodreadsBook | null {
  const scripts = [...html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )];
  for (const script of scripts) {
    try {
      const parsed = JSON.parse(script[1]) as GoodreadsBook | GoodreadsBook[];
      const entries = Array.isArray(parsed) ? parsed : [parsed];
      const book = entries.find((entry) => entry['@type'] === 'Book');
      if (book) return book;
    } catch {
      // Algunas páginas pueden contener otros bloques JSON-LD no válidos.
    }
  }
  return null;
}

function authorNames(book: GoodreadsBook) {
  const authors = Array.isArray(book.author)
    ? book.author
    : book.author
      ? [book.author]
      : [];
  return authors.map((author) => author.name?.trim() ?? '').filter(Boolean);
}

async function getGoodreadsBook(url: string) {
  let response: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    response = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
      headers: {
        Accept: 'text/html',
        'User-Agent': 'Mozilla/5.0 (compatible; ClubReads/1.0; author metadata)',
      },
    });
    if (response.status !== 429) break;
    await response.body?.cancel();
    await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
  }
  if (!response?.ok) return null;
  return extractJsonLd(await response.text());
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
    where: {
      deletedAt: null,
      authorId: null,
      goodreadsUrl: { not: null },
    },
    select: { id: true, title: true, goodreadsUrl: true },
    orderBy: { title: 'asc' },
  });
  const results: Result[] = [];

  for (let index = 0; index < books.length; index += 1) {
    const book = books[index];
    console.log(`[${index + 1}/${books.length}] ${book.title}`);
    try {
      const metadata = await getGoodreadsBook(book.goodreadsUrl!);
      if (!metadata?.name) {
        results.push({
          bookId: book.id,
          title: book.title,
          goodreadsTitle: null,
          status: 'BROKEN_LINK',
          author: null,
          evidence: 'La ficha no devuelve metadatos de libro',
          applied: false,
        });
      } else if (!compatibleTitle(book.title, metadata.name)) {
        results.push({
          bookId: book.id,
          title: book.title,
          goodreadsTitle: metadata.name,
          status: 'TITLE_MISMATCH',
          author: null,
          evidence: 'El título enlazado no coincide con ClubReads',
          applied: false,
        });
      } else {
        const authors = authorNames(metadata);
        if (authors.length !== 1) {
          results.push({
            bookId: book.id,
            title: book.title,
            goodreadsTitle: metadata.name,
            status: 'AMBIGUOUS',
            author: null,
            evidence: authors.length === 0
              ? 'La ficha no identifica un autor'
              : `La ficha contiene ${authors.length} autores`,
            applied: false,
          });
        } else {
          let applied = false;
          if (apply) {
            await saveAuthor(book.id, authors[0]);
            applied = true;
          }
          results.push({
            bookId: book.id,
            title: book.title,
            goodreadsTitle: metadata.name,
            status: 'SAFE',
            author: authors[0],
            evidence: 'Título y ficha pública de Goodreads coinciden',
            applied,
          });
        }
      }
    } catch (error) {
      results.push({
        bookId: book.id,
        title: book.title,
        goodreadsTitle: null,
        status: 'ERROR',
        author: null,
        evidence: error instanceof Error ? error.message : String(error),
        applied: false,
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  await mkdir('reports', { recursive: true });
  const path = apply
    ? 'reports/book-authors-goodreads-apply.json'
    : 'reports/book-authors-goodreads-preview.json';
  await writeFile(path, JSON.stringify(results, null, 2), 'utf8');
  for (const status of ['SAFE', 'AMBIGUOUS', 'BROKEN_LINK', 'TITLE_MISMATCH', 'ERROR'] as const) {
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
