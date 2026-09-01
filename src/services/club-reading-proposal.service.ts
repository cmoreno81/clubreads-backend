import { prisma } from '../prisma.js';
import { getCurrentClubContext } from './club-context.service.js';
import { crearLectura } from './readings.service.js';

// ── Obtener propuesta pendiente del club ─────────────────────

export async function getPropuestaPendiente(usuario: string) {
  const { club } = await getCurrentClubContext(usuario);

  const propuesta = await prisma.clubReadingProposal.findFirst({
    where: { clubId: club.id, status: 'PENDING' },
    include: {
      proposer: { select: { name: true, avatarUrl: true } },
      approvals: { include: { user: { select: { name: true, avatarUrl: true } } } },
    },
    orderBy: { createdAt: 'desc' },
  });

  if (!propuesta) return null;

  const totalMiembros = await prisma.clubMember.count({
    where: { clubId: club.id },
  });

  return {
    id: propuesta.id,
    bookTitle: propuesta.bookTitle,
    proposedBy: propuesta.proposer.name,
    proposerAvatar: propuesta.proposer.avatarUrl ?? '',
    apoyos: propuesta.approvals.map((a) => ({
      usuario: a.user.name,
      avatarUrl: a.user.avatarUrl ?? '',
    })),
    totalMiembros,
    apoyosNecesarios: totalMiembros,
    yaApoye: propuesta.approvals.some((a) => a.user.name === usuario),
    soyElProponente: propuesta.proposer.name === usuario,
  };
}

// ── Crear propuesta ──────────────────────────────────────────

export async function crearPropuesta(usuario: string, bookTitle: string) {
  const { club } = await getCurrentClubContext(usuario);

  const titulo = bookTitle.trim();
  if (!titulo) throw new Error('El título no puede estar vacío');

  // Solo puede haber una propuesta pendiente a la vez
  const existing = await prisma.clubReadingProposal.findFirst({
    where: { clubId: club.id, status: 'PENDING' },
  });
  if (existing) {
    return { ok: false, error: 'Ya hay una propuesta pendiente', propuestaId: existing.id };
  }

  const proposer = await prisma.user.findUnique({ where: { name: usuario } });
  if (!proposer) throw new Error('Usuario no encontrado');

  const propuesta = await prisma.$transaction(async (tx) => {
    const p = await tx.clubReadingProposal.create({
      data: {
        clubId: club.id,
        bookTitle: titulo,
        proposedBy: proposer.id,
      },
    });

    // El proponente apoya automáticamente
    await tx.clubReadingProposalApproval.create({
      data: { proposalId: p.id, userId: proposer.id },
    });

    return p;
  });

  // Comprobar si el proponente es el único miembro (club de 1) → activar ya
  const totalMiembros = await prisma.clubMember.count({ where: { clubId: club.id } });
  if (totalMiembros === 1) {
    await _activarPropuesta(propuesta.id, club.id, titulo, usuario);
  }

  return { ok: true, propuestaId: propuesta.id };
}

// ── Apoyar propuesta ─────────────────────────────────────────

export async function apoyarPropuesta(usuario: string, propuestaId: string) {
  const { club } = await getCurrentClubContext(usuario);

  const propuesta = await prisma.clubReadingProposal.findFirst({
    where: { id: propuestaId, clubId: club.id, status: 'PENDING' },
    include: { approvals: true },
  });

  if (!propuesta) return { ok: false, error: 'Propuesta no encontrada o ya resuelta' };

  const user = await prisma.user.findUnique({ where: { name: usuario } });
  if (!user) return { ok: false, error: 'Usuario no encontrado' };

  // Evitar doble apoyo
  const yaApoyo = propuesta.approvals.some((a) => a.userId === user.id);
  if (yaApoyo) return { ok: true, activada: false, mensaje: 'Ya habías apoyado esta propuesta' };

  await prisma.clubReadingProposalApproval.create({
    data: { proposalId: propuestaId, userId: user.id },
  });

  const totalApoyos = propuesta.approvals.length + 1;
  const totalMiembros = await prisma.clubMember.count({ where: { clubId: club.id } });

  if (totalApoyos >= totalMiembros) {
    await _activarPropuesta(propuestaId, club.id, propuesta.bookTitle, usuario);
    return { ok: true, activada: true };
  }

  return { ok: true, activada: false, apoyos: totalApoyos, totalMiembros };
}

// ── Cancelar propuesta ───────────────────────────────────────

export async function cancelarPropuesta(usuario: string, propuestaId: string) {
  const { club } = await getCurrentClubContext(usuario);

  const propuesta = await prisma.clubReadingProposal.findFirst({
    where: { id: propuestaId, clubId: club.id, status: 'PENDING' },
    include: { proposer: { select: { name: true } } },
  });

  if (!propuesta) return { ok: false, error: 'Propuesta no encontrada' };

  // Solo el proponente puede cancelar (o admin — simplificamos por ahora)
  if (propuesta.proposer.name !== usuario) {
    return { ok: false, error: 'Solo quien propuso puede cancelar' };
  }

  await prisma.clubReadingProposal.update({
    where: { id: propuestaId },
    data: { status: 'CANCELLED' },
  });

  return { ok: true };
}

// ── Activar: crear lectura y marcar propuesta como aceptada ──

async function _activarPropuesta(
  propuestaId: string,
  clubId: string,
  bookTitle: string,
  usuario: string,
) {
  await prisma.clubReadingProposal.update({
    where: { id: propuestaId },
    data: { status: 'ACCEPTED' },
  });

  // Crear la lectura oficial con 0 capítulos (lectura libre)
  await crearLectura({
    usuario,
    libro: bookTitle,
    capitulos: 0,
    prologo: false,
    epilogo: false,
    tipo: 'OFICIAL',
  });
}
