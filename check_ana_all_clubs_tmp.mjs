import 'dotenv/config';
import {PrismaPg} from '@prisma/adapter-pg';
import {PrismaClient} from '@prisma/client';

const adapter = new PrismaPg({connectionString: process.env.DATABASE_URL});
const prisma = new PrismaClient({adapter});

const userId = 'cmrd84lmh0001in505gw2wm1c'; // Ana

// Every ClubMember row for Ana, regardless of type
const memberships = await prisma.clubMember.findMany({
  where: { userId },
  include: { club: true },
});
console.log('memberships:', JSON.stringify(memberships, null, 2));

// Any club of tipo PERSONAL anywhere connected to Ana (owner or member)
const personalClubs = await prisma.club.findMany({
  where: { tipo: 'PERSONAL', OR: [{ ownerId: userId }, { members: { some: { userId } } }] },
});
console.log('personalClubs:', JSON.stringify(personalClubs, null, 2));

await prisma.$disconnect();
