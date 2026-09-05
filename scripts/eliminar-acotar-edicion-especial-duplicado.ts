import 'dotenv/config';
import { prisma } from '../src/prisma.js';

// Duplicado de "Una corte de rosas y espinas. Edición especial con sobrecubierta reversible"
// 0 usuarios, 0 reseñas, 0 completions → soft delete + redirect al canónico
const DUPLICADO_ID  = 'cmtmnykjo002l2cqzsly8w36y';
const CANONICO_ID   = 'cms7g95ie00gb0po9650bqfi8'; // "Una corte de rosas y espinas"

async function main() {
  const [dup, canon] = await Promise.all([
    prisma.book.findUnique({ where: { id: DUPLICADO_ID }, select: { id: true, title: true, deletedAt: true, _count: { select: { library: true } } } }),
    prisma.book.findUnique({ where: { id: CANONICO_ID  }, select: { id: true, title: true } }),
  ]);

  if (!dup)   { console.log('❌ Duplicado no encontrado'); return; }
  if (!canon) { console.log('❌ Canónico no encontrado');  return; }
  if (dup.deletedAt) { console.log('⚠️  Ya estaba eliminado'); return; }
  if (dup._count.library > 0) { console.log(`⚠️  Tiene ${dup._count.library} usuarios, usar mergeBooks en su lugar`); return; }

  console.log(`🗑️  Eliminando: "${dup.title}" (${dup.id})`);
  console.log(`✅  Canónico:   "${canon.title}" (${canon.id})`);

  await prisma.$transaction([
    prisma.book.update({
      where: { id: DUPLICADO_ID },
      data: { deletedAt: new Date() },
    }),
    prisma.bookRedirect.create({
      data: {
        oldBookId: DUPLICADO_ID,
        canonicalBookId: CANONICO_ID,
        reason: '"Una corte de rosas y espinas. Edición especial" es duplicado de "Una corte de rosas y espinas"',
      },
    }),
  ]);

  console.log('\n✅ Hecho. Redirect creado.');
}

main().finally(() => prisma.$disconnect());
