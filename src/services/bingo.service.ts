/**
 * Bingo lector — cartón anual de retos literarios tipo book journal
 * (portada de un color, terminar una saga, autor debut...), a diferencia de
 * los logros: aquí no se calcula nada solo, es la propia lectora quien
 * decide qué libro cumple cada casilla y la marca a mano.
 *
 * Las 25 casillas son fijas y viven en código (BINGO_SQUARES), no en la
 * base de datos — solo se persiste qué casillas ha marcado cada usuaria
 * cada año, y con qué nota opcional.
 */

import { prisma } from '../prisma.js';

export const BINGO_SQUARE_KEYS = [
  'portada_roja_rosa',
  'portada_amarilla',
  'portada_blanco_negro',
  'ambientado_otro_pais',
  'fantasia',
  'thriller_misterio',
  'romance',
  'romantasy',
  'contemporanea',
  'terror',
  'autor_debut',
  'autor_traducido',
  'termina_saga',
  'relectura',
  'audiolibro',
  'mas_500_paginas',
  'menos_150_paginas',
  'clasico',
  'premio_literario',
  'adaptado_pantalla',
  'recomendado',
  'tbr_mas_de_un_anio',
  'narrador_poco_fiable',
  'coescrito',
  'elegido_al_azar',
] as const;

export type BingoSquareKey = (typeof BINGO_SQUARE_KEYS)[number];

const VALID_KEYS = new Set<string>(BINGO_SQUARE_KEYS);

export function esCasillaBingoValida(key: string): key is BingoSquareKey {
  return VALID_KEYS.has(key);
}

export async function getBingoLector(userId: string, year: number) {
  const marcas = await prisma.readingBingoMark.findMany({
    where: { userId, year },
    select: { squareKey: true, nota: true, markedAt: true },
  });
  return {
    ok: true as const,
    year,
    marcadas: marcas.map((m) => ({
      squareKey: m.squareKey,
      nota: m.nota,
      marcadaEn: m.markedAt,
    })),
  };
}

export async function marcarCasillaBingo(
  userId: string,
  year: number,
  squareKey: string,
  marcar: boolean,
  nota?: string | null,
) {
  if (!esCasillaBingoValida(squareKey)) {
    return { ok: false as const, mensaje: 'Casilla desconocida' };
  }
  if (marcar) {
    await prisma.readingBingoMark.upsert({
      where: { userId_year_squareKey: { userId, year, squareKey } },
      create: { userId, year, squareKey, nota: nota?.trim() || null },
      update: { nota: nota?.trim() || null },
    });
  } else {
    await prisma.readingBingoMark
      .delete({ where: { userId_year_squareKey: { userId, year, squareKey } } })
      .catch(() => undefined); // ya no estaba marcada — no pasa nada
  }
  return getBingoLector(userId, year);
}
