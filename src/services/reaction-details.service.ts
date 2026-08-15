import type { ReactionType } from '@prisma/client';

import { prisma } from '../prisma.js';
import { requireClubMember } from './club-context.service.js';

export type ReactionTargetType = 'COMMENT' | 'PROGRESS';

type ReactionRow = {
  id: string;
  reaction: ReactionType;
  createdAt: Date;
  user: { id: string; name: string; avatarUrl: string | null };
};

export function groupReactionDetails(rows: ReactionRow[], currentUserId: string) {
  const groups = new Map<ReactionType, ReactionRow[]>();
  for (const row of rows) {
    const group = groups.get(row.reaction) ?? [];
    group.push(row);
    groups.set(row.reaction, group);
  }

  return {
    ok: true as const,
    total: rows.length,
    grupos: [...groups.entries()].map(([reaction, users]) => ({
      reaccion: reaction,
      usuarios: users.map((item) => ({
        id: item.user.id,
        nombre: item.user.name,
        avatarUrl: item.user.avatarUrl ?? '',
        esTu: item.user.id === currentUserId,
        fecha: item.createdAt.toISOString(),
      })),
    })),
  };
}

export async function getReactionDetails(
  targetType: ReactionTargetType,
  targetId: string,
  userName: string,
) {
  const { club, user } = await requireClubMember(userName);
  const id = targetId.trim();

  let rows: ReactionRow[] | null;
  if (targetType === 'COMMENT') {
    const target = await prisma.comment.findFirst({
      where: {
        id,
        deletedAt: null,
        conversation: { reading: { clubId: club.id } },
      },
      select: {
        likes: {
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            reaction: true,
            createdAt: true,
            user: { select: { id: true, name: true, avatarUrl: true } },
          },
        },
      },
    });
    rows = target?.likes ?? null;
  } else {
    const target = await prisma.library.findFirst({
      where: {
        id,
        user: { clubMemberships: { some: { clubId: club.id } } },
      },
      select: {
        progressReactions: {
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            reaction: true,
            createdAt: true,
            user: { select: { id: true, name: true, avatarUrl: true } },
          },
        },
      },
    });
    rows = target?.progressReactions ?? null;
  }

  if (!rows) {
    return {
      ok: false as const,
      codigo: 'REACTION_TARGET_NOT_FOUND',
      mensaje: 'No se encuentra el contenido o no tienes acceso',
    };
  }

  return groupReactionDetails(rows, user.id);
}
