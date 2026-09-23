import { ClubRole, NotificationType } from '@prisma/client';
import { prisma } from '../prisma.js';
import {
  descendingCursorFilter,
  pageFromRows,
  type PaginationRequest,
} from '../utils/cursor-pagination.js';

// ─────────────────────────────────────────────
// Crear notificaciones
// ─────────────────────────────────────────────

/**
 * De una lista de userIds, devuelve solo quienes tienen ese tipo de
 * notificación activado (no lo han desactivado en Ajustes).
 */
async function filterEnabledRecipients(
  userIds: string[],
  tipo: NotificationType,
): Promise<string[]> {
  if (userIds.length === 0) return [];
  const disabled = await prisma.user.findMany({
    where: { id: { in: userIds }, notificationsDisabled: { has: tipo } },
    select: { id: true },
  });
  if (disabled.length === 0) return userIds;
  const disabledSet = new Set(disabled.map((u) => u.id));
  return userIds.filter((id) => !disabledSet.has(id));
}

/** Crea una notificación para un usuario */
async function createNotification({
  userId,
  tipo,
  titulo,
  mensaje,
  clubId,
  bookId,
  extra,
}: {
  userId: string;
  tipo: NotificationType;
  titulo: string;
  mensaje: string;
  clubId?: string;
  bookId?: string;
  extra?: Record<string, unknown>;
}) {
  const [habilitado] = await filterEnabledRecipients([userId], tipo);
  if (!habilitado) return null;

  return prisma.notification.create({
    data: {
      userId,
      tipo,
      titulo,
      mensaje,
      clubId,
      bookId,
      extra: extra ? JSON.stringify(extra) : null,
    },
  });
}

/** Crea notificaciones para todos los miembros de un club (excepto el que origina) */
async function notifyClubMembers({
  clubId,
  excludeUserId,
  roles,
  tipo,
  titulo,
  mensaje,
  bookId,
  extra,
}: {
  clubId: string;
  excludeUserId?: string;
  /** Si se indica, solo avisa a quien tenga uno de estos roles (p.ej. solo admins). */
  roles?: ClubRole[];
  tipo: NotificationType;
  titulo: string;
  mensaje: string;
  bookId?: string;
  extra?: Record<string, unknown>;
}) {
  const members = await prisma.clubMember.findMany({
    where: {
      clubId,
      ...(excludeUserId ? { userId: { not: excludeUserId } } : {}),
      ...(roles ? { role: { in: roles } } : {}),
    },
    select: { userId: true },
  });

  const destinatarios = await filterEnabledRecipients(
    members.map((m) => m.userId),
    tipo,
  );
  if (destinatarios.length === 0) return;

  await prisma.notification.createMany({
    data: destinatarios.map((userId) => ({
      userId,
      tipo,
      titulo,
      mensaje,
      clubId,
      bookId,
      extra: extra ? JSON.stringify(extra) : null,
    })),
  });
}

// ─────────────────────────────────────────────
// Helpers por tipo de evento
// ─────────────────────────────────────────────

export async function notifyClubvisionAbierta(clubId: string) {
  const club = await prisma.club.findUnique({
    where: { id: clubId },
    select: { name: true },
  });
  if (!club) return;
  await notifyClubMembers({
    clubId,
    tipo: NotificationType.CLUBVISION_ABIERTA,
    titulo: '🗳️ Clubvisión abierta',
    mensaje: `La votación de ${club.name} ha comenzado. ¡Elige tu próxima lectura!`,
  });
}

/**
 * Aviso de que a un club le van a faltar candidatas para la próxima
 * Clubvisión (se manda una sola vez por club y edición, ~10 días antes de
 * que abra la votación).
 */
