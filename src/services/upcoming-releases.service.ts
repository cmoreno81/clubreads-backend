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

  // Biblioteca del usuario: bookId, ISBN y título normalizado para detectar
  // variantes de edición sin duplicar la entrada.
  const userLibrary = await prisma.library.findMany({
    where: { userId: user.id },
    select: { bookId: true, book: { select: { isbn: true, title: true } } },
  });
  const libraryByBookId = new Set(userLibrary.map((l) => l.bookId));
  const libraryByIsbn = new Set(
    userLibrary.filter((l) => l.book.isbn).map((l) => l.book.isbn!),
  );
  const libraryByTitle = new Set(
    userLibrary.map((l) => normalizeTitle(l.book.title)),
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
      // library ya no se incluye aquí: la comprobación se hace contra
      // libraryByBookId / libraryByIsbn / libraryByTitle cargados arriba.
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
        cliches: [
          ...new Set(
            book.sources
              .filter(({ source }) =>
                source.startsWith(CASA_DEL_LIBRO_CLICHE_SOURCE_PREFIX),
              )
              .map(({ source }) =>
                source.slice(CASA_DEL_LIBRO_CLICHE_SOURCE_PREFIX.length),
              ),
          ),
        ],
        isInWishlist: wishlistItemId !== null,
        wishlistItemId,
        // bookId exacto → ISBN → título normalizado (captura variantes de edición)
        isInLibrary:
          libraryByBookId.has(book.id) ||
          (book.isbn != null && libraryByIsbn.has(book.isbn)) ||
          libraryByTitle.has(normalizeTitle(book.title)),
      };
    }),
  };
}
