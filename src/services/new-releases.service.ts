import { prisma } from "../prisma.js";
import { CASA_DEL_LIBRO_CLICHE_SOURCE_PREFIX } from "./upcoming-release-sync.service.js";

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
  const normalizeTitle = (t: string) =>
    t.toLowerCase().normalize("NFD").replace(/\p{Mn}/gu, "").trim();
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
        orderBy: { lastCheckedAt: "desc" },
        select: { source: true, sourceUrl: true },
      },
      library: { where: { userId: user.id }, take: 1, select: { id: true } },
    },
    orderBy: [{ publicationDate: "desc" }, { title: "asc" }],
    take: Math.min(Math.max(limit, 1), 100),
  });

  return {
    ok: true as const,
    items: books.map((book) => {
      const primarySource = book.sources.find(({ source }) =>
        source.startsWith(NEW_RELEASE_SOURCE_PREFIX),
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