export async function notifyClubvisionPocosCandidatos(
  clubId: string,
  edition: string,
  candidatas: number,
) {
  const club = await prisma.club.findUnique({
    where: { id: clubId },
    select: { name: true },
  });
  if (!club) return;
  await notifyClubMembers({
    clubId,
    tipo: NotificationType.CLUBVISION_POCOS_CANDIDATOS,
    titulo: '📚 Faltan candidatas para la próxima Clubvisión',
    mensaje:
      candidatas === 0
        ? `${club.name} todavía no tiene ningún libro candidato para la próxima Clubvisión. Añade libros a "Pendiente" para que puedan entrar a votación.`
        : `${club.name} solo tiene ${candidatas} ${candidatas === 1 ? 'candidata' : 'candidatas'} para la próxima Clubvisión. Añade libros a "Pendiente" para que puedan entrar a votación.`,
    extra: { edition },
  });
}

/** ¿Ya se avisó a este club de pocas candidatas para esta edición? */
export async function yaAvisadoPocosCandidatos(
  clubId: string,
  edition: string,
): Promise<boolean> {
  const n = await prisma.notification.findFirst({
    where: {
      clubId,
      tipo: NotificationType.CLUBVISION_POCOS_CANDIDATOS,
      extra: { contains: `"edition":"${edition}"` },
    },
    select: { id: true },
  });
  return n != null;
}

/**
 * Recordatorio individual a quien aún no ha votado en una Clubvisión abierta,
 * cuando queda poco para que cierre la votación (se manda una sola vez por
 * persona y edición).
 */
export async function notifyClubvisionRecordatorioVoto(
  clubId: string,
  clubvisionId: string,
  userId: string,
) {
  const club = await prisma.club.findUnique({
    where: { id: clubId },
    select: { name: true },
  });
  if (!club) return;
  await createNotification({
    userId,
    tipo: NotificationType.CLUBVISION_RECORDATORIO_VOTO,
    titulo: '⏳ La votación está a punto de cerrar',
    mensaje: `Todavía no has votado en la Clubvisión de ${club.name}. ¡No te quedes sin elegir la próxima lectura!`,
    clubId,
    extra: { clubvisionId },
  });
}

/** ¿Ya se avisó a esta persona de que le falta votar en esta Clubvisión? */
export async function yaAvisadoRecordatorioVoto(
  clubvisionId: string,
  userId: string,
): Promise<boolean> {
  const n = await prisma.notification.findFirst({
    where: {
      userId,
      tipo: NotificationType.CLUBVISION_RECORDATORIO_VOTO,
      extra: { contains: `"clubvisionId":"${clubvisionId}"` },
    },
    select: { id: true },
  });
  return n != null;
}

/**
 * Aviso de que este mes no se ha podido abrir Clubvisión para el club por
 * falta de candidatas (se manda una sola vez por club y edición, el mismo
 * día en que tocaba abrir).
 */
export async function notifyClubvisionEdicionSaltada(
  clubId: string,
  edition: string,
) {
  const club = await prisma.club.findUnique({
    where: { id: clubId },
    select: { name: true },
  });
  if (!club) return;
  await notifyClubMembers({
    clubId,
    tipo: NotificationType.CLUBVISION_EDICION_SALTADA,
    titulo: '😔 Este mes no hay Clubvisión',
    mensaje: `${club.name} se ha quedado sin candidatas y no ha podido abrir su Clubvisión de este mes. Añadid libros a "Pendiente" para no perderos la del mes que viene.`,
    extra: { edition },
  });
}

/** ¿Ya se avisó a este club de que se le saltó la edición? */
export async function yaAvisadoEdicionSaltada(
  clubId: string,
  edition: string,
): Promise<boolean> {
  const n = await prisma.notification.findFirst({
    where: {
      clubId,
      tipo: NotificationType.CLUBVISION_EDICION_SALTADA,
      extra: { contains: `"edition":"${edition}"` },
    },
    select: { id: true },
  });
  return n != null;
}

/**
 * Aviso solo para admins/owner de que la edición se ha abierto con menos de
 * 5 candidatas — para que sepan que pueden forzar alguna más a mano y que
 * la papeleta no se quede corta. Una sola vez por club y edición.
 */
