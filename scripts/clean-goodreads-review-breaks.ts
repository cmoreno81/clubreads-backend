import 'dotenv/config';

import { prisma } from '../src/prisma.js';
import { normalizeGoodreadsReview } from '../src/services/goodreads-import.service.js';

const applyChanges = process.argv.includes('--apply');
const htmlBreakFilter = {
  OR: [
    { review: { contains: '<br', mode: 'insensitive' as const } },
    { review: { contains: '&lt;br', mode: 'insensitive' as const } },
  ],
};

async function main() {
  const [reviews, completions] = await Promise.all([
    prisma.review.findMany({
      where: htmlBreakFilter,
      select: { id: true, review: true },
    }),
    prisma.readingCompletion.findMany({
      where: htmlBreakFilter,
      select: { id: true, review: true },
    }),
  ]);

  console.log(
    applyChanges
      ? 'Limpiando saltos HTML de las reseñas...'
      : 'Previsualización: no se modificará la base de datos.',
  );
  console.log(`Review afectadas: ${reviews.length}`);
  console.log(`ReadingCompletion afectadas: ${completions.length}`);

  if (!applyChanges) {
    console.log(
      'Ejecuta npm run goodreads:reviews:clean para aplicar la limpieza.',
    );
    return;
  }

  let updatedReviews = 0;
  let updatedCompletions = 0;

  for (const item of reviews) {
    const review = normalizeGoodreadsReview(item.review);
    if (review === item.review) continue;
    await prisma.review.update({
      where: { id: item.id },
      data: { review },
    });
    updatedReviews += 1;
  }

  for (const item of completions) {
    const review = normalizeGoodreadsReview(item.review);
    if (review === item.review) continue;
    await prisma.readingCompletion.update({
      where: { id: item.id },
      data: { review },
    });
    updatedCompletions += 1;
  }

  console.log(`Review actualizadas: ${updatedReviews}`);
  console.log(`ReadingCompletion actualizadas: ${updatedCompletions}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
