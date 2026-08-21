import 'dotenv/config';
import { prisma } from '../src/prisma.js';

async function main() {
  const caraval = await prisma.series.findMany({ where: { name: { contains: 'Caraval', mode: 'insensitive' } } });
  console.log('Series Caraval:', JSON.stringify(caraval, null, 2));

  const fantasia = await prisma.genre.findMany({ where: { name: { contains: 'Fantas', mode: 'insensitive' } } });
  console.log('Genero Fantasía:', JSON.stringify(fantasia, null, 2));

  const empyrean = await prisma.series.findMany({
    where: { OR: [{ name: { contains: 'Empireo', mode: 'insensitive' } }, { name: { contains: 'Empíreo', mode: 'insensitive' } }] },
  });
  console.log('Series Empíreo:', JSON.stringify(empyrean, null, 2));
}
main().catch(console.error).finally(() => prisma.$disconnect());
