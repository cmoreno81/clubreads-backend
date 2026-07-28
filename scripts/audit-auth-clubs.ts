import { prisma } from '../src/prisma.js';

async function main() {
  const users = await prisma.user.findMany({
    orderBy: { name: 'asc' },
    include: {
      activeClub: { select: { id: true, name: true } },
      clubMemberships: {
        include: { club: { select: { id: true, name: true } } },
      },
    },
  });

  const normalizedEmails = new Map<string, string[]>();
  for (const user of users) {
    const email = user.email.trim().toLowerCase();
    normalizedEmails.set(email, [
      ...(normalizedEmails.get(email) ?? []),
      user.name,
    ]);
  }
  const duplicateEmails = [...normalizedEmails.values()].filter(
    (names) => names.length > 1,
  );
  const invalidEmails = users
    .filter(
      (user) =>
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
          user.email.trim(),
        ),
    )
    .map((user) => user.name);
  const missingMembership = users
    .filter((user) => user.clubMemberships.length === 0)
    .map((user) => user.name);
  const missingActiveClub = users
    .filter((user) => !user.activeClubId)
    .map((user) => user.name);
  const invalidActiveClub = users
    .filter(
      (user) =>
        user.activeClubId &&
        !user.clubMemberships.some(
          (membership) =>
            membership.clubId === user.activeClubId,
        ),
    )
    .map((user) => user.name);

  console.log(`Usuarias: ${users.length}`);
  for (const user of users) {
    console.log(
      [
        `- ${user.name}`,
        `clubes=${user.clubMemberships.length}`,
        `activo=${user.activeClub?.name ?? 'NINGUNO'}`,
        `password=${user.passwordHash ? 'sí' : 'no'}`,
      ].join(' | '),
    );
  }
  console.log(`Correos duplicados: ${duplicateEmails.length}`);
  console.log(`Correos inválidos: ${invalidEmails.length}`);
  console.log(`Sin membresía: ${missingMembership.length}`);
  console.log(`Sin club activo: ${missingActiveClub.length}`);
  console.log(`Club activo sin membresía: ${invalidActiveClub.length}`);

  const problems = [
    ...duplicateEmails.flat(),
    ...invalidEmails,
    ...missingMembership,
    ...missingActiveClub,
    ...invalidActiveClub,
  ];
  if (problems.length > 0) {
    console.error(`Revisión necesaria: ${[...new Set(problems)].join(', ')}`);
    process.exitCode = 2;
  }
}

main()
  .catch((error) => {
    console.error('No se ha podido completar la auditoría:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
