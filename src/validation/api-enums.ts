import { z } from 'zod';

const readingStatusValues = [
  'PENDIENTE', 'PENDING',
  'LEYENDO', 'READING',
  'PAUSADO', 'PAUSED',
  'FINALIZADO', 'FINISHED',
  'ABANDONADO', 'ABANDONED',
  'RELECTURA', 'RELEYENDO', 'REREADING',
] as const;

const readingStatusMap = {
  PENDIENTE: 'PENDING', PENDING: 'PENDING',
  LEYENDO: 'READING', READING: 'READING',
  PAUSADO: 'PAUSED', PAUSED: 'PAUSED',
  FINALIZADO: 'FINISHED', FINISHED: 'FINISHED',
  ABANDONADO: 'ABANDONED', ABANDONED: 'ABANDONED',
  RELECTURA: 'REREADING', RELEYENDO: 'REREADING', REREADING: 'REREADING',
} as const;

const readingFormatValues = [
  '', 'FISICO', 'FÍSICO', 'PHYSICAL', 'PAPER',
  'DIGITAL', 'EBOOK',
  'AUDIOLIBRO', 'AUDIOBOOK', 'AUDIO',
] as const;

const readingFormatMap = {
  '': '',
  FISICO: 'PHYSICAL', 'FÍSICO': 'PHYSICAL', PHYSICAL: 'PHYSICAL', PAPER: 'PHYSICAL',
  DIGITAL: 'DIGITAL', EBOOK: 'DIGITAL',
  AUDIOLIBRO: 'AUDIOBOOK', AUDIOBOOK: 'AUDIOBOOK', AUDIO: 'AUDIOBOOK',
} as const;

const priorityValues = ['', 'BAJA', 'LOW', 'MEDIA', 'MEDIUM', 'ALTA', 'HIGH'] as const;
const priorityMap = {
  '': '', BAJA: 'LOW', LOW: 'LOW', MEDIA: 'MEDIUM', MEDIUM: 'MEDIUM', ALTA: 'HIGH', HIGH: 'HIGH',
} as const;

const reactionValues = ['LIKE', 'AGREE', 'ANGRY', 'FUNNY', 'THUMBS_UP', 'CRY', 'WOW', 'SWEAR', 'CLAP'] as const;
const readingTypeValues = ['LIBRE', 'FREE', 'Libre', 'OFICIAL', 'CLUBVISION', 'Oficial'] as const;
const readingTypeMap = { LIBRE: 'FREE', FREE: 'FREE', Libre: 'FREE', OFICIAL: 'CLUBVISION', CLUBVISION: 'CLUBVISION', Oficial: 'CLUBVISION' } as const;

export const statusSchema = z.enum(readingStatusValues).transform((value) => readingStatusMap[value]);
export const formatSchema = z.enum(readingFormatValues).transform((value) => readingFormatMap[value]);
export const prioritySchema = z.enum(priorityValues).transform((value) => priorityMap[value]);
export const reactionSchema = z.enum(reactionValues);
export const readingTypeSchema = z.enum(readingTypeValues).transform((value) => readingTypeMap[value]);

export function normalizeReadingStatus(value: unknown) {
  const result = statusSchema.safeParse(value);
  return result.success ? result.data : null;
}

export function normalizeReadingFormat(value: unknown) {
  const result = formatSchema.safeParse(value);
  return result.success ? result.data : null;
}

export function normalizePriority(value: unknown) {
  const result = prioritySchema.safeParse(value);
  return result.success ? result.data : null;
}

export function normalizeReadingType(value: unknown) {
  const result = readingTypeSchema.safeParse(value);
  return result.success ? result.data : null;
}