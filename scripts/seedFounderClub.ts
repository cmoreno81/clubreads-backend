import { ClubRole, ClubVisibility } from "@prisma/client";
import process from "node:process";
import { prisma } from "../src/prisma.js";

const CLUB_NAME = "Nuestros gustos son clichés";
const CLUB_SLUG = "nuestros-gustos-son-cliches";
const OWNER_EMAIL = "c.moreno.benavente@gmail.com";

function generateInviteCode(length = 8): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  return Array.from({ length }, () =>
    chars[Math.floor(Math.random() * chars.length)],
  ).join("");
}

async function main() {
  const owner = await prisma.user.findUnique({
    where: {
      email: OWNER_EMAIL,
    },
  });

  if (!owner) {
    throw new Error(
      `No existe un usuario con email ${OWNER_EMAIL}`,
    );
  }

  const users = await prisma.user.findMany({
    orderBy: {
      createdAt: "asc",
    },
  });

  await prisma.$transaction(async (tx) => {
    const club = await tx.club.upsert({
      where: {
        slug: CLUB_SLUG,
      },
      update: {
        name: CLUB_NAME,
        visibility: ClubVisibility.PRIVATE,
        ownerId: owner.id,
      },
      create: {
        name: CLUB_NAME,
        slug: CLUB_SLUG,
        visibility: ClubVisibility.PRIVATE,
        inviteCode: generateInviteCode(),
        ownerId: owner.id,
      },
    });

    await tx.clubMember.upsert({
      where: {
        clubId_userId: {
          clubId: club.id,
          userId: owner.id,
        },
      },
      update: {
        role: ClubRole.OWNER,
      },
      create: {
        clubId: club.id,
        userId: owner.id,
        role: ClubRole.OWNER,
      },
    });

    await tx.clubMember.updateMany({
      where: {
        clubId: club.id,
        role: ClubRole.OWNER,
        userId: {
          not: owner.id,
        },
      },
      data: {
        role: ClubRole.MEMBER,
      },
    });

    await tx.clubMember.createMany({
      data: users.map((user) => ({
        clubId: club.id,
        userId: user.id,
        role:
          user.id === owner.id
            ? ClubRole.OWNER
            : ClubRole.MEMBER,
      })),
      skipDuplicates: true,
    });

    const totalMembers = await tx.clubMember.count({
      where: {
        clubId: club.id,
      },
    });

    const memberRoles = await tx.clubMember.groupBy({
      by: ["role"],
      where: {
        clubId: club.id,
      },
      _count: {
        _all: true,
      },
    });

    console.log(`
🎉 Club fundador preparado correctamente

Nombre: ${club.name}
Slug: ${club.slug}
Miembros: ${totalMembers}
Propietaria: ${owner.name ?? owner.email}
Código de invitación: ${club.inviteCode ?? "sin código"}

Roles:
${memberRoles
  .map((item) => `- ${item.role}: ${item._count._all}`)
  .join("\n")}
`);
  });
}

main()
  .catch((error) => {
    console.error("❌ Error creando el club fundador:");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
