import { StoreFormat } from '@prisma/client';

import { prisma } from '../prisma.js';
import { editionLanguage, isbn13 } from './store-link-sync.service.js';

// El feed de Awin no trae todos los formatos (p. ej. faltan casi todos los
// ebooks), pero la ficha de Casa del Libro enlaza los demás formatos del
// mismo libro. Este paso abre, despacio, la ficha de papel de cada libro y
// guarda los enlaces a ebook y audiolibro que encuentra. Solo se leen fichas
// de producto (permitidas en su robots.txt), una petición cada pocos segundos.

const STORE = 'CASA_DEL_LIBRO';
const SITE = 'https://www.casadellibro.com';
const RECHECK_DAYS = 30;
const USER_AGENT = 'ClubReads-LinkChecker/1.0 (+https://clubreads.app)';

const SIBLINGS: Array<{ prefix: 'ebook' | 'audiolibro'; format: StoreFormat }> = [
  { prefix: 'ebook', format: StoreFormat.EBOOK },
  { prefix: 'audiolibro', format: StoreFormat.AUDIO },
];

export type SiblingLink = { format: StoreFormat; url: string; ean: string };

function slugCore(slug: string, prefix: string, suffix?: string) {
  let core = slug.startsWith(`${prefix}-`) ? slug.slice(prefix.length + 1) : slug;
  if (suffix && core.endsWith(`-${suffix}`)) core = core.slice(0, -(suffix.length + 1));
  return core;
}

/// Enlaces a ebook y audiolibro del MISMO libro dentro de la ficha de papel.
/// La ficha también enlaza otros libros (recomendaciones): solo se aceptan los
/// que tienen exactamente el mismo nombre que el de papel.
export function extractSiblingLinks(html: string, paperUrl: string): SiblingLink[] {
  const paperSlug = new URL(paperUrl).pathname.split('/').filter(Boolean)[0] ?? '';
  const paperCore = slugCore(paperSlug, 'libro');
  if (!paperCore) return [];

  const found = new Map<StoreFormat, SiblingLink>();
  const pattern =
    /(?:https:\/\/www\.casadellibro\.com)?\/?((?:ebook|audiolibro)-[a-z0-9-]+)\/(\d{10,13}[0-9X]?)\/(\d+)/g;
  for (const match of html.matchAll(pattern)) {
    const [, slug, rawIsbn, id] = match;
    const sibling = SIBLINGS.find((s) => slug!.startsWith(`${s.prefix}-`));
    if (!sibling || found.has(sibling.format)) continue;
    if (slugCore(slug!, sibling.prefix, sibling.prefix) !== paperCore) continue;
    const ean = isbn13(rawIsbn);
    if (!ean) continue;
    found.set(sibling.format, {
      format: sibling.format,
      url: `${SITE}/${slug}/${rawIsbn}/${id}`,
      ean,
    });
  }
  return [...found.values()];
}

export type PageFetcher = (url: string) => Promise<{ status: number; html: string }>;

const defaultFetcher: PageFetcher = async (url) => {
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'es-ES,es;q=0.9' },
    signal: AbortSignal.timeout(25_000),
  });
  return { status: response.status, html: response.ok ? await response.text() : '' };
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type PageEnrichmentSummary = {
  dryRun: boolean;
  checked: number;
  added: number;
  removed: number;
  errors: number;
  stoppedEarly: boolean;
};

export async function enrichStoreLinksFromPages(
  options: { limit?: number; dryRun?: boolean; delayMs?: number; fetcher?: PageFetcher } = {},
): Promise<PageEnrichmentSummary> {
  const limit = options.limit ?? 300;
  const dryRun = options.dryRun ?? false;
  const delayMs = options.delayMs ?? 1500;
  const fetcher = options.fetcher ?? defaultFetcher;
  const recheckBefore = new Date(Date.now() - RECHECK_DAYS * 24 * 60 * 60 * 1000);

  // Fichas de papel sin revisar o revisadas hace tiempo. Primero las nunca
  // revisadas y, entre ellas, las de los libros creados más recientemente
  // (los que acaba de añadir alguien), antes que la cola de libros antiguos.
  const papers = await prisma.bookStoreLink.findMany({
    where: {
      store: STORE,
      format: StoreFormat.PAPEL,
      source: 'FEED',
      book: { deletedAt: null },
      OR: [{ pageCheckedAt: null }, { pageCheckedAt: { lt: recheckBefore } }],
    },
    orderBy: [
      { pageCheckedAt: { sort: 'asc', nulls: 'first' } },
      { book: { createdAt: 'desc' } },
    ],
    take: limit,
  });

  const summary: PageEnrichmentSummary = {
    dryRun,
    checked: 0,
    added: 0,
    removed: 0,
    errors: 0,
    stoppedEarly: false,
  };

  for (const paper of papers) {
    let page: { status: number; html: string };
    try {
      page = await fetcher(paper.url);
    } catch {
      summary.errors++;
      await sleep(delayMs);
      continue;
    }
    // La tienda nos frena: se para y se reintenta otra noche.
    if (page.status === 429 || page.status === 403 || page.status >= 500) {
      summary.errors++;
      summary.stoppedEarly = true;
      break;
    }
    summary.checked++;

    // Ficha retirada: no hay nada que leer; se marca como revisada.
    const siblings =
      page.status === 200
        ? extractSiblingLinks(page.html, paper.url).filter(
            (s) => editionLanguage('', s.url, s.ean) === paper.language,
          )
        : [];

    if (page.status === 200 || page.status === 404 || page.status === 410) {
      const existing = await prisma.bookStoreLink.findMany({
        where: {
          bookId: paper.bookId,
          store: STORE,
          language: paper.language,
          source: 'PAGE',
          format: { in: [StoreFormat.EBOOK, StoreFormat.AUDIO] },
        },
      });
      const have = new Map(existing.map((e) => [e.format, e]));
      for (const sibling of siblings) {
        if (have.has(sibling.format)) {
          if (have.get(sibling.format)!.url !== sibling.url && !dryRun) {
            await prisma.bookStoreLink.update({
              where: { id: have.get(sibling.format)!.id },
              data: { url: sibling.url, ean: sibling.ean },
            });
          }
          continue;
        }
        // El feed ya trae este formato (más fiable): no se duplica.
        const fromFeed = await prisma.bookStoreLink.findFirst({
          where: {
            bookId: paper.bookId,
            store: STORE,
            format: sibling.format,
            language: paper.language,
          },
          select: { id: true },
        });
        if (fromFeed) continue;
        summary.added++;
        if (!dryRun) {
          await prisma.bookStoreLink.create({
            data: {
              bookId: paper.bookId,
              store: STORE,
              format: sibling.format,
              language: paper.language,
              source: 'PAGE',
              ean: sibling.ean,
              url: sibling.url,
              feedTitle: null,
              feedAuthor: null,
              confidence: 0.9,
              stockStatus: null,
            },
          });
        }
      }
      // Formatos que la ficha ya no enlaza: se quitan.
      const stillThere = new Set(siblings.map((s) => s.format));
      for (const old of existing) {
        if (stillThere.has(old.format)) continue;
        summary.removed++;
        if (!dryRun) await prisma.bookStoreLink.delete({ where: { id: old.id } });
      }
      if (!dryRun) {
        await prisma.bookStoreLink.update({
          where: { id: paper.id },
          data: { pageCheckedAt: new Date() },
        });
      }
    }
    await sleep(delayMs);
  }
  return summary;
}
