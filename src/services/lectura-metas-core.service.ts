import type { Prisma } from '@prisma/client';

import { prisma } from '../prisma.js';

export const MAX_METAS = 40;

export type MetaEntrada = { capitulo: number; fecha: string };

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

function esFechaReal(fecha: string) {
  if (!FECHA.test(fecha)) return false;
  const d = new Date(`${fecha}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === fecha;
}

/// Valida y ordena las metas que llegan de la app. Las metas son opcionales:
/// `undefined`/`null` significa «no tocar» y `[]` «sin metas».
export function normalizarMetas(
  raw: unknown,
  capitulos: number,
): { ok: true; metas: MetaEntrada[] } | { ok: false; mensaje: string } {
  if (!Array.isArray(raw)) return { ok: true, metas: [] };
  if (raw.length > MAX_METAS) {
    return { ok: false, mensaje: `Como máximo ${MAX_METAS} metas.` };
  }
  const porCapitulo = new Map<number, string>();
  for (const item of raw) {
    if (item === null || typeof item !== 'object') {
      return { ok: false, mensaje: 'Una meta no es válida.' };
    }
    const registro = item as Record<string, unknown>;
    const capitulo = Number(registro.capitulo);
    const fecha = String(registro.fecha ?? '').trim();
    if (!Number.isInteger(capitulo) || capitulo < 1 || capitulo > capitulos) {
      return {
        ok: false,
        mensaje: `El capítulo de una meta debe estar entre 1 y ${capitulos}.`,
      };
    }
    if (!esFechaReal(fecha)) {
      return { ok: false, mensaje: 'La fecha de una meta no es válida.' };
    }
    if (porCapitulo.has(capitulo)) {
      return { ok: false, mensaje: `El capítulo ${capitulo} tiene dos metas.` };
    }
    porCapitulo.set(capitulo, fecha);
  }
  const metas = [...porCapitulo.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([capitulo, fecha]) => ({ capitulo, fecha }));
  // Una meta posterior no puede caer antes que la anterior.
  for (let i = 1; i < metas.length; i++) {
    if (metas[i]!.fecha < metas[i - 1]!.fecha) {
      return {
        ok: false,
        mensaje: `La meta del capítulo ${metas[i]!.capitulo} no puede ser antes que la del capítulo ${metas[i - 1]!.capitulo}.`,
      };
    }
  }
  return { ok: true, metas };
}

/// Sustituye las metas de una lectura. Si una meta conserva su fecha, también
/// conserva las marcas de aviso para no repetirlo.
export async function guardarMetas(
  tx: Prisma.TransactionClient,
  readingId: string,
  metas: MetaEntrada[],
) {
  const actuales = await tx.readingGoal.findMany({ where: { readingId } });
  const porCapitulo = new Map(actuales.map((g) => [g.upToChapter, g]));
  await tx.readingGoal.deleteMany({ where: { readingId } });
  if (metas.length === 0) return;
  await tx.readingGoal.createMany({
    data: metas.map((m) => {
      const previa = porCapitulo.get(m.capitulo);
      const misma =
        previa && previa.dueDate.toISOString().slice(0, 10) === m.fecha;
      return {
        readingId,
        upToChapter: m.capitulo,
        dueDate: new Date(`${m.fecha}T00:00:00.000Z`),
        remindedDayBeforeAt: misma ? previa.remindedDayBeforeAt : null,
        remindedTodayAt: misma ? previa.remindedTodayAt : null,
      };
    }),
  });
}

export async function listarMetas(readingId: string): Promise<MetaEntrada[]> {
  const metas = await prisma.readingGoal.findMany({
    where: { readingId },
    orderBy: { upToChapter: 'asc' },
  });
  return metas.map((m) => ({
    capitulo: m.upToChapter,
    fecha: m.dueDate.toISOString().slice(0, 10),
  }));
}

/// «el capítulo 5» o «los capítulos 1 a 5», según el rango que cubre la meta.
export function textoRango(desde: number, hasta: number) {
  return desde >= hasta
    ? `el capítulo ${hasta}`
    : `los capítulos ${desde} a ${hasta}`;
}

export function fechaMadrid(ahora: Date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(ahora);
}

export function sumarDias(fecha: string, dias: number) {
  const d = new Date(`${fecha}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}
