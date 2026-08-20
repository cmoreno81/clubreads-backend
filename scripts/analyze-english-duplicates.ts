/**
 * Detecta libros importados (prefijo cmt0gv / cmt0n) que puedan tener
 * un equivalente en español ya en el catálogo, usando findSimilarBooks.
 */

import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { findSimilarBooks } from '../src/services/book-identity.service.js';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma  = new PrismaClient({ adapter });

async function main() {
  // Libros recién importados (IDs con prefijo cmt0)
  const imported = await prisma.book.findMany({
    where: {
      OR: [
        { id: { startsWith: 'cmt0gv' } },
        { id: { startsWith: 'cmt0n'  } },
      ],
      deletedAt: null,
    },
    select: {
      id: true,
      title: true,
      author: { select: { name: true } },
      _count: { select: { library: true } },
    },
    orderBy: { title: 'asc' },
  });

  console.log(`Analizando ${imported.length} libros importados...\n`);

  const hits: { book: typeof imported[0]; candidates: any[] }[] = [];

  for (const book of imported) {
    const similares = await findSimilarBooks(prisma as any, book.title, {
      authorName: book.author?.name ?? null,
      limit: 3,
    });
    // Solo candidatos que NO sean el mismo libro
    const candidates = similares.filter((s: any) => s.id !== book.id);
    if (candidates.length > 0) {
      hits.push({ book, candidates });
    }
  }

  if (hits.length === 0) {
    console.log('✅ No se detectaron pares duplicados.');
    return;
  }

  console.log(`⚠️  POSIBLES DUPLICADOS (${hits.length} pares):\n`);
  console.log('─'.repeat(80));

  for (const { book, candidates } of hits) {
    console.log(`\nIMPORTADO  [${book.id}]`);
    console.log(`  Título : "${book.title}"`);
    console.log(`  Autor  : ${book.author?.name ?? '—'}`);
    console.log(`  Lectores: ${book._count.library}`);
    console.log(`  CANDIDATOS EN CATÁLOGO:`);
    for (const c of candidates) {
      console.log(`    ↔ [${c.id}] "${c.title}"  (${c.authorName ?? '—'})`);
    }
  }

  console.log('\n' + '─'.repeat(80));
  console.log(`\nTotal pares detectados: ${hits.length}`);
}

main()
  .catch((e) => { console.error('❌', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
