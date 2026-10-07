import { Prisma } from '@prisma/client';

import { prisma } from '../prisma.js';
import { resolveCanonicalBookId } from './book-identity.service.js';

/// Tamaño máximo del kit serializado. Un kit real (paleta, atmósfera, playlist)
/// ocupa un par de KB; esto solo evita que se use como almacén de otra cosa.
export const KIT_MAX_BYTES = 32 * 1024;

export function kitEsValido(kit: unknown): kit is Record<string, unknown> {
  if (kit === null || typeof kit !== 'object' || Array.isArray(kit)) return false;
  return Buffer.byteLength(JSON.stringify(kit), 'utf8') <= KIT_MAX_BYTES;
}

/// Kit guardado de [userId] para [bookId], o null si aún no tiene.
export async function getKitLectura(userId: string, bookId: string) {
  const id = String(bookId || '').trim();
  if (!id) return { ok: false, mensaje: 'Falta el identificador del libro' };

  const resolvedId = await resolveCanonicalBookId(prisma, id);
  const fila = await prisma.readingKit.findUnique({
    where: { userId_bookId: { userId, bookId: resolvedId } },
    select: { data: true, updatedAt: true },
  });
  if (!fila) return { ok: true, kit: null, updatedAt: null };
  return { ok: true, kit: fila.data, updatedAt: fila.updatedAt.toISOString() };
}

/// Guarda (reemplaza) el kit de [userId] para [bookId].
export async function guardarKitLectura(userId: string, bookId: string, kit: unknown) {
  const id = String(bookId || '').trim();
  if (!id) return { ok: false, mensaje: 'Falta el identificador del libro' };
  if (!kitEsValido(kit)) {
    return { ok: false, mensaje: 'El kit no es válido o es demasiado grande' };
  }

  const resolvedId = await resolveCanonicalBookId(prisma, id);
  const libro = await prisma.book.findFirst({
    where: { id: resolvedId, deletedAt: null },
    select: { id: true },
  });
  if (!libro) return { ok: false, mensaje: 'Libro no encontrado' };

  const data = kit as Prisma.InputJsonValue;
  const fila = await prisma.readingKit.upsert({
    where: { userId_bookId: { userId, bookId: libro.id } },
    update: { data },
    create: { userId, bookId: libro.id, data },
    select: { updatedAt: true },
  });
  return { ok: true, updatedAt: fila.updatedAt.toISOString() };
}
