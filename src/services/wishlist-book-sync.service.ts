import { StoreFormat } from '@prisma/client';

import { prisma } from '../prisma.js';
import {
  canonicalBookKey,
  findBookByIdentity,
  normalizeBookIsbn,
} from './book-identity.service.js';
import {
  authorTokens,
  isbn13,
  normTitle,
  type CatalogBook,
  type Candidate,
} from './store-link-sync.service.js';

// Un deseo escrito a mano nace sin libro del catálogo y, sin él, no puede
// tener botón de compra. Si Casa del Libro tiene ese libro en su feed (y el
// cruce es seguro: ISBN, o título + autora casi idénticos), se crea el libro
// en el catálogo, se le pone su enlace de papel y se liga el deseo. Corre en
// la misma pasada nocturna que ya descarga el feed.

export type GrupoDeseos = {
  titulo: string;
  autora: string | null;
  ids: string[];
};

/// Género del catálogo a partir de la categoría de la tienda
/// ("Libros>Literatura>Novela romántica y erótica>…"). Si no se reconoce,
/// "Sin género": cualquiera puede corregirlo después desde la ficha.
export function generoDesdeCategoria(categoria: string | null | undefined) {
  const c = (categoria ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
  if (c.includes('terror')) return 'Terror';
  if (/romantic|erotic/.test(c)) return 'Romance';
  if (c.includes('ciencia ficcion')) return 'Ciencia ficción';
  if (c.includes('fantas')) return 'Fantasía';
  if (/negra|policiac|thriller|misterio/.test(c)) return 'Novela negra';
  if (c.includes('historic')) return 'Novela histórica';
  if (c.includes('poesia')) return 'Poesía';
  if (/comic|manga|novela grafica/.test(c)) return 'Cómic';
  if (c.includes('infantil')) return 'Infantil';
  if (c.includes('juvenil')) return 'Juvenil';
  if (c.includes('clasic')) return 'Clásicos';
  return 'Sin género';
}

/// El feed escribe las autoras en mayúsculas ("EDGAR ALLAN POE"): se pasa a
/// "Edgar Allan Poe" respetando iniciales ("J.R.R.") y partículas.
export function nombreDeAutora(nombre: string) {
  const sueltas = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'van', 'von', 'da']);
  const limpio = nombre.trim().replace(/\s+/g, ' ');
  if (limpio !== limpio.toUpperCase()) return limpio; // ya viene bien escrito
  return limpio
    .toLowerCase()
    .split(' ')
    .map((w, i) => {
      if (/^([a-z]\.)+$/.test(w)) return w.toUpperCase();
      if (i > 0 && sueltas.has(w)) return w;
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(' ');
}

export async function cargarDeseosSinLibro() {
  const deseos = await prisma.wishlistItem.findMany({
    where: { bookId: null, purchasedAt: null },
    select: { id: true, title: true, author: true, isbn: true },
  });
  const grupos = new Map<string, GrupoDeseos>();
  const catalogo = new Map<string, CatalogBook>();
  for (const d of deseos) {
    const titulo = d.title.trim();
    if (!titulo) continue;
    const clave = canonicalBookKey(titulo, d.author ?? '');
    const grupo = grupos.get(clave);
    if (grupo) {
      grupo.ids.push(d.id);
      continue;
    }
    grupos.set(clave, { titulo, autora: d.author?.trim() || null, ids: [d.id] });
    catalogo.set(clave, {
      id: clave,
      nt: normTitle(titulo),
      authors: authorTokens(d.author),
      isbn: isbn13(d.isbn),
      wanted: new Set(['es']),
    });
  }
  return { grupos, catalogo: [...catalogo.values()] };
}

/// Crea (o reutiliza) el libro de cada deseo reconocido y liga el deseo.
/// Devuelve cuántos libros nuevos se han creado.
export async function crearLibrosDeDeseos(
  candidatos: Map<string, Candidate>,
  grupos: Map<string, GrupoDeseos>,
  dryRun: boolean,
) {
  let creados = 0;
  for (const c of candidatos.values()) {
    if (c.format !== StoreFormat.PAPEL || c.language !== 'es') continue;
    const grupo = grupos.get(c.bookId); // aquí bookId es la clave del deseo
    if (!grupo) continue;
    try {
      const autora = grupo.autora ?? nombreDeAutora(c.feedAuthor);
      const existente = await findBookByIdentity(prisma, {
        title: grupo.titulo,
        authorName: autora,
        isbn: c.ean ?? undefined,
      });
      if (existente) {
        // Ya está en el catálogo: solo se liga el deseo (el enlace de compra
        // lo pone el cruce normal del feed).
        if (!dryRun) {
          await prisma.wishlistItem.updateMany({
            where: { id: { in: grupo.ids }, bookId: null },
            data: { bookId: existente.id },
          });
        }
        continue;
      }
      creados++;
      if (dryRun) {
        console.log(
          JSON.stringify({
            dryRun: true,
            libro: grupo.titulo,
            autora,
            isbn: c.ean,
            genero: generoDesdeCategoria(c.categoria),
          }),
        );
        continue;
      }
      const autor = autora
        ? await prisma.author.upsert({
            where: { name: autora },
            update: {},
            create: { name: autora },
          })
        : null;
      const genero = await prisma.genre.upsert({
        where: { name: generoDesdeCategoria(c.categoria) },
        update: {},
        create: { name: generoDesdeCategoria(c.categoria) },
      });
      const libro = await prisma.book.create({
        data: {
          title: grupo.titulo,
          authorId: autor?.id,
          canonicalKey: canonicalBookKey(grupo.titulo, autora ?? ''),
          isbn: c.ean ?? undefined,
          normalizedIsbn: normalizeBookIsbn(c.ean) ?? undefined,
          coverUrl: c.imagenUrl || undefined,
          language: 'es',
          genreId: genero.id,
        },
      });
      await prisma.bookSource.create({
        data: {
          bookId: libro.id,
          source: 'Casa del Libro · alta desde deseo',
          sourceUrl: c.url,
          externalId: c.url.split('/').filter(Boolean).at(-1) ?? null,
        },
      });
      await prisma.bookStoreLink.create({
        data: {
          bookId: libro.id,
          store: 'CASA_DEL_LIBRO',
          format: StoreFormat.PAPEL,
          language: 'es',
          source: 'FEED',
          ean: c.ean,
          url: c.url,
          feedTitle: c.feedTitle,
          feedAuthor: c.feedAuthor,
          confidence: c.confidence,
          stockStatus: c.stockStatus,
        },
      });
      await prisma.wishlistItem.updateMany({
        where: { id: { in: grupo.ids }, bookId: null },
        data: { bookId: libro.id },
      });
    } catch (error) {
      // Un deseo que falla no debe impedir el resto de la pasada nocturna.
      console.error(
        JSON.stringify({
          event: 'wishlist_book_create_failed',
          titulo: grupo.titulo,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }
  return creados;
}
