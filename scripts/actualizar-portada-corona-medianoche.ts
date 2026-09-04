import 'dotenv/config';
import { prisma } from '../src/prisma.js';

const BOOK_ID = 'cmrxm748k006c0pnzjv7ryd7s';
const NEW_COVER = 'https://m.media-amazon.com/images/I/61uKdsBfx3L._AC_UF1000,1000_QL80_.jpg';

async function main() {
  const updated = await prisma.book.update({
    where: { id: BOOK_ID },
    data: { coverUrl: NEW_COVER },
    select: { id: true, title: true, coverUrl: true },
  });
  console.log('✅ Portada actualizada:');
  console.log(JSON.stringify(updated, null, 2));
}

main().finally(() => prisma.$disconnect());
