import { prisma } from '../prisma.js';
import { datosTalento, listaGeneros } from '../utils/generos.utils.js';
import { fechaMadrid } from './lectura-metas-core.service.js';
import { cached } from '../utils/simple-cache.js';

const MS_SEMANA = 7 * 24 * 60 * 60 * 1000;
/// Lunes de referencia para contar semanas (2026-01-05).
const INICIO = Date.UTC(2026, 0, 5);

/// Número de semana (desde el lunes de referencia) de una fecha `yyyy-MM-dd`.
export function indiceSemana(fecha: string) {
  const [y, m, d] = fecha.split('-').map(Number);
  return Math.floor((Date.UTC(y!, (m ?? 1) - 1, d) - INICIO) / MS_SEMANA);
}

/// Etiqueta estable de la semana, p. ej. «S0042». Se guarda al fijar a mano.
export function etiquetaSemana(fecha: string) {
  return `S${String(indiceSemana(fecha)).padStart(4, '0')}`;
}

/// Elige la autora de la semana: la fijada a mano para esta semana y, si no
/// hay, una rotación por semanas entre los libros con sello (por orden de
/// aprobación), para que cada semana toque una distinta.
export function elegirAutoraDeLaSemana<T extends { talentFeaturedWeek: string | null }>(
  libros: T[],
  fecha: string,
): T | null {
  if (libros.length === 0) return null;
  const etiqueta = etiquetaSemana(fecha);
  const fijada = libros.find((l) => l.talentFeaturedWeek === etiqueta);
  if (fijada) return fijada;
  const indice = ((indiceSemana(fecha) % libros.length) + libros.length) % libros.length;
  return libros[indice]!;
}

export async function getAutoraDeLaSemana(hoy: Date = new Date()) {
  const fecha = fechaMadrid(hoy);
  return cached(`autora-semana:${etiquetaSemana(fecha)}`, 10 * 60 * 1000, async () => {
    const libros = await prisma.book.findMany({
      where: { emergingTalent: true, deletedAt: null },
      include: { author: true, genre: true },
      orderBy: { createdAt: 'asc' },
    });
    const libro = elegirAutoraDeLaSemana(libros, fecha);
    if (!libro) return { ok: true, libro: null };
    return {
      ok: true,
      libro: {
        bookId: libro.id,
        titulo: libro.title,
        autora: libro.author?.name ?? '',
        coverUrl: libro.coverUrl ?? '',
        generos: listaGeneros(libro),
        sinopsis: libro.synopsis ?? '',
        ...datosTalento(libro),
      },
    };
  });
}

/// Fija a mano un libro como autora de la semana (la actual).
export async function destacarEstaSemana(bookId: string, hoy: Date = new Date()) {
  const etiqueta = etiquetaSemana(fechaMadrid(hoy));
  const libro = await prisma.book.findFirst({
    where: { id: bookId, emergingTalent: true, deletedAt: null },
    select: { id: true, title: true },
  });
  if (!libro) return { ok: false as const, mensaje: 'Ese libro no tiene el sello de Talento emergente.' };
  await prisma.book.updateMany({
    where: { talentFeaturedWeek: etiqueta, id: { not: libro.id } },
    data: { talentFeaturedWeek: null },
  });
  await prisma.book.update({ where: { id: libro.id }, data: { talentFeaturedWeek: etiqueta } });
  return { ok: true as const, titulo: libro.title };
}
