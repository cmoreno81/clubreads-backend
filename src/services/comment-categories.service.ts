import { Prisma } from '@prisma/client';

import { prisma } from '../prisma.js';

export const CATEGORY_COUNT = 5;
export const CATEGORY_NAME_MAX = 24;
export const CATEGORY_EMOJI_MAX = 8;

export type CommentCategory = { emoji: string; nombre: string };

/// Quita caracteres de control y espacios sobrantes de un texto corto.
export function limpiarTextoCorto(value: unknown, max: number): string {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/// Normaliza las 5 categorías recibidas; devuelve null si no son válidas.
export function categoriasValidas(value: unknown): CommentCategory[] | null {
  if (!Array.isArray(value) || value.length !== CATEGORY_COUNT) return null;
  const result: CommentCategory[] = [];
  for (const item of value) {
    if (item === null || typeof item !== 'object') return null;
    const record = item as Record<string, unknown>;
    const nombre = limpiarTextoCorto(record.nombre, CATEGORY_NAME_MAX);
    const emoji = limpiarTextoCorto(record.emoji, CATEGORY_EMOJI_MAX);
    if (!nombre) return null;
    result.push({ emoji, nombre });
  }
  return result;
}

/// Categorías personalizadas de [userId], o null si usa las de siempre.
export async function getCategoriasComentario(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { commentCategories: true },
  });
  const categorias = categoriasValidas(user?.commentCategories);
  return { ok: true, categorias };
}

/// Guarda las categorías de [userId]; `null` las restablece.
export async function guardarCategoriasComentario(userId: string, value: unknown) {
  if (value === null) {
    await prisma.user.update({
      where: { id: userId },
      data: { commentCategories: Prisma.DbNull },
    });
    return { ok: true, categorias: null };
  }
  const categorias = categoriasValidas(value);
  if (!categorias) {
    return { ok: false, mensaje: 'Las categorías no son válidas' };
  }
  await prisma.user.update({
    where: { id: userId },
    data: { commentCategories: categorias as unknown as Prisma.InputJsonValue },
  });
  return { ok: true, categorias };
}