export async function notifyClubvisionForzarDisponible(
  clubId: string,
  edition: string,
  candidatas: number,
) {
  const club = await prisma.club.findUnique({
    where: { id: clubId },
    select: { name: true },
  });
  if (!club) return;
  await notifyClubMembers({
    clubId,
    roles: [ClubRole.OWNER, ClubRole.ADMIN],
    tipo: NotificationType.CLUBVISION_FORZAR_DISPONIBLE,
    titulo: '🗳️ La votación se ha abierto un poco corta',
    mensaje: `${club.name} ha abierto su Clubvisión con solo ${candidatas} ${candidatas === 1 ? 'candidata' : 'candidatas'}. Como admin, puedes forzar alguna más a mano desde el menú de Clubvisión.`,
    extra: { edition },
  });
}

/** ¿Ya se avisó a los admins de este club de que podían forzar candidatas en esta edición? */
export async function yaAvisadoForzarDisponible(
  clubId: string,
  edition: string,
): Promise<boolean> {
  const n = await prisma.notification.findFirst({
    where: {
      clubId,
      tipo: NotificationType.CLUBVISION_FORZAR_DISPONIBLE,
      extra: { contains: `"edition":"${edition}"` },
    },
    select: { id: true },
  });
  return n != null;
}

/**
 * Aviso único, al crear un club, con las herramientas de admin relacionadas
 * con Clubvisión — para que a quien lo crea no se le escape que existen
 * (bienvenida los primeros 45 días, forzar candidatas a mano si algún mes
 * van escasas).
 */
export async function notifyClubInfoAdminClubvision(
  clubId: string,
  ownerId: string,
) {
  await createNotification({
    userId: ownerId,
    tipo: NotificationType.CLUB_INFO_ADMIN_CLUBVISION,
    titulo: '🎤 Herramientas de Clubvisión para admins',
    mensaje:
      'Como admin, tienes dos ayudas para Clubvisión: en los primeros 45 días puedes iniciar una Clubvisión de bienvenida en cuanto tengáis candidatas, sin esperar al ciclo mensual; y si algún mes vais escasos de candidatas, puedes forzar alguna a mano desde el menú de Clubvisión.',
    clubId,
  });
}

export async function notifyClubvisionResultados(clubId: string, ganador: string) {
  const club = await prisma.club.findUnique({
    where: { id: clubId },
    select: { name: true },
  });
  if (!club) return;
  await notifyClubMembers({
    clubId,
    tipo: NotificationType.CLUBVISION_RESULTADOS,
    titulo: '🏆 Ya hay ganadora',
    mensaje: `La Gala de ${club.name} tiene resultado. Entra a descubrir quién ha ganado.`,
  });
}

export async function notifyClubBookOfYear(
  clubId: string,
  year: number,
  eventKey: string,
  mensaje: string,
) {
  const extra = JSON.stringify({ destination: 'clubBookOfYear', year, eventKey });
  const existing = await prisma.notification.findFirst({
    where: { clubId, tipo: NotificationType.CLUB_BOOK_OF_YEAR, extra },
    select: { id: true },
  });
  if (existing) return;
  await notifyClubMembers({
    clubId,
    tipo: NotificationType.CLUB_BOOK_OF_YEAR,
    titulo: 'Libro del año del club',
    mensaje,
    extra: { destination: 'clubBookOfYear', year, eventKey },
  });
}

export async function notifyLecturaNueva(
  clubId: string,
  bookTitle: string,
  bookId: string,
  readingId?: string | null,
) {
  const club = await prisma.club.findUnique({
    where: { id: clubId },
    select: { name: true },
  });
  if (!club) return;
  await notifyClubMembers({
    clubId,
    tipo: NotificationType.LECTURA_NUEVA,
    titulo: '📖 Nueva lectura oficial',
    mensaje: `${club.name} empieza "${bookTitle}". ¡Prepárate para leer!`,
    bookId,
    extra: { bookTitle, ...(readingId ? { readingId } : {}) },
  });
}

