/**
 * Diagnostic: check September 2026 Clubvisión candidates with future publicationDate
 * Run: npx tsx scripts/check-candidates-pubdate.ts
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL no definida');

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

const EDITION = '2026-09'; // September 2026

async function main() {
  console.log(`\n📋 Comprobando edición: ${EDITION}\n`);

  // Find all Clubvisión editions for this month
  const clubvisions = await prisma.clubvision.findMany({
    where: { edition: EDITION },
    select: { id: true, clubId: true, status: true, club: { select: { name: true } } },
  });

  if (clubvisions.length === 0) {
    console.log('No se encontraron ediciones de Clubvisión para', EDITION);
    return;
  }

  for (const cv of clubvisions) {
    console.log(`\n🏛️  Club: ${cv.club.name} (${cv.clubId}) — status: ${cv.status}`);

    // Get all candidates for this clubvision
    const entries = await prisma.clubvisionCandidate.findMany({
      where: { clubvisionId: cv.id },
      include: {
        book: { select: { title: true, publicationDate: true } },
      },
    });

    const now = new Date();
    const future = entries.filter(
      (e) => e.book?.publicationDate && e.book.publicationDate > now
    );
    const ok = entries.filter(
      (e) => !e.book?.publicationDate || e.book.publicationDate <= now
    );

    console.log(`  Total candidatas PENDING: ${entries.length}`);
    console.log(`  ✅ Con fecha ok / sin fecha: ${ok.length}`);
    console.log(`  ❌ Con fecha futura: ${future.length}`);

    if (future.length > 0) {
      console.log('\n  Candidatas con publicación futura:');
      for (const e of future) {
        // Check if this entry has any votes
        const voteCount = await prisma.clubvisionVote.count({
          where: { candidateId: e.id },
        });
        console.log(
          `    - "${e.book?.title}" pub: ${e.book?.publicationDate?.toISOString().slice(0, 10)}` +
          ` | votos: ${voteCount} | candidateId: ${e.id}`
        );
      }

      // Ask if we should clean them up (only those with 0 votes)
      const removable = [];
      for (const e of future) {
        const voteCount = await prisma.clubvisionVote.count({ where: { candidateId: e.id } });
        if (voteCount === 0) removable.push(e);
      }

      if (removable.length > 0) {
        console.log(`\n  🗑️  Candidatas sin votos que se podrían eliminar: ${removable.length}`);
        const CLEAN = process.argv.includes('--clean');
        if (CLEAN) {
          for (const e of removable) {
            await prisma.clubvisionCandidate.delete({ where: { id: e.id } });
            console.log(`    ✅ Eliminada: "${e.book?.title}" (${e.id})`);
          }
        } else {
          console.log('  👉 Pasa --clean para eliminarlas');
        }
      } else {
        console.log('\n  ⚠️  Todas las candidatas futuras tienen votos — no se pueden eliminar automáticamente');
      }
    }
  }

  console.log('\n✅ Diagnóstico completo\n');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
