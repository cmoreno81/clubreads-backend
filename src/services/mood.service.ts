import { ClubMood, ReadingStatus } from '@prisma/client';

import { prisma } from '../prisma.js';

const MOODS = Object.values(ClubMood);

function inicioSemana() {
  const ahora = new Date();
  const dia = ahora.getUTCDay() || 7;
  const inicio = new Date(ahora);
  inicio.setUTCDate(ahora.getUTCDate() - dia + 1);
  inicio.setUTCHours(0, 0, 0, 0);
  return inicio;
}

function claveSemana(fecha = inicioSemana()) {
  return fecha.toISOString().slice(0, 10);
}

function tiempoRelativo(fecha: Date) {
  const diffMin = Math.floor((Date.now() - fecha.getTime()) / 60000);
  if (diffMin < 1) return 'ahora';
  if (diffMin < 60) return `hace ${diffMin} min`;
  const horas = Math.floor(diffMin / 60);
  if (horas < 24) return `hace ${horas} h`;
  if (horas < 48) return 'ayer';
  return fecha.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}

function moodValido(valor: string): ClubMood | null {
  const mood = valor.trim().toUpperCase() as ClubMood;
  return MOODS.includes(mood) ? mood : null;
}

function textoMood(mood: ClubMood) {
  const textos: Record<ClubMood, string> = {
    HOOKED: 'completamente enganchado',
    SHOCKED: 'en shock',
    CRYING: 'emocionalmente destrozado',
    ANGRY: 'enfadado con sus lecturas',
    LAUGHING: 'especialmente divertido',
    BLOCKED: 'algo bloqueado',
  };
  return textos[mood];
}

export async function registrarMoodClub(usuario: string, valor: string) {
  const nombre = usuario.trim();
  const mood = moodValido(valor);

  if (!nombre || !mood) return { ok: false, mensaje: 'Datos no válidos' };

  const user = await prisma.user.findUnique({ where: { name: nombre } });
  if (!user) return { ok: false, mensaje: 'Usuaria no encontrada' };

  await prisma.clubMoodVote.upsert({
    where: {
      userId_weekKey: { userId: user.id, weekKey: claveSemana() },
    },
    update: { mood },
    create: { userId: user.id, weekKey: claveSemana(), mood },
  });

  return { ok: true };
}

