import 'dotenv/config';
import {PrismaPg} from '@prisma/adapter-pg';
import {PrismaClient} from '@prisma/client';

const adapter = new PrismaPg({connectionString: process.env.DATABASE_URL});
const prisma = new PrismaClient({adapter});

const canonicalId = 'cmsc8o1e900aw1yqup2iajybd';
const englishUserId = 'cmtk63mgo010v2cqnnxcnw0a7';

const lib = await prisma.library.findUnique({
  where: { userId_bookId: { userId: englishUserId, bookId: canonicalId } },
  include: { progressReactions: true, user: { select: { name: true } } },
});
console.log('current library row:', JSON.stringify(lib, null, 2));

const completions = await prisma.readingCompletion.findMany({ where: { userId: englishUserId, bookId: canonicalId } });
console.log('completions:', JSON.stringify(completions, null, 2));

const review = await prisma.review.findUnique({ where: { userId_bookId: { userId: englishUserId, bookId: canonicalId } } });
console.log('review:', JSON.stringify(review, null, 2));

const readings = await prisma.reading.findMany({ where: { bookId: canonicalId } });
console.log('readings (lectura conjunta):', JSON.stringify(readings, null, 2));

// check if a conversation/comment exists from this user tied to any reading on this book
const notif = await prisma.notification.findMany({ where: { bookId: canonicalId, userId: englishUserId } });
console.log('notifications for this user on this book:', notif.length);

await prisma.$disconnect();
