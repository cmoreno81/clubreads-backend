import 'dotenv/config';

import { mkdir, writeFile } from 'node:fs/promises';

import { prisma } from '../src/prisma.js';

function normalizeText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeIsbn(value: string | null) {
  const normalized = String(value ?? '').replace(/[^0-9Xx]/g, '').toUpperCase();
  return normalized.length === 10 || normalized.length === 13 ? normalized : null;
}

function groupBy<T>(items: T[], keyFor: (item: T) => string | null) {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFor(item);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([key, group]) => ({ key, books: group }));
}

async function main() {
  const books = await prisma.book.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      title: true,
      isbn: true,
      createdAt: true,
      createdBy: { select: { name: true } },
      author: { select: { id: true, name: true } },
      _count: {
        select: {
          library: true,
          readingCompletions: true,
          readings: true,
          reviews: true,
          wonClubvisions: true,
          clubvisionCandidates: true,
          clubvisionResults: true,
        },
      },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });

  const notificationCounts = await prisma.notification.groupBy({
    by: ['bookId'],
    where: { bookId: { not: null } },
    _count: { _all: true },
  });
  const notifications = new Map(notificationCounts.map((item) => [item.bookId, item._count._all]));

  const normalized = books.map((book) => ({
    ...book,
    normalizedIsbn: normalizeIsbn(book.isbn),
    normalizedTitle: normalizeText(book.title),
    normalizedAuthor: normalizeText(book.author?.name ?? ''),
    canonicalKey: `${normalizeText(book.title)}::${normalizeText(book.author?.name ?? '')}`,
    notificationCount: notifications.get(book.id) ?? 0,
  }));
  const isbnGroups = groupBy(normalized, (book) => book.normalizedIsbn);
  const titleAuthorGroups = groupBy(normalized, (book) => book.canonicalKey);
  const titleOnlyGroups = groupBy(normalized, (book) => book.normalizedTitle);
  const sameTitleDifferentAuthorGroups = titleOnlyGroups.filter((group) =>
    new Set(group.books.map((book) => book.normalizedAuthor)).size > 1,
  );
  const duplicateIds = new Set(
    [...isbnGroups, ...titleAuthorGroups].flatMap((group) => group.books.map((book) => book.id)),
  );

  const report = {
    generatedAt: new Date().toISOString(),
    mode: 'READ_ONLY',
    normalization: {
      text: 'NFD, sin diacríticos, minúsculas, no alfanumérico a espacio, espacios colapsados',
      isbn: 'solo dígitos/X; válido únicamente con longitud 10 o 13',
      canonicalKey: '<normalizedTitle>::<normalizedAuthor>',
    },
    summary: {
      activeBooks: books.length,
      isbnDuplicateGroups: isbnGroups.length,
      isbnBooksInDuplicateGroups: new Set(isbnGroups.flatMap((group) => group.books.map((book) => book.id))).size,
      titleAuthorDuplicateGroups: titleAuthorGroups.length,
      titleAuthorBooksInDuplicateGroups: new Set(titleAuthorGroups.flatMap((group) => group.books.map((book) => book.id))).size,
      distinctBooksFlagged: duplicateIds.size,
      titleAuthorGroupsWithoutAuthor: titleAuthorGroups.filter((group) => !group.books[0].normalizedAuthor).length,
      booksWithValidIsbn: normalized.filter((book) => book.normalizedIsbn).length,
      booksWithoutValidIsbn: normalized.filter((book) => !book.normalizedIsbn).length,
      booksWithoutAuthor: normalized.filter((book) => !book.normalizedAuthor).length,
      sameNormalizedTitleDifferentAuthorGroups: sameTitleDifferentAuthorGroups.length,
    },
    isbnGroups,
    titleAuthorGroups,
    sameTitleDifferentAuthorGroups,
  };

  await mkdir('reports', { recursive: true });
  const path = 'reports/book-duplicates-audit-2026-08-02.json';
  await writeFile(path, JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify({ path, ...report.summary }));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
