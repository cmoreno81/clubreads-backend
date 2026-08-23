import { WishlistFormat, WishlistPriority } from '@prisma/client';
import { prisma } from '../prisma.js';
import { canonicalBookTitle } from './catalog.service.js';
import { getCurrentClubContext } from './club-context.service.js';

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type WishlistItemInput = {
  bookId?: string | null;
  title: string;
  author?: string | null;
  coverUrl?: string | null;
  isbn?: string | null;
  format?: WishlistFormat;
  priority?: WishlistPriority;
  price?: number | null;
  releaseDate?: string | null; // ISO date string
  plannedMonth?: string | null; // ISO date string (solo año+mes)
  note?: string | null;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

function formatItem(item: {
  id: string;
  bookId: string | null;
  title: string;
  author: string | null;
  coverUrl: string | null;
  isbn: string | null;
  format: WishlistFormat;
  priority: WishlistPriority;
  price: number | null;
  releaseDate: Date | null;
  plannedMonth: Date | null;
  purchasedAt: Date | null;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
  book?: {
    title: string;
    coverUrl: string | null;
    author: { name: string } | null;
  } | null;
}) {
  return {
    id: item.id,
    bookId: item.bookId,
    title: item.title.trim() || item.book?.title.trim() || item.title,
    author: item.author?.trim() || item.book?.author?.name.trim() || null,
    coverUrl: item.coverUrl?.trim() || item.book?.coverUrl?.trim() || null,
    isbn: item.isbn,
    format: item.format,
    priority: item.priority,
    price: item.price,
    releaseDate: item.releaseDate?.toISOString() ?? null,
    plannedMonth: item.plannedMonth?.toISOString() ?? null,
    purchasedAt: item.purchasedAt?.toISOString() ?? null,
    note: item.note,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
    // Si tiene fecha de salida futura → es novedad
    isUpcoming: item.releaseDate != null && item.releaseDate > new Date(),
  };
}

async function recoverCatalogBook<
  T extends {
    title: string;
    author: string | null;
    coverUrl: string | null;
    bookId: string | null;
    book?: {
      id?: string;
      title: string;
      coverUrl: string | null;
      author: { name: string } | null;
    } | null;
  },
>(
  item: T,
): Promise<
  Omit<T, 'book'> & {
    book?: {
      id?: string;
      title: string;
      coverUrl: string | null;
      author: { name: string } | null;
    } | null;
  }
> {
  if (item.coverUrl?.trim() || item.book?.coverUrl?.trim()) return item;

  const catalogCandidates = await prisma.book.findMany({
    where: {
      deletedAt: null,
      ...(item.author?.trim()
        ? {
            author: {
              name: { equals: item.author.trim(), mode: 'insensitive' },
            },
          }
        : { title: { equals: item.title.trim(), mode: 'insensitive' } }),
    },
    select: {
      id: true,
      title: true,
      coverUrl: true,
      author: { select: { name: true } },
    },
    take: item.author?.trim() ? 100 : 1,
  });
  const normalizedTitle = canonicalBookTitle(item.title);
  const catalogBook = catalogCandidates.find(
    (candidate) => canonicalBookTitle(candidate.title) === normalizedTitle,
  );

  if (!catalogBook?.coverUrl?.trim()) return item;
  return {
    ...item,
    bookId: item.bookId ?? catalogBook.id,
    book: catalogBook,
  };
}

// ─── Servicio ─────────────────────────────────────────────────────────────────

/** Devuelve la wishlist del usuario actual. */
export async function getWishlist(userName: string) {
  const user = await prisma.user.findUnique({
    where: { name: userName },
    select: { id: true },
  });
  if (!user) return { ok: false as const, mensaje: 'Usuario no encontrado' };

  const allItems = await prisma.wishlistItem.findMany({
    where: { userId: user.id },
    include: {
      book: {
        select: {
          title: true,
          coverUrl: true,
          author: { select: { name: true } },
        },
      },
    },
    orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
  });

  // Separar lista activa (pendientes de comprar) de historial de compras
  const recoveredItems = await Promise.all(allItems.map(recoverCatalogBook));
  const pending = recoveredItems.filter((i) => i.purchasedAt === null);
  const purchased = recoveredItems
    .filter((i) => i.purchasedAt !== null)
    .sort((a, b) => b.purchasedAt!.getTime() - a.purchasedAt!.getTime()); // más reciente primero

  const formatted = pending.map(formatItem);
  const totalPrice = pending.reduce((sum, i) => sum + (i.price ?? 0), 0);
  const upcoming = formatted.filter((i) => i.isUpcoming);
  const available = formatted.filter((i) => !i.isUpcoming);

  return {
    ok: true as const,
    items: formatted,
    upcoming,
    available,
    totalItems: pending.length,
    totalPrice: Math.round(totalPrice * 100) / 100,
    purchased: purchased.map(formatItem),
    // Resumen para los widgets compactos
    summary: {
      totalItems: pending.length,
      totalPrice: Math.round(totalPrice * 100) / 100,
      upcomingCount: upcoming.length,
      availableCount: available.length,
      physicalCount: pending.filter((i) => i.format === 'PHYSICAL').length,
      digitalCount: pending.filter((i) => i.format === 'DIGITAL').length,
      audiobookCount: pending.filter((i) => i.format === 'AUDIOBOOK').length,
      thisMonthPrice: pending
        .filter((i) => {
          if (!i.plannedMonth) return false;
          const now = new Date();
          const pm = new Date(i.plannedMonth);
          return (
            pm.getFullYear() === now.getFullYear() &&
            pm.getMonth() === now.getMonth()
          );
        })
        .reduce((sum, i) => sum + (i.price ?? 0), 0),
    },
  };
}

/** Añade un ítem a la wishlist. */
export async function addWishlistItem(
  userName: string,
  input: WishlistItemInput,
) {
  const user = await prisma.user.findUnique({
    where: { name: userName },
    select: { id: true },
  });
  if (!user) return { ok: false as const, mensaje: 'Usuario no encontrado' };

  if (!input.title?.trim()) {
    return { ok: false as const, mensaje: 'El título es obligatorio.' };
  }

  let catalogBook: {
    id: string;
    title: string;
    coverUrl: string | null;
    deletedAt: Date | null;
    author: { name: string } | null;
  } | null = null;

  // Si se proporciona bookId, verificar que existe y recuperar sus metadatos.
  if (input.bookId) {
    catalogBook = await prisma.book.findUnique({
      where: { id: input.bookId },
      select: {
        id: true,
        title: true,
        coverUrl: true,
        deletedAt: true,
        author: { select: { name: true } },
      },
    });
    if (!catalogBook || catalogBook.deletedAt) {
      return {
        ok: false as const,
        mensaje: 'Libro no encontrado en el catálogo.',
      };
    }
  } else if (!input.coverUrl?.trim()) {
    const recovered = await recoverCatalogBook({
      title: input.title,
      author: input.author?.trim() ?? null,
      coverUrl: null,
      bookId: null,
      book: null,
    });
    catalogBook = recovered.book
      ? { ...recovered.book, id: recovered.bookId!, deletedAt: null }
      : null;
  }

  const item = await prisma.wishlistItem.create({
    data: {
      userId: user.id,
      bookId: input.bookId ?? catalogBook?.id ?? null,
      title: input.title.trim() || catalogBook?.title || input.title,
      author: input.author?.trim() || catalogBook?.author?.name.trim() || null,
      coverUrl: input.coverUrl?.trim() || catalogBook?.coverUrl?.trim() || null,
      isbn: input.isbn?.trim() ?? null,
      format: input.format ?? 'PHYSICAL',
      priority: input.priority ?? 'MEDIUM',
      price: input.price ?? null,
      releaseDate: parseDate(input.releaseDate),
      plannedMonth: parseDate(input.plannedMonth),
      note: input.note?.trim() ?? null,
    },
  });

  return { ok: true as const, item: formatItem(item) };
}

/** Actualiza un ítem de la wishlist. */
export async function updateWishlistItem(
  userName: string,
  itemId: string,
  input: Partial<WishlistItemInput>,
) {
  const user = await prisma.user.findUnique({
    where: { name: userName },
    select: { id: true },
  });
  if (!user) return { ok: false as const, mensaje: 'Usuario no encontrado' };

  const existing = await prisma.wishlistItem.findUnique({
    where: { id: itemId },
  });
  if (!existing || existing.userId !== user.id) {
    return { ok: false as const, mensaje: 'Ítem no encontrado.' };
  }

  const updated = await prisma.wishlistItem.update({
    where: { id: itemId },
    data: {
      ...(input.title !== undefined && { title: input.title.trim() }),
      ...(input.author !== undefined && {
        author: input.author?.trim() ?? null,
      }),
      ...(input.coverUrl !== undefined && {
        coverUrl: input.coverUrl?.trim() ?? null,
      }),
      ...(input.isbn !== undefined && { isbn: input.isbn?.trim() ?? null }),
      ...(input.format !== undefined && { format: input.format }),
      ...(input.priority !== undefined && { priority: input.priority }),
      ...(input.price !== undefined && { price: input.price }),
      ...(input.releaseDate !== undefined && {
        releaseDate: parseDate(input.releaseDate),
      }),
      ...(input.plannedMonth !== undefined && {
        plannedMonth: parseDate(input.plannedMonth),
      }),
      ...(input.note !== undefined && { note: input.note?.trim() ?? null }),
    },
  });

  return { ok: true as const, item: formatItem(updated) };
}

/** Marca un ítem como comprado (purchasedAt = ahora). */
export async function markWishlistItemPurchased(
  userName: string,
  itemId: string,
  purchasedAt?: string,
) {
  const user = await prisma.user.findUnique({
    where: { name: userName },
    select: { id: true },
  });
  if (!user) return { ok: false as const, mensaje: 'Usuario no encontrado' };

  const existing = await prisma.wishlistItem.findUnique({
    where: { id: itemId },
  });
  if (!existing || existing.userId !== user.id) {
    return { ok: false as const, mensaje: 'Ítem no encontrado.' };
  }

  const date = purchasedAt
    ? (parseDate(purchasedAt) ?? new Date())
    : new Date();
  const updated = await prisma.wishlistItem.update({
    where: { id: itemId },
    data: { purchasedAt: date },
  });

  return { ok: true as const, item: formatItem(updated) };
}

/** Desmarca un ítem comprado (vuelve a la lista activa). */
export async function unmarkWishlistItemPurchased(
  userName: string,
  itemId: string,
) {
  const user = await prisma.user.findUnique({
    where: { name: userName },
    select: { id: true },
  });
  if (!user) return { ok: false as const, mensaje: 'Usuario no encontrado' };

  const existing = await prisma.wishlistItem.findUnique({
    where: { id: itemId },
  });
  if (!existing || existing.userId !== user.id) {
    return { ok: false as const, mensaje: 'Ítem no encontrado.' };
  }

  const updated = await prisma.wishlistItem.update({
    where: { id: itemId },
    data: { purchasedAt: null },
  });

  return { ok: true as const, item: formatItem(updated) };
}

/** Elimina un ítem de la wishlist. */
export async function deleteWishlistItem(userName: string, itemId: string) {
  const user = await prisma.user.findUnique({
    where: { name: userName },
    select: { id: true },
  });
  if (!user) return { ok: false as const, mensaje: 'Usuario no encontrado' };

  const existing = await prisma.wishlistItem.findUnique({
    where: { id: itemId },
  });
  if (!existing || existing.userId !== user.id) {
    return { ok: false as const, mensaje: 'Ítem no encontrado.' };
  }

  await prisma.wishlistItem.delete({ where: { id: itemId } });
  return { ok: true as const };
}

/** Vista de club: wishlist pública de todos los miembros del club activo. */
export async function getClubWishlist(userName: string) {
  const { club, user } = await getCurrentClubContext(userName);

  // Obtener todos los miembros del club
  const members = await prisma.clubMember.findMany({
    where: { clubId: club.id },
    select: { user: { select: { id: true, name: true, avatarUrl: true } } },
  });
  const memberUserIds = members.map((m) => m.user.id);
  const memberMap = new Map(members.map((m) => [m.user.id, m.user]));

  const allItems = await prisma.wishlistItem.findMany({
    where: {
      userId: { in: memberUserIds },
      purchasedAt: null,
    },
    include: {
      book: {
        select: {
          title: true,
          coverUrl: true,
          author: { select: { name: true } },
        },
      },
    },
    orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
  });

  // Agrupar por libro (por bookId si existe, sino por title normalizado)
  type GroupKey = string;
  const groups = new Map<
    GroupKey,
    {
      key: GroupKey;
      bookId: string | null;
      title: string;
      author: string | null;
      coverUrl: string | null;
      releaseDate: Date | null;
      isUpcoming: boolean;
      isInMyWishlist: boolean;
      members: {
        userId: string;
        name: string;
        avatarUrl: string | null;
        price: number | null;
        format: WishlistFormat;
      }[];
    }
  >();

  for (const item of allItems) {
    const key: GroupKey = item.bookId ?? item.title.toLowerCase().trim();
    const existing = groups.get(key);
    const memberInfo = memberMap.get(item.userId);
    if (!memberInfo) continue;

    const title = item.title.trim() || item.book?.title.trim() || item.title;
    const author =
      item.author?.trim() || item.book?.author?.name.trim() || null;
    const coverUrl =
      item.coverUrl?.trim() || item.book?.coverUrl?.trim() || null;

    if (!existing) {
      groups.set(key, {
        key,
        bookId: item.bookId,
        title,
        author,
        coverUrl,
        releaseDate: item.releaseDate,
        isUpcoming: item.releaseDate != null && item.releaseDate > new Date(),
        isInMyWishlist: item.userId === user?.id,
        members: [
          {
            userId: item.userId,
            name: memberInfo.name,
            avatarUrl: memberInfo.avatarUrl,
            price: item.price,
            format: item.format,
          },
        ],
      });
    } else {
      if (!existing.author && author) existing.author = author;
      if (!existing.coverUrl && coverUrl) existing.coverUrl = coverUrl;
      if (item.userId === user?.id) existing.isInMyWishlist = true;
      existing.members.push({
        userId: item.userId,
        name: memberInfo.name,
        avatarUrl: memberInfo.avatarUrl,
        price: item.price,
        format: item.format,
      });
    }
  }

  // Ordenar: primero los que tienen más miembros interesados, luego próximas novedades
  const sorted = [...groups.values()].sort((a, b) => {
    const byMembers = b.members.length - a.members.length;
    if (byMembers !== 0) return byMembers;
    if (a.isUpcoming && !b.isUpcoming) return -1;
    if (!a.isUpcoming && b.isUpcoming) return 1;
    return 0;
  });

  return {
    ok: true as const,
    clubName: club.name,
    items: sorted.map((g) => ({
      ...g,
      releaseDate: g.releaseDate?.toISOString() ?? null,
    })),
    totalItems: allItems.length,
    totalMembers: memberUserIds.length,
    membersWithWishlist: new Set(allItems.map((i) => i.userId)).size,
  };
}
