import 'dotenv/config';
import { prisma } from '../src/prisma.js';

async function main() {
  const libros = await prisma.book.findMany({
    where: { title: { contains: 'Alas de hierro', mode: 'insensitive' } },
    include: { series: true, library: { include: { user: { select: { name: true } } } } },
    orderBy: { createdAt: 'asc' },
  });

  for (const b of libros) {
    const estado = b.deletedAt ? '🗑  BORRADO' : '✅ ACTIVO';
    console.log(`${estado} "${b.title}" (${b.id})`);
    console.log(`  saga:      ${b.series?.name ?? '—'} #${b.seriesOrder ?? '—'}`);
    console.log(`  deletedAt: ${b.deletedAt?.toISOString() ?? 'null'}`);
    console.log(`  bib:       ${b.library.map(l => l.user.name + '[' + l.status + ']').join(', ') || '—'}`);
    console.log('');
  }

  const redirects = await prisma.bookRedirect.findMany({
    where: {
      OR: [
        { oldBookId: { in: libros.map(b => b.id) } },
        { canonicalBookId: { in: libros.map(b => b.id) } },
      ],
    },
  });
  console.log('Redirects:');
  for (const r of redirects) console.log(`  ${r.oldBookId} → ${r.canonicalBookId}  (${r.reason ?? ''})`);
  if (!redirects.length) console.log('  ninguno');
}
main().catch(console.error).finally(() => prisma.$disconnect());
