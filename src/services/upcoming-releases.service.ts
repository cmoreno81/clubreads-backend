import { prisma } from '../prisma.js';

export type UpcomingReleaseFilters = {
  from?: Date;
  to?: Date;
  genre?: string;
  limit?: number;
};

const clampLimit = (value?: number) => Math.min(Math.max(value ?? 40, 1), 100);

export async function getUpcomingReleases(
  userName: string,
  filters: UpcomingReleaseFilters = {},
) {
  const user = await prisma.user.findUnique({
    where: { name: userName },
    select: { id: true },
  });
  if (!user) return { ok: false as const, mensaje: 'Usuario no encontrado' };

  const now = new Date();
  const from = filters.from && filters.from > now ? filters.from : now;
  const books = await prisma.book.findMany({
    where: {
      deletedAt: null,
      // Solo fuentes que siguen presentes en una sincronización válida. Esto
      // evita que antiguos registros descartados (por ejemplo, no ficción de
      // Casa del Libro) continúen apareciendo como lanzamientos.
      sources: { some: {} },
      publicationDate: {
        not: null,
        gte: from,
        ...(filters.to ? { lte: filters.to } : {}),
      },
      ...(filters.genre
        ? { genre: { name: { equals: filters.genre, mode: 'insensitive' } } }
        : {}),
    },
    select: {
      id: true,
      title: true,
      isbn: true,
      coverUrl: true,
      publicationDate: true,
      publisher: true,
      author: { select: { name: true } },
      genre: { select: { name: true } },
      sources: {
        orderBy: { lastCheckedAt: 'desc' },
        take: 1,
        select: { source: true, sourceUrl: true },
      },
      wishlistItems: {
        where: { userId: user.id, purchasedAt: null },
        take: 1,
        select: { id: true },
      },
      library: {
        where: { userId: user.id },
        take: 1,
        select: { id: true },
      },
    },
    orderBy: [{ publicationDate: 'asc' }, { title: 'asc' }],
    take: clampLimit(filters.limit),
  });

  return {
    ok: true as const,
    items: books.map((book) => ({
      id: book.id,
      bookId: book.id,
      title: book.title,
      author: book.author?.name ?? null,
      isbn: book.isbn,
      coverUrl: book.coverUrl,
      publicationDate: book.publicationDate!.toISOString(),
      publisher: book.publisher,
      genre: book.genre.name,
      source: book.sources[0]?.source ?? null,
      sourceUrl: book.sources[0]?.sourceUrl ?? null,
      isInWishlist: book.wishlistItems.length > 0,
      wishlistItemId: book.wishlistItems[0]?.id ?? null,
      isInLibrary: book.library.length > 0,
    })),
  };
}
