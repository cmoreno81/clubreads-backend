import { prisma } from '../prisma.js';
import { getCurrentClubContext } from './club-context.service.js';

export async function getUsuarios(usuario = '') {
  const { club } = await getCurrentClubContext(usuario);
  const memberships = await prisma.clubMember.findMany({
    where: { clubId: club.id },
    include: { user: true },
    orderBy: {
      user: { name: 'asc' },
    },
  });

  return memberships.map(({ user }) => ({
    nombre: user.name,
    email: user.email,
  }));
}