export async function notifyLecturaCompartida({
  clubId,
  creadoraUserId,
  bookTitle,
  bookId,
  readingId,
  abiertaEnSolitario = false,
}: {
  clubId: string;
  creadoraUserId: string;
  bookTitle: string;
  bookId: string;
  readingId?: string;
  // true cuando quien la abre es, de momento, la única persona leyendo el
  // libro (antes esto no podía pasar: solo se llegaba a crear una lectura
  // libre una vez había 2+ lectoras a la vez, así que el aviso de "nueva
  // lectura compartida" siempre era certero). El texto avisa de que aún no
  // hay más gente, en vez de dar a entender que ya sois varias.
  abiertaEnSolitario?: boolean;
}) {
  await notifyClubMembers({
    clubId,
    excludeUserId: creadoraUserId,
    tipo: NotificationType.LECTURA_NUEVA,
    titulo: abiertaEnSolitario ? '💬 Conversación abierta' : '📖 Nueva lectura compartida',
    mensaje: abiertaEnSolitario
      ? `Se ha abierto una conversación sobre "${bookTitle}" — únete si tú también lo estás leyendo.`
      : `Se ha abierto "${bookTitle}" en Lecturas compartidas.`,
    bookId,
    extra: { bookTitle, ...(readingId ? { readingId } : {}) },
  });
}

export async function notifyComentarioLectura({
  clubId,
  autorNombre,
  autorUserId,
  bookTitle,
  bookId,
  participantes,
  readingId,
}: {
  clubId: string;
  autorNombre: string;
  autorUserId: string;
  bookTitle: string;
  bookId: string;
  participantes: string[]; // userIds que han comentado en ese hilo
  readingId?: string;
}) {
  // Solo notificar a participantes del hilo, no a todos
  const destinatarios = participantes.filter((id) => id !== autorUserId);
  if (destinatarios.length === 0) return;

  await prisma.notification.createMany({
    data: destinatarios.map((userId) => ({
      userId,
      tipo: NotificationType.COMENTARIO_LECTURA,
      titulo: '💬 Nuevo comentario',
      mensaje: `${autorNombre} ha comentado en "${bookTitle}"`,
      clubId,
      bookId,
      extra: JSON.stringify({
        bookTitle,
        ...(readingId ? { readingId } : {}),
      }),
    })),
  });
}

export async function notifyLibroTerminado({
  clubId,
  lectoraNombre,
  lectoraUserId,
  bookTitle,
  bookId,
}: {
  clubId: string;
  lectoraNombre: string;
  lectoraUserId: string;
  bookTitle: string;
  bookId: string;
}) {
  await notifyClubMembers({
    clubId,
    excludeUserId: lectoraUserId,
    tipo: NotificationType.LIBRO_TERMINADO,
    titulo: '✅ Libro terminado',
    mensaje: `${lectoraNombre} ha terminado "${bookTitle}"`,
    bookId,
    extra: { bookTitle },
  });
}

export async function notifyLibroEmpezado({
  clubId,
  lectoraNombre,
  lectoraUserId,
  bookTitle,
  bookId,
}: {
  clubId: string;
  lectoraNombre: string;
  lectoraUserId: string;
  bookTitle: string;
  bookId: string;
}) {
  await notifyClubMembers({
    clubId,
    excludeUserId: lectoraUserId,
    tipo: NotificationType.LIBRO_EMPEZADO,
    titulo: '📖 Nueva lectura personal',
    mensaje: `${lectoraNombre} ha empezado a leer "${bookTitle}"`,
    bookId,
    extra: { bookTitle },
  });
}

