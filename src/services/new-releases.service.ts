import { prisma } from "../prisma.js";
import { CASA_DEL_LIBRO_CLICHE_SOURCE_PREFIX } from "./upcoming-release-sync.service.js";
import { normalizeForComparison } from "../utils/text.js";

const NEW_RELEASE_SOURCE_PREFIX = "Casa del Libro · Novedades";

export async function getNewReleases(userName: string, limit = 40) {
  const user = await prisma.user.findUnique({
    where: { name: userName },
    select: { id: true },
  });
  if (!user) return { ok: false as const, mensaje: "Usuario no encontrado" };

  // Wishlist activa del usuario: detecta también ítems añadidos manualmente
  // (sin bookId) comparando por ISBN.
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

  // Biblioteca del usuario: igual que la wishlist, comprobamos por bookId,
  // ISBN y título normalizado para detectar variantes de edición.
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
      publicationDate: { not: null, lte: new Date() },
      // Incluimos libros procedentes del feed de novedades Y libros que
      // entraron directamente desde la página de clichés.
      sources: {
        some: {
          OR: [
            { source: { startsWith: NEW_RELEASE_SOURCE_PREFIX } },
            { source: { startsWith: CASA_DEL_LIBRO_CLICHE_SOURCE_PREFIX } },
          ],
        },
      },
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
    orderBy: [{ publicationDate: "desc" }, { title: "asc" }],
    take: Math.min(Math.max(limit, 1), 100),
  });

  return {
    ok: true as const,
    items: books.map((book) => {
      // Prioridad: fuente de novedades > fuente de cliché
      const primarySource =
        book.sources.find(({ source }) =>
          source.startsWith(NEW_RELEASE_SOURCE_PREFIX),
        ) ??
        book.sources.find(({ source }) =>
          source.startsWith(CASA_DEL_LIBRO_CLICHE_SOURCE_PREFIX),
        );
      // bookId → ISBN → título normalizado (fallback para ítems manuales)
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
