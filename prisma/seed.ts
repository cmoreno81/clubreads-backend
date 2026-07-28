import {
  ClubRole,
  ClubvisionStatus,
  ReadingStatus,
} from '@prisma/client';
import { prisma } from '../src/prisma.js';

async function main() {
  const cristina = await prisma.user.upsert({
    where: { email: 'cristina@test.com' },
    update: {},
    create: {
      name: 'Cristina',
      email: 'cristina@test.com',
    },
  });

  const otra = await prisma.user.upsert({
    where: { email: 'otra@test.com' },
    update: {},
    create: {
      name: 'Otra',
      email: 'otra@test.com',
    },
  });

  const club = await prisma.club.upsert({
    where: { slug: 'nuestros-gustos-son-cliches' },
    update: {},
    create: {
      name: 'Nuestros gustos son clichés',
      slug: 'nuestros-gustos-son-cliches',
      ownerId: cristina.id,
    },
  });

  await prisma.clubMember.createMany({
    data: [
      { clubId: club.id, userId: cristina.id, role: ClubRole.OWNER },
      { clubId: club.id, userId: otra.id, role: ClubRole.MEMBER },
    ],
    skipDuplicates: true,
  });

  await prisma.user.updateMany({
    where: { id: { in: [cristina.id, otra.id] } },
    data: { activeClubId: club.id },
  });

  const genre = await prisma.genre.upsert({
    where: { name: 'Fantasía' },
    update: {},
    create: {
      name: 'Fantasía',
    },
  });

  const book =
    (await prisma.book.findFirst({
      where: {
        title: 'El nombre del viento',
      },
    })) ??
    (await prisma.book.create({
      data: {
        title: 'El nombre del viento',
        genreId: genre.id,
        standalone: false,
      },
    }));

  await prisma.library.upsert({
    where: {
      userId_bookId: {
        userId: cristina.id,
        bookId: book.id,
      },
    },
    update: {},
    create: {
      userId: cristina.id,
      bookId: book.id,
      status: ReadingStatus.PENDING,
    },
  });

  await prisma.library.upsert({
    where: {
      userId_bookId: {
        userId: otra.id,
        bookId: book.id,
      },
    },
    update: {},
    create: {
      userId: otra.id,
      bookId: book.id,
      status: ReadingStatus.PENDING,
    },
  });

  const clubvision = await prisma.clubvision.create({
    data: {
      clubId: club.id,
      edition: '2026-07',
      status: ClubvisionStatus.VOTACION,
      title: '🎤 Clubvisión abierta',
      message: '🗳️ Ya puedes votar',
      openedAt: new Date(),
    },
  });

  await prisma.clubvisionCandidate.create({
    data: {
      clubvisionId: clubvision.id,
      bookId: book.id,
      order: 1,
    },
  });

await prisma.clubvisionResult.upsert({
  where: {
    clubId_edition: {
      clubId: club.id,
      edition: '2026-07',
    },
  },
  update: {},
  create: {
    clubId: club.id,
    edition: '2026-07',
    winnerBookId: book.id,
    winnerTitle: book.title,
    points: 12,
    secondTitle: '',
    thirdTitle: '',
  },
});  
}

main()
  .then(async () => {
    console.log('Seed completado');
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