export async function notifyLibroNuevoBiblioteca({
  clubId,
  autoraNombre,
  autoraUserId,
  libros,
}: {
  clubId: string;
  autoraNombre: string;
  autoraUserId: string;
  libros: Array<{ id: string; title: string }>;
}) {
  const titulo = libros.length === 1
    ? '✨ Libro nuevo en la biblioteca'
    : `✨ ${libros.length} libros nuevos en la biblioteca`;
  const mensaje = libros.length === 1
    ? `${autoraNombre} ha añadido "${libros[0]?.title}"`
    : `${autoraNombre} ha añadido ${libros.length} libros: ${libros.slice(0, 2).map(({ title }) => title).join(', ')}${libros.length > 2 ? ` y ${libros.length - 2} más` : ''}`;

  await notifyClubMembers({
    clubId,
    excludeUserId: autoraUserId,
    tipo: NotificationType.LIBRO_NUEVO_BIBLIOTECA,
    titulo,
    mensaje,
    bookId: libros.length === 1 ? libros[0]?.id : undefined,
    extra: libros.length === 1
      ? { bookTitle: libros[0]?.title }
      : {
          destination: 'BIBLIOTECA',
          bookIds: libros.map(({ id }) => id),
          bookTitles: libros.map(({ title }) => title),
        },
  });
}

export async function notifyNuevaMiembro({
  clubId,
  nuevaMiembroNombre,
  nuevaMiembroUserId,
}: {
  clubId: string;
  nuevaMiembroNombre: string;
  nuevaMiembroUserId: string;
}) {
  const club = await prisma.club.findUnique({
    where: { id: clubId },
    select: { name: true },
  });
  if (!club) return;
  await notifyClubMembers({
    clubId,
    excludeUserId: nuevaMiembroUserId,
    tipo: NotificationType.NUEVA_MIEMBRO,
    titulo: '👋 Nueva lectora',
    mensaje: `${nuevaMiembroNombre} se ha unido a ${club.name}`,
    extra: { userId: nuevaMiembroUserId },
  });
}

/** Avisa a quien administra el club (OWNER/ADMIN) de una nueva solicitud de ingreso. */
export async function notifySolicitudIngreso({
  clubId,
  solicitanteNombre,
  solicitanteUserId,
}: {
  clubId: string;
  solicitanteNombre: string;
  solicitanteUserId: string;
}) {
  const club = await prisma.club.findUnique({
    where: { id: clubId },
    select: { name: true },
  });
  if (!club) return;
  const admins = await prisma.clubMember.findMany({
    where: { clubId, role: { in: [ClubRole.OWNER, ClubRole.ADMIN] } },
    select: { userId: true },
  });
  const destinatarios = await filterEnabledRecipients(
    admins.map((m) => m.userId),
    NotificationType.CLUB_SOLICITUD_INGRESO,
  );
  if (destinatarios.length === 0) return;
  await prisma.notification.createMany({
    data: destinatarios.map((userId) => ({
      userId,
      tipo: NotificationType.CLUB_SOLICITUD_INGRESO,
      titulo: '🚪 Solicitud de ingreso',
      mensaje: `${solicitanteNombre} quiere unirse a ${club.name}`,
      clubId,
      extra: JSON.stringify({ userId: solicitanteUserId }),
    })),
  });
}

/** Avisa a quien solicitó unirse de que su solicitud se ha aceptado o rechazado. */
export async function notifySolicitudResuelta({
  clubId,
  userId,
  aceptada,
}: {
  clubId: string;
  userId: string;
  aceptada: boolean;
}) {
  const club = await prisma.club.findUnique({
    where: { id: clubId },
    select: { name: true },
  });
  if (!club) return;
  const [destinatario] = await filterEnabledRecipients(
    [userId],
    NotificationType.CLUB_SOLICITUD_RESUELTA,
  );
  if (!destinatario) return;
  await prisma.notification.create({
    data: {
      userId,
      tipo: NotificationType.CLUB_SOLICITUD_RESUELTA,
      titulo: aceptada ? '🎉 Solicitud aceptada' : 'Solicitud no aceptada',
      mensaje: aceptada
        ? `Ya formas parte de ${club.name}`
        : `Tu solicitud para unirte a ${club.name} no se ha aceptado esta vez`,
      clubId,
    },
  });
}

// ─────────────────────────────────────────────
// Leer y gestionar notificaciones
// ─────────────────────────────────────────────

