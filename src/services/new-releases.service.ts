import { prisma } from '../prisma.js';

const NEW_RELEASE_SOURCE_PREFIX = 'Casa del Libro · Novedades';

export async function getNewReleases(userName: string, limit = 40) {
  const user = await prisma.user.findUnique({
    where: { name: userName },
    select: { id: true },
  });
  if (!user) return { ok: false as const, mensaje: 'Usuario no encontrado' };

  const books = await prisma.book.findMany({
    where: {
      deletedAt: null,
      publicationDate: { not: null, lte: new Date() },
      sources: { some: { source: { startsWith: NEW_RELEASE_SOURCE_PREFIX } } },
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
        where: { source: { startsWith: NEW_RELEASE_SOURCE_PREFIX } },
        orderBy: { lastCheckedAt: 'desc' },
        take: 1,
        select: { source: true, sourceUrl: true },
      },
      wishlistItems: {
        where: { userId: user.id, purchasedAt: null },
        take: 1,
        select: { id: true },
      },
      library: { where: { userId: user.id }, take: 1, select: { id: true } },
    },
    orderBy: [{ publicationDate: 'desc' }, { title: 'asc' }],
    take: Math.min(Math.max(limit, 1), 100),
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
