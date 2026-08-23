import type { Request, Response } from 'express';
import {
  addWishlistItem,
  deleteWishlistItem,
  getClubWishlist,
  getWishlist,
  updateWishlistItem,
} from '../services/wishlist.service.js';
import { WishlistFormat, WishlistPriority } from '@prisma/client';

const VALID_FORMATS = new Set<string>(Object.values(WishlistFormat));
const VALID_PRIORITIES = new Set<string>(Object.values(WishlistPriority));

function parseFormat(value: unknown): WishlistFormat | undefined {
  if (typeof value === 'string' && VALID_FORMATS.has(value)) return value as WishlistFormat;
  return undefined;
}

function parsePriority(value: unknown): WishlistPriority | undefined {
  if (typeof value === 'string' && VALID_PRIORITIES.has(value)) return value as WishlistPriority;
  return undefined;
}

function parsePrice(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!isFinite(n) || n < 0 || n > 9999) return null;
  return Math.round(n * 100) / 100;
}

export async function handleGetWishlist(req: Request, res: Response) {
  try {
    const result = await getWishlist(req.auth!.userName);
    return res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error inesperado';
    return res.status(500).json({ ok: false, mensaje: message });
  }
}

export async function handleAddWishlistItem(req: Request, res: Response) {
  try {
    const body = req.body ?? {};
    if (!body.title?.trim()) {
      return res.status(400).json({ ok: false, mensaje: 'El título es obligatorio.' });
    }
    const result = await addWishlistItem(req.auth!.userName, {
      bookId: typeof body.bookId === 'string' ? body.bookId : null,
      title: String(body.title).trim(),
      author: body.author ? String(body.author).trim() : null,
      coverUrl: body.coverUrl ? String(body.coverUrl).trim() : null,
      isbn: body.isbn ? String(body.isbn).trim() : null,
      format: parseFormat(body.format) ?? 'PHYSICAL',
      priority: parsePriority(body.priority) ?? 'MEDIUM',
      price: parsePrice(body.price),
      releaseDate: body.releaseDate ? String(body.releaseDate) : null,
      plannedMonth: body.plannedMonth ? String(body.plannedMonth) : null,
      note: body.note ? String(body.note).trim() : null,
    });
    if (!result.ok) return res.status(400).json(result);
    return res.status(201).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error inesperado';
    return res.status(500).json({ ok: false, mensaje: message });
  }
}

export async function handleUpdateWishlistItem(req: Request, res: Response) {
  try {
    const id = req.params['id'] as string;
    if (!id) return res.status(400).json({ ok: false, mensaje: 'ID requerido.' });
    const body = req.body ?? {};
    const result = await updateWishlistItem(req.auth!.userName, id, {
      ...(body.title !== undefined && { title: String(body.title) }),
      ...(body.author !== undefined && { author: body.author ? String(body.author) : null }),
      ...(body.coverUrl !== undefined && { coverUrl: body.coverUrl ? String(body.coverUrl) : null }),
      ...(body.isbn !== undefined && { isbn: body.isbn ? String(body.isbn) : null }),
      ...(body.format !== undefined && { format: parseFormat(body.format) }),
      ...(body.priority !== undefined && { priority: parsePriority(body.priority) }),
      ...(body.price !== undefined && { price: parsePrice(body.price) }),
      ...(body.releaseDate !== undefined && { releaseDate: body.releaseDate ? String(body.releaseDate) : null }),
      ...(body.plannedMonth !== undefined && { plannedMonth: body.plannedMonth ? String(body.plannedMonth) : null }),
      ...(body.note !== undefined && { note: body.note ? String(body.note) : null }),
    });
    if (!result.ok) return res.status(404).json(result);
    return res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error inesperado';
    return res.status(500).json({ ok: false, mensaje: message });
  }
}

export async function handleDeleteWishlistItem(req: Request, res: Response) {
  try {
    const id = req.params['id'] as string;
    if (!id) return res.status(400).json({ ok: false, mensaje: 'ID requerido.' });
    const result = await deleteWishlistItem(req.auth!.userName, id);
    if (!result.ok) return res.status(404).json(result);
    return res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error inesperado';
    return res.status(500).json({ ok: false, mensaje: message });
  }
}

export async function handleGetClubWishlist(req: Request, res: Response) {
  try {
    const result = await getClubWishlist(req.auth!.userName);
    return res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error inesperado';
    return res.status(500).json({ ok: false, mensaje: message });
  }
}