export async function getNotificaciones(userId: string) {
  const notificaciones = await prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  const noLeidas = notificaciones.filter((n) => !n.leida).length;

  return {
    notificaciones: notificaciones.map((n) => ({
      id: n.id,
      tipo: n.tipo,
      titulo: n.titulo,
      mensaje: n.mensaje,
      leida: n.leida,
      clubId: n.clubId,
      bookId: n.bookId,
      extra: n.extra ? JSON.parse(n.extra) : null,
      fecha: n.createdAt.toISOString(),
    })),
    noLeidas,
  };
}

type NotificationPageRow = {
  id: string;
  tipo: NotificationType;
  titulo: string;
  mensaje: string;
  leida: boolean;
  clubId: string | null;
  bookId: string | null;
  extra: string | null;
  createdAt: Date;
};

type NotificationPageClient = {
  notification: {
    findMany(args: any): Promise<NotificationPageRow[]>;
  };
};

export async function getNotificacionesPage(
  userId: string,
  pagination: PaginationRequest,
  client: NotificationPageClient = prisma,
) {
  const rows = await client.notification.findMany({
    where: {
      userId,
      ...descendingCursorFilter('createdAt', pagination.cursor),
    },
    select: {
      id: true,
      tipo: true,
      titulo: true,
      mensaje: true,
      leida: true,
      clubId: true,
      bookId: true,
      extra: true,
      createdAt: true,
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: pagination.limit + 1,
  });
  const page = pageFromRows(rows, pagination.limit, (row) => ({
    value: row.createdAt.toISOString(),
    id: row.id,
  }));
  return {
    ...page,
    items: page.items.map((notification) => ({
      id: notification.id,
      tipo: notification.tipo,
      titulo: notification.titulo,
      mensaje: notification.mensaje,
      leida: notification.leida,
      clubId: notification.clubId,
      bookId: notification.bookId,
      extra: notification.extra ? JSON.parse(notification.extra) : null,
      fecha: notification.createdAt.toISOString(),
    })),
  };
}

export async function marcarLeida(userId: string, notificacionId: string) {
  await prisma.notification.updateMany({
    where: { id: notificacionId, userId },
    data: { leida: true },
  });
  return { ok: true };
}

export async function marcarTodasLeidas(userId: string) {
  await prisma.notification.updateMany({
    where: { userId, leida: false },
    data: { leida: true },
  });
  return { ok: true };
}

export async function eliminarNotificacion(
  userId: string,
  notificacionId: string,
) {
  return deleteNotificationForUser(prisma, userId, notificacionId);
}

type NotificationDeleteClient = {
  notification: {
    deleteMany(args: {
      where: { id: string; userId: string };
    }): Promise<{ count: number }>;
  };
};

export async function deleteNotificationForUser(
  client: NotificationDeleteClient,
  userId: string,
  notificacionId: string,
) {
  await client.notification.deleteMany({
    where: { id: notificacionId, userId },
  });
  return { ok: true };
}

export async function eliminarTodasNotificaciones(userId: string) {
  await prisma.notification.deleteMany({ where: { userId } });
  return { ok: true };
}
export async function notifyPropuestaActivada(clubId: string, bookTitle: string) {
  const club = await prisma.club.findUnique({
    where: { id: clubId },
    select: { name: true },
  });
  if (!club) return;
  await notifyClubMembers({
    clubId,
    tipo: NotificationType.LECTURA_NUEVA,
    titulo: '📖 ¡Lectura acordada!',
    mensaje: `${club.name} ha elegido leer "${bookTitle}". ¡Entrad a Clubvisión para empezar!`,
    extra: { bookTitle, fromProposal: true },
  });
}

export async function notifyLogroDesbloqueado({
  clubId,
  userId,
  achievementTitle,
  achievementIcon,
}: {
  clubId: string;
  userId: string;
  achievementTitle: string;
  achievementIcon: string;
}) {
  // Notificar a todos los miembros del club excepto al que desbloqueó el logro
  const members = await prisma.clubMember.findMany({
    where: { clubId, userId: { not: userId } },
    select: { userId: true },
  });

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true },
  });

  if (!user || members.length === 0) return;

  const destinatarios = await filterEnabledRecipients(
    members.map((m) => m.userId),
    NotificationType.LOGRO_DESBLOQUEADO,
  );
  if (destinatarios.length === 0) return;

  await prisma.notification.createMany({
    data: destinatarios.map((userId) => ({
      userId,
      tipo: 'LOGRO_DESBLOQUEADO' as const,
      titulo: 'Nuevo logro desbloqueado',
      mensaje: `${user.name} ha desbloqueado "${achievementTitle}" ${achievementIcon}`,
      clubId,
      extra: JSON.stringify({ achievementTitle, achievementIcon, logradoPor: user.name }),
    })),
  });
}

