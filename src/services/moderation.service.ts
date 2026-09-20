import { prisma } from '../prisma.js';
import { ClubContextError } from './club-context.service.js';
import { enviarFeedback } from './feedback.service.js';

// ─────────────────────────────────────────────
// Bloquear personas
// ─────────────────────────────────────────────

export async function bloquearUsuario(blockerId: string, blockedName: string) {
  const blocked = await prisma.user.findUnique({
    where: { name: blockedName.trim() },
    select: { id: true },
  });
  if (!blocked) {
    throw new ClubContextError('Usuaria no encontrada', 404, 'USER_NOT_FOUND');
  }
  if (blocked.id === blockerId) {
    throw new ClubContextError('No puedes bloquearte a ti misma', 400, 'CANNOT_BLOCK_SELF');
  }

  await prisma.userBlock.upsert({
    where: { blockerId_blockedId: { blockerId, blockedId: blocked.id } },
    update: {},
    create: { blockerId, blockedId: blocked.id },
  });

  return { ok: true };
}

export async function desbloquearUsuario(blockerId: string, blockedName: string) {
  const blocked = await prisma.user.findUnique({
    where: { name: blockedName.trim() },
    select: { id: true },
  });
  if (!blocked) {
    throw new ClubContextError('Usuaria no encontrada', 404, 'USER_NOT_FOUND');
  }

  await prisma.userBlock.deleteMany({
    where: { blockerId, blockedId: blocked.id },
  });

  return { ok: true };
}

export async function listarBloqueadas(blockerId: string) {
  const rows = await prisma.userBlock.findMany({
    where: { blockerId },
    include: { blocked: { select: { name: true, avatarUrl: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return {
    ok: true,
    bloqueadas: rows.map((r) => ({
      nombre: r.blocked.name,
      avatarUrl: r.blocked.avatarUrl ?? '',
    })),
  };
}

/** IDs de usuarias que `userId` ha bloqueado — para filtrar su contenido de las listas. */
export async function idsBloqueadosPor(userId: string): Promise<string[]> {
  if (!userId) return [];
  const rows = await prisma.userBlock.findMany({
    where: { blockerId: userId },
    select: { blockedId: true },
  });
  return rows.map((r) => r.blockedId);
}

// ─────────────────────────────────────────────
// Reportar contenido (comentario o reseña)
// ─────────────────────────────────────────────

type ReportTargetType = 'comentario' | 'resena';

async function cargarObjetivo(targetType: ReportTargetType, targetId: string) {
  if (targetType === 'comentario') {
    const comment = await prisma.comment.findUnique({
      where: { id: targetId },
      select: { text: true, user: { select: { name: true } } },
    });
    if (!comment) return null;
    return { autor: comment.user.name, texto: comment.text };
  }
  const review = await prisma.review.findUnique({
    where: { id: targetId },
    select: { review: true, user: { select: { name: true } } },
  });
  if (!review) return null;
  return { autor: review.user.name, texto: review.review ?? '(sin texto, solo valoración)' };
}

export async function reportarContenido(
  reporterId: string,
  targetType: ReportTargetType,
  targetId: string,
  motivo: string,
) {
  const [reporter, objetivo] = await Promise.all([
    prisma.user.findUnique({ where: { id: reporterId }, select: { name: true, email: true } }),
    cargarObjetivo(targetType, targetId),
  ]);
  if (!reporter) {
    throw new ClubContextError('Cuenta no encontrada', 404, 'USER_NOT_FOUND');
  }
  if (!objetivo) {
    throw new ClubContextError('El contenido reportado ya no existe', 404, 'CONTENT_NOT_FOUND');
  }

  const tipoLabel = targetType === 'comentario' ? 'Comentario' : 'Reseña';
  const descripcion = [
    `Autora del contenido: ${objetivo.autor}`,
    `Motivo del reporte: ${motivo.trim() || '(sin especificar)'}`,
    '',
    `Contenido reportado:`,
    `"${objetivo.texto}"`,
  ].join('\n');

  return enviarFeedback({
    reporterEmail: reporter.email,
    reporterName: reporter.name,
    category: 'reporte',
    titulo: `${tipoLabel} de ${objetivo.autor}`,
    descripcion,
  });
}
