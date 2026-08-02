import type { Prisma, PrismaClient } from '@prisma/client';

type Database = Prisma.TransactionClient | PrismaClient;

export function normalizeBookIdentityText(value: unknown) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeBookIsbn(value: unknown) {
  const normalized = String(value ?? '').replace(/[^0-9Xx]/g, '').toUpperCase();
  return normalized.length === 10 || normalized.length === 13 ? normalized : null;
}

export function canonicalBookKey(title: unknown, author: unknown) {
  return `${normalizeBookIdentityText(title)}::${normalizeBookIdentityText(author)}`;
}

export async function resolveCanonicalBookId(database: Database, requestedId: string) {
  let currentId = requestedId.trim();
  const visited = new Set<string>();
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const redirect = await database.bookRedirect.findUnique({
      where: { oldBookId: currentId },
      select: { canonicalBookId: true },
    });
    if (!redirect) return currentId;
    currentId = redirect.canonicalBookId;
  }
  throw new Error('BOOK_REDIRECT_CYCLE');
}

export async function findBookByIdentity(
  database: Database,
  identity: { title: string; authorName?: string | null; isbn?: string | null; excludeBookId?: string },
) {
  const normalizedIsbn = normalizeBookIsbn(identity.isbn);
  const canonicalKey = canonicalBookKey(identity.title, identity.authorName ?? '');
  return database.book.findFirst({
    where: {
      deletedAt: null,
      ...(identity.excludeBookId ? { id: { not: identity.excludeBookId } } : {}),
      OR: [
        ...(normalizedIsbn ? [{ normalizedIsbn }] : []),
        { canonicalKey },
      ],
    },
    include: { author: true },
  });
}

export async function lockBookIdentity(
  tx: Prisma.TransactionClient,
  identity: { title: string; authorName?: string | null; isbn?: string | null },
) {
  const keys = [
    `canonical:${canonicalBookKey(identity.title, identity.authorName ?? '')}`,
    ...(normalizeBookIsbn(identity.isbn) ? [`isbn:${normalizeBookIsbn(identity.isbn)}`] : []),
  ].sort();
  for (const key of keys) {
    await tx.$queryRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${`book:${key}`}, 0))::text
    `;
  }
}

export function isUniqueBookIdentityError(error: unknown) {
  return Boolean(
    error && typeof error === 'object' && 'code' in error && error.code === 'P2002',
  );
}