// ─────────────────────────────────────────────
// Ligas de ClubReads
// ─────────────────────────────────────────────

/** Resultado de temporada, una notificación por participante. */
const NOMBRE_DIVISION: Record<string, string> = {
  BRONCE: 'Bronce',
  PLATA: 'Plata',
  ORO: 'Oro',
  PLATINO: 'Platino',
  DIAMANTE: 'Diamante',
};

export async function notifyLigaResultado(
  season: number,
  entradas: {
    userId: string;
    rank: number;
    total: number;
    puntos: number;
    division: string;
    nuevaDivision: string | null;
  }[],
) {
  if (entradas.length === 0) return;
  const destinatarios = new Set(
    await filterEnabledRecipients(
      entradas.map((e) => e.userId),
      NotificationType.LIGA_RESULTADO,
    ),
  );
  const data = entradas
    .filter((e) => destinatarios.has(e.userId))
    .map((e) => {
      const podio = e.rank <= 3;
      const medalla = e.rank === 1 ? '🥇' : e.rank === 2 ? '🥈' : '🥉';
      const divisionActual = NOMBRE_DIVISION[e.division] ?? e.division;
      const orden = ['BRONCE', 'PLATA', 'ORO', 'PLATINO', 'DIAMANTE'];
      let cambioTexto = '';
      if (e.nuevaDivision != null && e.nuevaDivision !== e.division) {
        const nueva = NOMBRE_DIVISION[e.nuevaDivision] ?? e.nuevaDivision;
        const sube = orden.indexOf(e.nuevaDivision) > orden.indexOf(e.division);
        cambioTexto = sube
          ? ` ¡Asciendes a ${nueva} la próxima temporada!`
          : ` Bajas a ${nueva} la próxima temporada.`;
      }
      return {
        userId: e.userId,
        tipo: NotificationType.LIGA_RESULTADO,
        titulo: podio
          ? `${medalla} ¡Podio en ${divisionActual}!`
          : `Temporada de Ligas cerrada (${divisionActual})`,
        mensaje: podio
          ? `Acabaste ${e.rank}º de ${e.total} en tu división esta temporada.${cambioTexto}`
          : `Quedaste ${e.rank}º de ${e.total} en tu división con ${e.puntos} puntos.${cambioTexto} Empieza una nueva.`,
        extra: JSON.stringify({ season, rank: e.rank, total: e.total, division: e.division }),
      };
    });
  if (data.length > 0) await prisma.notification.createMany({ data });
}

/** Aviso de que la temporada está a punto de cerrarse. */
export async function notifyLigaCierreProximo(
  season: number,
  entradas: {
    userId: string;
    rank: number;
    total: number;
    puntosAlPodio: number;
    horasRestantes: number;
  }[],
) {
  if (entradas.length === 0) return;
  const destinatarios = new Set(
    await filterEnabledRecipients(
      entradas.map((e) => e.userId),
      NotificationType.LIGA_CIERRE_PROXIMO,
    ),
  );
  const data = entradas
    .filter((e) => destinatarios.has(e.userId))
    .map((e) => {
      const horas = Math.max(1, Math.round(e.horasRestantes));
      const cola =
        e.rank > 3 && e.puntosAlPodio > 0
          ? ` El podio está a ${e.puntosAlPodio} puntos.`
          : e.rank <= 3
            ? ' ¡Aguanta en el podio!'
            : '';
      return {
        userId: e.userId,
        tipo: NotificationType.LIGA_CIERRE_PROXIMO,
        titulo: 'La temporada de Ligas está por cerrarse',
        mensaje: `Quedan unas ${horas} h. Vas ${e.rank}º de ${e.total}.${cola}`,
        extra: JSON.stringify({ season }),
      };
    });
  if (data.length > 0) await prisma.notification.createMany({ data });
}

