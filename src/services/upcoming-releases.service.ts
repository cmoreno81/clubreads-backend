import { prisma } from "../prisma.js";
import { CASA_DEL_LIBRO_CLICHE_SOURCE_PREFIX } from "./upcoming-release-sync.service.js";
import { normalizeForComparison } from "../utils/text.js";

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
  if (!user) return { ok: false as const, mensaje: "Usuario no encontrado" };

  const now = new Date();
  const from = filters.from && filters.from > now ? filters.from : now;

  // Cargamos la wishlist activa del usuario (no comprados) para detectar
  // también ítems añadidos manualmente: primero comparamos bookId, luego ISBN
  // y finalmente título normalizado (fallback para ítems sin bookId ni ISBN).
  const userWishlist = await prisma.wishlistItem.findMany({
    where: { userId: user.id, purchasedAt: null },
    select: { id: true, bookId: true, isbn: true, title: true },
  });
  const normalizeTitle = (t: string) => normalizeForComparison(t);
  const wishlistByBookId = new Map(
    userWishlist.filter((w) => w.bookId).map((w) => [w.bookId!, w.id]),
  );
  const wishlistByIsbn = new Map(
    userWishlist.filter((w) => w.isbn).map((w) => [w.isbn!, w.id]),
  );
  const wishlistByTitle = new Map(
    userWishlist.map((w) => [normalizeTitle(w.title), w.id]),
  );

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
        ? { genre: { name: { equals: filters.genre, mode: "insensitive" } } }
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
        orderBy: { lastCheckedAt: "desc" },
        select: { source: true, sourceUrl: true },
      },
      library: {
        where: { userId: user.id },
        take: 1,
        select: { id: true },
      },
    },
    orderBy: [{ publicationDate: "asc" }, { title: "asc" }],
    take: clampLimit(filters.limit),
  });

  return {
    ok: true as const,
    items: books.map((book) => {
      const primarySource = book.sources.find(
        ({ source }) => !source.startsWith(CASA_DEL_LIBRO_CLICHE_SOURCE_PREFIX),
      );
      // Wishlist: bookId → ISBN → título normalizado (fallback para ítems manuales)
      const wishlistItemId =
        wishlistByBookId.get(book.id) ??
        (book.isbn ? wishlistByIsbn.get(book.isbn) : undefined) ??
        wishlistByTitle.get(normalizeTitle(book.title)) ??
        null;
      return {
        id: book.id,
        bookId: book.id,
        title: book.title,
        author: book.author?.name ?? null,
        isbn: book.isbn,
        coverUrl: book.coverUrl,
        publicationDate: book.publicationDate!.toISOString(),
        publisher: book.publisher,
        genre: book.genre.name,
        source: primarySource?.source ?? null,
        sourceUrl: primarySource?.sourceUrl ?? null,
        cliches: book.sources
          .filter(({ source }) =>
            source.startsWith(CASA_DEL_LIBRO_CLICHE_SOURCE_PREFIX),
          )
          .map(({ source }) =>
            source.slice(CASA_DEL_LIBRO_CLICHE_SOURCE_PREFIX.length),
          ),
        isInWishlist: wishlistItemId !== null,
        wishlistItemId,
        isInLibrary: book.library.length > 0,
      };
    }),
  };
}
