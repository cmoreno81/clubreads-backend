import { createHash } from 'node:crypto';
import { z } from 'zod';

import { prisma } from '../prisma.js';
import { logger } from '../logging/logger.js';
import { MAX_GENEROS } from '../utils/generos.utils.js';
import { subirPortadaTalentoDesdeBase64 } from './cloudinary.service.js';
import { avisarNuevaFichaTalento } from './talento-emergente-aviso.service.js';

/// Versión del texto de condiciones que ve la autora en el formulario web.
/// Si cambian las condiciones, súbela: queda guardada en cada ficha.
export const TERMINOS_TALENTO_VERSION = '2026-10-12';

/// Géneros que ofrece el formulario (mismos nombres que usa la app).
export const GENEROS_TALENTO = [
  'Fantasía',
  'Romantasy',
  'Romance',
  'Dark Romance',
  'Mafia Romance',
  'Paranormal',
  'Thriller',
  'Novela negra',
  'Dark Academia',
  'Drama',
  'Clásicos',
  'Distopía',
  'Novela contemporánea',
  'Novela histórica',
  'Ciencia ficción',
  'Terror',
  'Gótico',
  'Cómic',
  'No ficción',
  'Infantil',
  'Juvenil',
  'Poesía',
] as const;

const IDIOMAS = ['es', 'ca', 'gl', 'eu', 'en', 'fr', 'pt', 'it', 'de'] as const;

/// La portada la reduce la página del formulario antes de enviarla.
const MAX_PORTADA_BASE64 = 3 * 1024 * 1024;

const texto = (min: number, max: number) => z.string().trim().min(min).max(max);

const urlHttps = z
  .string()
  .trim()
  .max(2048)
  .url()
  .refine((valor) => valor.startsWith('https://'), 'Debe empezar por https://');

export const fichaTalentoSchema = z.object({
  titulo: texto(1, 200),
  autora: texto(1, 120),
  email: z.string().trim().toLowerCase().email().max(320),
  perfil: z.string().trim().max(300).optional().default(''),
  genero: z.enum(GENEROS_TALENTO),
  generosExtra: z.array(z.enum(GENEROS_TALENTO)).max(10).default([]),
  idioma: z.enum(IDIOMAS).default('es'),
  paginas: z.coerce.number().int().min(1).max(5000).optional(),
  picante: z.coerce.number().int().min(0).max(5),
  tropos: z.array(texto(1, 40)).max(8).default([]),
  sinopsis: texto(40, 2500),
  nota: z.string().trim().max(700).optional().default(''),
  enlace: urlHttps,
  portada: z
    .string()
    .startsWith('data:image/')
    .max(MAX_PORTADA_BASE64),
  derechos: z.literal(true),
  contenidoAdulto: z.literal(true),
  condiciones: z.literal(true),
  /// Trampa para bots: el formulario lo deja vacío y oculto.
  web: z.string().max(0).optional().default(''),
});

export type FichaTalentoEntrada = z.infer<typeof fichaTalentoSchema>;

export type ResultadoFicha =
  | { ok: true; id: string }
  | { ok: false; status: number; error: string; mensaje: string; campos?: string[] };

const MAX_PENDIENTES = 300;
const MAX_POR_CORREO_Y_DIA = 3;

function hashIp(ip: string) {
  const sal = process.env.TALENTO_IP_SALT?.trim() || 'clubreads-talento';
  return createHash('sha256').update(`${sal}|${ip}`).digest('hex').slice(0, 32);
}

export function normalizarTropos(tropos: string[]) {
  const vistos = new Set<string>();
  const salida: string[] = [];
  for (const t of tropos) {
    const limpio = t.trim();
    const clave = limpio.toLowerCase();
    if (!limpio || vistos.has(clave)) continue;
    vistos.add(clave);
    salida.push(limpio);
  }
  return salida;
}

export async function recibirFichaTalento(
  cuerpo: unknown,
  ip: string,
  subirPortada: typeof subirPortadaTalentoDesdeBase64 = subirPortadaTalentoDesdeBase64,
): Promise<ResultadoFicha> {
  const analizado = fichaTalentoSchema.safeParse(cuerpo);
  if (!analizado.success) {
    const campos = [
      ...new Set(analizado.error.issues.map((i) => String(i.path[0] ?? ''))),
    ].filter(Boolean);
    // Un bot que rellena la trampa recibe un «ok» falso para no darle pistas.
    if (campos.includes('web')) return { ok: true, id: 'ok' };
    return {
      ok: false,
      status: 400,
      error: 'FICHA_NO_VALIDA',
      mensaje: 'Revisa los campos marcados y vuelve a enviarla.',
      campos,
    };
  }
  const ficha = analizado.data;

  const pendientes = await prisma.emergingTalentSubmission.count({
    where: { status: 'PENDING' },
  });
  if (pendientes >= MAX_PENDIENTES) {
    return {
      ok: false,
      status: 503,
      error: 'FORMULARIO_LLENO',
      mensaje: 'Ahora mismo no puedo recibir más fichas. Inténtalo más adelante.',
    };
  }

  const hoy = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const delMismoCorreo = await prisma.emergingTalentSubmission.count({
    where: { contactEmail: ficha.email, createdAt: { gte: hoy } },
  });
  if (delMismoCorreo >= MAX_POR_CORREO_Y_DIA) {
    return {
      ok: false,
      status: 429,
      error: 'DEMASIADAS_FICHAS',
      mensaje: 'Ya has enviado varias fichas hoy. Escríbeme y lo vemos.',
    };
  }

  let portada: { url: string; publicId: string };
  try {
    portada = await subirPortada({ imageBase64: ficha.portada });
  } catch (error) {
    logger.warn({ err: error }, 'talento_cover_upload_failed');
    return {
      ok: false,
      status: 422,
      error: 'PORTADA_NO_VALIDA',
      mensaje: 'No he podido procesar la portada. Prueba con otra imagen (JPG o PNG).',
      campos: ['portada'],
    };
  }

  const principal = ficha.genero;
  const extras = [...new Set(ficha.generosExtra)]
    .filter((g) => g !== principal)
    .slice(0, MAX_GENEROS - 1);

  const creada = await prisma.emergingTalentSubmission.create({
    data: {
      title: ficha.titulo,
      authorName: ficha.autora,
      contactEmail: ficha.email,
      authorProfile: ficha.perfil || null,
      genre: principal,
      extraGenres: extras,
      language: ficha.idioma,
      pages: ficha.paginas ?? null,
      spicyLevel: ficha.picante,
      tropes: normalizarTropos(ficha.tropos),
      synopsis: ficha.sinopsis,
      authorNote: ficha.nota || null,
      buyUrl: ficha.enlace,
      coverUrl: portada.url,
      coverPublicId: portada.publicId,
      termsVersion: TERMINOS_TALENTO_VERSION,
      ipHash: hashIp(ip),
    },
    select: { id: true, title: true, authorName: true },
  });

  void avisarNuevaFichaTalento({
    id: creada.id,
    titulo: creada.title,
    autora: creada.authorName,
  }).catch((error) => logger.warn({ err: error }, 'talento_notify_failed'));

  return { ok: true, id: creada.id };
}