/** ¿Ya se envió el aviso de cierre de esta temporada a este usuario? */
export async function yaAvisadoCierreLiga(
  userId: string,
  season: number,
): Promise<boolean> {
  const n = await prisma.notification.findFirst({
    where: {
      userId,
      tipo: NotificationType.LIGA_CIERRE_PROXIMO,
      extra: { contains: `"season":${season}` },
    },
    select: { id: true },
  });
  return n != null;
}

/** Aviso de que una racha larga se rompe hoy si no se hace check-in. */
export async function notifyLigaRachaEnRiesgo(
  userId: string,
  dias: number,
  fecha: string,
) {
  const [habilitado] = await filterEnabledRecipients(
    [userId],
    NotificationType.LIGA_RACHA_EN_RIESGO,
  );
  if (!habilitado) return null;
  return prisma.notification.create({
    data: {
      userId,
      tipo: NotificationType.LIGA_RACHA_EN_RIESGO,
      titulo: '🔥 Tu racha está en juego',
      mensaje: `Llevas ${dias} días seguidos leyendo. Si no marcas hoy, la racha se rompe y el bonus de las Ligas vuelve a empezar desde +1.`,
      extra: JSON.stringify({ date: fecha }),
    },
  });
}

/** ¿Ya se avisó hoy de que la racha está en riesgo? */
export async function yaAvisadoRachaHoy(
  userId: string,
  fecha: string,
): Promise<boolean> {
  const n = await prisma.notification.findFirst({
    where: {
      userId,
      tipo: NotificationType.LIGA_RACHA_EN_RIESGO,
      extra: { contains: `"date":"${fecha}"` },
    },
    select: { id: true },
  });
  return n != null;
}

// ─────────────────────────────────────────────
// Preferencias de notificación (Ajustes)
// ─────────────────────────────────────────────

/** Todos los tipos de notificación existentes, en el orden en que se muestran en Ajustes. */
export const TIPOS_NOTIFICACION: NotificationType[] = [
  NotificationType.CLUBVISION_ABIERTA,
  NotificationType.CLUBVISION_RESULTADOS,
  NotificationType.LECTURA_NUEVA,
  NotificationType.LIBRO_NUEVO_BIBLIOTECA,
  NotificationType.LIBRO_EMPEZADO,
  NotificationType.LIBRO_TERMINADO,
  NotificationType.COMENTARIO_LECTURA,
  NotificationType.NUEVA_MIEMBRO,
  NotificationType.LOGRO_DESBLOQUEADO,
  NotificationType.CLUB_BOOK_OF_YEAR,
  NotificationType.LIGA_RESULTADO,
  NotificationType.LIGA_CIERRE_PROXIMO,
  NotificationType.LIGA_RACHA_EN_RIESGO,
];

export async function getPreferenciasNotificacion(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { notificationsDisabled: true },
  });
  const desactivados = new Set(user?.notificationsDisabled ?? []);
  return {
    ok: true,
    tipos: TIPOS_NOTIFICACION.map((tipo) => ({
      tipo,
      activado: !desactivados.has(tipo),
    })),
  };
}

export async function actualizarPreferenciaNotificacion(
  userId: string,
  tipo: NotificationType,
  activado: boolean,
) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { notificationsDisabled: true },
  });
  if (!user) return { ok: false, mensaje: 'Usuaria no encontrada' };

  const actuales = new Set(user.notificationsDisabled);
  if (activado) {
    actuales.delete(tipo);
  } else {
    actuales.add(tipo);
  }

  await prisma.user.update({
    where: { id: userId },
    data: { notificationsDisabled: { set: [...actuales] } },
  });

  return { ok: true };
}