export async function getMoodClub(usuarioActual = '') {
  const desde = inicioSemana();
  const weekKey = claveSemana(desde);

  const [comentarios, terminados, leyendo, lecturasActivas, votos] =
    await Promise.all([
      prisma.comment.findMany({
        where: { deletedAt: null, createdAt: { gte: desde } },
        include: {
          user: true,
          likes: true,
          replies: { where: { deletedAt: null }, select: { id: true } },
          conversation: {
            include: { reading: { include: { book: true } } },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 60,
      }),
      prisma.library.findMany({
        where: { status: ReadingStatus.FINISHED, finishedAt: { gte: desde } },
        include: { user: true, book: true },
        orderBy: { finishedAt: 'desc' },
        take: 20,
      }),
      prisma.library.findMany({
        where: { status: { in: [ReadingStatus.READING, ReadingStatus.REREADING] } },
        select: { userId: true },
      }),
      prisma.reading.count({ where: { status: 'ACTIVE' } }),
      prisma.clubMoodVote.findMany({
        where: { weekKey },
        include: { user: { select: { name: true } } },
      }),
    ]);

  const distribucion = Object.fromEntries(MOODS.map((mood) => [mood, 0]));
  for (const voto of votos) distribucion[voto.mood]++;

  const miMood = votos.find((voto) => voto.user.name === usuarioActual.trim())?.mood ?? null;
  const dominante = MOODS.reduce<ClubMood | null>((mejor, mood) => {
    if (!mejor || distribucion[mood] > distribucion[mejor]) return mood;
    return mejor;
  }, null);

  const comentarioDestacado = [...comentarios]
    .filter((comentario) => !comentario.parentId)
    .sort(
      (a, b) =>
        b.likes.length + b.replies.length * 2 -
        (a.likes.length + a.replies.length * 2),
    )[0];

  const actividadPorLibro = new Map<
    string,
    { libro: string; coverUrl: string; comentarios: number; reacciones: number }
  >();
  for (const comentario of comentarios) {
    const book = comentario.conversation.reading.book;
    const actual = actividadPorLibro.get(book.id) ?? {
      libro: book.title,
      coverUrl: book.coverUrl ?? '',
      comentarios: 0,
      reacciones: 0,
    };
    actual.comentarios++;
    actual.reacciones += comentario.likes.length;
    actividadPorLibro.set(book.id, actual);
  }
  const libroActivo = [...actividadPorLibro.values()].sort(
    (a, b) =>
      b.comentarios + b.reacciones - (a.comentarios + a.reacciones),
  )[0];

  const reaccionesSemana = comentarios.reduce(
    (total, comentario) => total + comentario.likes.length,
    0,
  );

  const actividadEventos = [
    ...comentarios.slice(0, 10).map((comentario) => ({
      fecha: comentario.createdAt,
      icono: comentario.parentId ? '↩️' : '💬',
      texto: comentario.parentId
        ? `${comentario.user.name} respondió en ${comentario.conversation.reading.book.title} ${tiempoRelativo(comentario.createdAt)}`
        : `${comentario.user.name} comentó en ${comentario.conversation.reading.book.title} ${tiempoRelativo(comentario.createdAt)}`,
      tipo: 'COMENTARIO',
      libro: comentario.conversation.reading.book.title,
      capitulo: comentario.conversation.title,
    })),
    ...terminados.slice(0, 5).map((lectura) => ({
      fecha: lectura.finishedAt!,
      icono: '📚',
      texto: `${lectura.user.name} terminó ${lectura.book.title} ${tiempoRelativo(lectura.finishedAt!)}`,
      tipo: 'LIBRO',
      libro: lectura.book.title,
      capitulo: '',
    })),
  ];

  const actividad = actividadEventos
    .sort((a, b) => b.fecha.getTime() - a.fecha.getTime())
    .slice(0, 10)
    .map(({ fecha: _, ...evento }) => evento);

  const estados: string[] = [];
  if (comentarios.length >= 10) estados.push('🔥 Debate caliente');
  if (reaccionesSemana >= 10) estados.push('✨ Muchas reacciones');
  if (lecturasActivas > 0) estados.push('📚 Club en marcha');
  if (estados.length === 0) estados.push('😌 Semana tranquila');

  const titular =
    dominante && votos.length > 0
      ? `Esta semana el club está ${textoMood(dominante)}.`
      : comentarios.length >= 5
        ? 'Las conversaciones están cogiendo ritmo.'
        : 'Semana tranquila entre lecturas.';

  return {
    titular,
    narrador: comentarios.length >= 10
      ? 'Hay teorías, respuestas y emociones cruzándose entre capítulos. El club está especialmente vivo.'
      : 'Cada comentario, reacción y página terminada va construyendo la historia de esta semana.',
    estados,
    actividad,
    moodSemanal: { miMood, total: votos.length, distribucion },
    resumen: {
      comentariosSemana: comentarios.length,
      reaccionesSemana,
      terminadosSemana: terminados.length,
      lectorasActivas: new Set(leyendo.map((item) => item.userId)).size,
      lecturasActivas,
    },
    conversacionDestacada: comentarioDestacado
      ? {
          usuario: comentarioDestacado.user.name,
          texto: comentarioDestacado.text,
          libro: comentarioDestacado.conversation.reading.book.title,
          capitulo: comentarioDestacado.conversation.title,
          reacciones: comentarioDestacado.likes.length,
          respuestas: comentarioDestacado.replies.length,
        }
      : null,
    libroActivo: libroActivo ?? null,
  };
}
