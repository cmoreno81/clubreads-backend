import { ReadingStatus } from '@prisma/client';

import { ratingFromFlutter } from './rating.utils.js';

function parseDate(value: unknown, label: 'inicio' | 'finalización', now: Date) {
  const text = String(value ?? '').trim();
  if (!text) return { ok: true as const, date: null };
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return { ok: false as const, mensaje: `La fecha de ${label} no es válida` };
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
  const todayInMadrid = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== Number(match[1]) ||
    date.getUTCMonth() !== Number(match[2]) - 1 ||
    date.getUTCDate() !== Number(match[3]) ||
    text > todayInMadrid
  ) {
    return { ok: false as const, mensaje: `La fecha de ${label} no es válida` };
  }
  return { ok: true as const, date };
}

export function validateReadingTransitionInput(input: {
  status: ReadingStatus;
  valoracion?: unknown;
  fechaInicio?: unknown;
  fechaFin?: unknown;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const start = parseDate(input.fechaInicio, 'inicio', now);
  if (!start.ok) return start;
  const end = parseDate(input.fechaFin, 'finalización', now);
  if (!end.ok) return end;
  if (start.date && end.date && end.date < start.date) {
    return { ok: false as const, mensaje: 'La fecha de finalización no puede ser anterior al inicio' };
  }
  const rating = ratingFromFlutter(String(input.valoracion ?? ''));
  if (input.status === ReadingStatus.FINISHED && (rating === null || rating <= 0)) {
    return {
      ok: false as const,
      mensaje: 'Los libros finalizados necesitan una valoración mayor que 0',
    };
  }
  return {
    ok: true as const,
    rating,
    startDate: start.date,
    endDate: end.date,
  };
}
