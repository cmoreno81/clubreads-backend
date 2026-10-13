import { ReactionType } from '@prisma/client';

/// Cuenta cuántas reacciones hay de cada tipo (todos los tipos salen, con 0 si no hay).
export function contarReaccionesProgreso(reactions: Array<{ reaction: ReactionType }>) {
  return Object.fromEntries(
    Object.values(ReactionType).map((reaction) => [
      reaction,
      reactions.filter((item) => item.reaction === reaction).length,
    ]),
  );
}
