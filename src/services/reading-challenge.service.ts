import { prisma } from '../prisma.js';

export async function getClubReadingChallenges(userName: string) {
  const normalizedUserName = userName.trim();
  const { club } = await import('./club-context.service.js')
    .then(m => m.getCurrentClubContext(normalizedUserName));

  const isPersonal = club.tipo === 'PERSONAL';

  const year = new Date().getFullYear();
  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year + 1, 0, 1);

  const members = await prisma.clubMember.findMany({
    where: { clubId: club.id },
    select: {
      user: {
        select: {
          id: true,
          name: true,
          avatarUrl: true,
          readingChallenges: {
            where: { year },
            select: { target: true },
            take: 1,
          },
          readingCompletions: {
            where: {
              finishedAt: { gte: yearStart, lt: yearEnd },
              isReread: false,
            },
            select: { id: true },
          },
        },
      },
    },
  });

  // Total colectivo del club este año
  const clubTotal = members.reduce(
    (sum, m) => sum + m.user.readingCompletions.length, 0,
  );
  const clubTarget = members.reduce(
    (sum, m) => sum + (m.user.readingChallenges[0]?.target ?? 0), 0,
  );

  const challenges = members
    .map(m => {
      const target = m.user.readingChallenges[0]?.target ?? null;
      const read = m.user.readingCompletions.length;
      const pct = target && target > 0 ? Math.min(read / target, 1) : null;
      return {
        userId: m.user.id,
        userName: m.user.name,
        avatarUrl: m.user.avatarUrl ?? '',
        target,
        read,
        pct: pct ?? 0,
        hasChallenge: target !== null,
        isMe: m.user.name === normalizedUserName,
      };
    })
    .sort((a, b) => {
      // Primero los que tienen challenge, ordenados por porcentaje
      if (a.hasChallenge && !b.hasChallenge) return -1;
      if (!a.hasChallenge && b.hasChallenge) return 1;
      return b.pct - a.pct;
    });

  return {
    ok: true,
    year,
    isPersonal,
    // En cuentas personales no hay reto ni ranking colectivo
    clubTotal: isPersonal ? 0 : clubTotal,
    clubTarget: isPersonal ? 0 : clubTarget,
    // En personal: solo devuelve el propio registro (para "Mi reto"),
    // sin el resto de miembros del club
    challenges: isPersonal
      ? challenges.filter(c => c.isMe)
      : challenges,
  };
}

export async function setReadingChallenge(
  userId: string,
  target: number,
) {
  if (!Number.isInteger(target) || target < 1 || target > 9999) {
    return { ok: false, mensaje: 'El objetivo debe ser entre 1 y 9999 libros.' };
  }
  const year = new Date().getFullYear();
  await prisma.readingChallenge.upsert({
    where: { userId_year: { userId, year } },
    update: { target },
    create: { userId, year, target },
  });
  return { ok: true, year, target };
}