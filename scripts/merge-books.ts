/**
 * Fusiona dos entradas del catálogo que en realidad son el mismo libro
 * (ediciones en distinto idioma, duplicados de importación, etc.), usando
 * mergeBooks() — que traslada biblioteca, valoraciones, reseñas, lecturas
 * conjuntas/conversaciones y candidaturas de Clubvisión al libro canónico,
 * deja un BookRedirect y un snapshot de auditoría (BookMergeAudit) antes de
 * tocar nada, así que es seguro y queda rastro de cada fusión.
 *
 * Uso:
 *
 *   # 1. Buscar candidatos por título (para encontrar los IDs)
 *   npx tsx scripts/merge-books.ts --find "anatema"
 *
 *   # 2. Fusionar: el primer ID es el que desaparece (se fusiona), el
 *   #    segundo es el que se conserva (canónico) — normalmente el que
 *   #    tiene más biblioteca/reseñas/lecturas.
 *   npx tsx scripts/merge-books.ts <idOrigen> <idCanonico> "motivo (opcional)"
 */

import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { mergeBooks } from '../src/services/book-merge.service.js';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function find(texto: string) {
  const libros = await prisma.book.findMany({
    where: { title: { contains: texto, mode: 'insensitive' }, deletedAt: null },
    select: {
      id: true,
      title: true,
      author: { select: { name: true } },
      _count: {
        select: { library: true, readingCompletions: true, readings: true, reviews: true },
      },
    },
    orderBy: { title: 'asc' },
  });

  if (libros.length === 0) {
    console.log(`No se encontró ningún libro con "${texto}" en el título.`);
    return;
  }

  console.log(`${libros.length} coincidencia(s):\n`);
  for (const libro of libros) {
    console.log(`[${libro.id}]`);
    console.log(`  "${libro.title}" — ${libro.author?.name ?? 'sin autor'}`);
    console.log(
      `  biblioteca: ${libro._count.library} · reseñas: ${libro._count.reviews} ` +
        `· lecturas terminadas: ${libro._count.readingCompletions} · lecturas conjuntas: ${libro._count.readings}`,
    );
    console.log('');
  }
  console.log(
    'Elige el que tenga más actividad como CANÓNICO (2º argumento) y el otro como ORIGEN (1º argumento).',
  );
}

async function merge(sourceId: string, canonicalId: string, reason?: string) {
  const [source, canonical] = await Promise.all([
    prisma.book.findUnique({ where: { id: sourceId }, select: { title: true, deletedAt: true } }),
    prisma.book.findUnique({ where: { id: canonicalId }, select: { title: true, deletedAt: true } }),
  ]);
  if (!source || source.deletedAt) {
    console.error(`❌ No existe (o ya está fusionado) el libro origen: ${sourceId}`);
    process.exitCode = 1;
    return;
  }
  if (!canonical || canonical.deletedAt) {
    console.error(`❌ No existe (o ya está fusionado) el libro canónico: ${canonicalId}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Fusionando "${source.title}" [${sourceId}]`);
  console.log(`      → en "${canonical.title}" [${canonicalId}]`);
  if (reason) console.log(`Motivo: ${reason}`);

  const result = await mergeBooks(sourceId, canonicalId, reason);
  if (result.alreadyMerged) {
    console.log('ℹ️  Ya estaban fusionados, no se ha hecho nada.');
  } else {
    console.log('✅ Fusión completada.');
  }
}

async function main() {
  const [, , first, second, third] = process.argv;

  if (!first) {
    console.log(
      'Uso:\n' +
        '  npx tsx scripts/merge-books.ts --find "texto del título"\n' +
        '  npx tsx scripts/merge-books.ts <idOrigen> <idCanonico> ["motivo"]',
    );
    return;
  }

  if (first === '--find') {
    if (!second) {
      console.error('Falta el texto a buscar: --find "texto"');
      process.exitCode = 1;
      return;
    }
    await find(second);
    return;
  }

  if (!second) {
    console.error('Faltan argumentos: <idOrigen> <idCanonico> ["motivo"]');
    process.exitCode = 1;
    return;
  }

  await merge(first, second, third);
}

main()
  .catch((error) => {
    console.error('❌', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
