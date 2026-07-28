import process from "node:process";
import { prisma } from "../src/prisma.js";

const CLUB_SLUG = "nuestros-gustos-son-cliches";

async function main() {
  const club = await prisma.club.findUnique({
    where: {
      slug: CLUB_SLUG,
    },
  });

  if (!club) {
    throw new Error("No existe el club fundador.");
  }

  const reading = await prisma.reading.updateMany({
    where: {
      clubId: null,
    },
    data: {
      clubId: club.id,
    },
  });

  const clubvision = await prisma.clubvision.updateMany({
    where: {
      clubId: null,
    },
    data: {
      clubId: club.id,
    },
  });

  const results = await prisma.clubvisionResult.updateMany({
    where: {
      clubId: null,
    },
    data: {
      clubId: club.id,
    },
  });

  const moods = await prisma.clubMoodVote.updateMany({
    where: {
      clubId: null,
    },
    data: {
      clubId: club.id,
    },
  });

  console.log(`
✅ Backfill terminado

Reading ............ ${reading.count}
Clubvision ......... ${clubvision.count}
Resultados ......... ${results.count}
Mood votes ......... ${moods.count}
`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
