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

export type PosicionConversacion =
  | { tipo: 'prologo' }
  | { tipo: 'capitulo'; n: number }
  | { tipo: 'cierre' };

/// Qué es cada conversación según su orden. Se calcula por posición y no por
/// título porque los capítulos se pueden renombrar.
export function posicionDeConversacion(
  order: number,
  hasPrologue: boolean,
  capitulos: number,
): PosicionConversacion {
  const primerCapitulo = hasPrologue ? 1 : 0;
  if (hasPrologue && order === 0) return { tipo: 'prologo' };
  const n = order - primerCapitulo + 1;
  if (n >= 1 && n <= capitulos) return { tipo: 'capitulo', n };
  return { tipo: 'cierre' };
}

export type BloqueoMetas =
  | { bloqueado: false }
  | { bloqueado: true; desbloqueaEl: string };

/// En las lecturas con metas, los capítulos que quedan por delante de la meta
/// en curso se cierran para que nadie se adelante. La meta en curso es la
/// primera cuya fecha aún no ha pasado; al pasar su día se abre la siguiente.
/// Sin metas, o con todas ya cumplidas, todo está abierto.
export function bloqueoPorMetas(
  metas: MetaEntrada[],
  hoy: string,
  capitulos: number,
  posicion: PosicionConversacion,
): BloqueoMetas {
  if (metas.length === 0 || posicion.tipo === 'prologo') {
    return { bloqueado: false };
  }
  const ordenadas = [...metas].sort((a, b) => a.capitulo - b.capitulo);
  const actual = ordenadas.find((m) => m.fecha >= hoy);
  if (!actual) return { bloqueado: false };

  const n = posicion.tipo === 'capitulo' ? posicion.n : capitulos;
  const cerrado =
    posicion.tipo === 'capitulo'
      ? n > actual.capitulo
      : actual.capitulo < capitulos;
  if (!cerrado) return { bloqueado: false };

  // Se abre el día siguiente a la fecha de la meta anterior a la que lo cubre.
  const indice = ordenadas.findIndex((m) => m.capitulo >= n);
  const previa =
    indice === -1 ? ordenadas[ordenadas.length - 1] : ordenadas[indice - 1];
  const base = previa ?? actual;
  return { bloqueado: true, desbloqueaEl: sumarDias(base.fecha, 1) };
}

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
  'septiembre', 'octubre', 'noviembre', 'diciembre',
];

/// «2026-10-21» → «21 de octubre».
export function fechaLegibleEs(fecha: string) {
  const [, mes, dia] = fecha.split('-').map(Number);
  return `${dia} de ${MESES[(mes ?? 1) - 1]}`;
}

export function mensajeCapituloCerrado(desbloqueaEl: string) {
  return `Este capítulo se abre el ${fechaLegibleEs(desbloqueaEl)}, cuando pase la meta anterior. ¡Así nadie se adelanta!`;
}
