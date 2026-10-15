import { prisma } from '../prisma.js';
import { amistadesQueComparten } from './amistades-ver.service.js';
import { crearLimitador } from './amistades-core.js';

const MAX_MIEMBROS = 5;
const MAX_RETOS_ACTIVOS = 3;
const MAX_OBJETIVO = 200;
const DIAS_VISIBLE_TRAS_FIN = 7;
const DIA_MS = 24 * 60 * 60 * 1000;

const puedeCrear = crearLimitador(6);

// ─────────────────────────────────────────────────────────────────────────────
// Reto de lectura entre amistades (meta común, sin clasificación)
// ─────────────────────────────────────────────────────────────────────────────

export function periodoDelReto(periodo: string, ahora = new Date()) {
  const y = ahora.getUTCFullYear();
  if (periodo === 'ANO') return { desde: new Date(Date.UTC(y, 0, 1)), hasta: new Date(Date.UTC(y + 1, 0, 1)) };
  const m = ahora.getUTCMonth();
  return { desde: new Date(Date.UTC(y, m, 1)), hasta: new Date(Date.UTC(y, m + 1, 1)) };
}

/// Crea un reto con tu meta común y lo propone a 1-4 amistades.
export async function crearRetoAmigos(
  yo: string,
  datos: { titulo: string; objetivo: number; periodo: string; nombres: string[] },
) {
  if (!puedeCrear(yo)) return { ok: false, mensaje: 'Vas muy rápido. Espera un momento y vuelve a intentarlo.' };
  const objetivo = Math.trunc(Number(datos.objetivo));
  if (!Number.isFinite(objetivo) || objetivo < 1 || objetivo > MAX_OBJETIVO) {
    return { ok: false, mensaje: `La meta debe estar entre 1 y ${MAX_OBJETIVO} libros.` };
  }
  const buscadas = [...new Set(datos.nombres.map((n) => String(n ?? '').trim().toLowerCase()).filter(Boolean))];
  if (buscadas.length < 1 || buscadas.length + 1 > MAX_MIEMBROS) {
    return { ok: false, mensaje: `Un reto es para entre 2 y ${MAX_MIEMBROS} personas.` };
  }
  const amistades = await amistadesQueComparten(yo);
  const elegidas = buscadas.map((n) => amistades.find((a) => a.name.toLowerCase() === n));
  if (elegidas.some((e) => !e)) return { ok: false, mensaje: 'Solo puedes invitar a tus amistades.' };

  const ahora = new Date();
  const activos = await prisma.retoAmistad.count({ where: { creadorId: yo, hasta: { gt: ahora } } });
  if (activos >= MAX_RETOS_ACTIVOS) {
    return { ok: false, mensaje: `Ya tienes ${MAX_RETOS_ACTIVOS} retos en marcha. Termina alguno antes de crear otro.` };
  }
  const { desde, hasta } = periodoDelReto(datos.periodo, ahora);
  const titulo = String(datos.titulo ?? '').trim().slice(0, 60) || 'Nuestro reto';
  const reto = await prisma.retoAmistad.create({
    data: {
      creadorId: yo,
      titulo,
      objetivo,
      desde,
      hasta,
      miembros: {
        create: [
          { userId: yo, aceptado: true },
          ...elegidas.map((e) => ({ userId: e!.id, aceptado: false })),
        ],
      },
    },
    select: { id: true },
  });
  return { ok: true, id: reto.id, mensaje: 'Reto creado. Les llegará la propuesta en Amigos 💜' };
}

/// Aceptar o rechazar una propuesta de reto.
export async function responderRetoAmigos(yo: string, retoId: string, aceptar: boolean) {
  const m = await prisma.retoAmistadMiembro.findUnique({
    where: { retoId_userId: { retoId, userId: yo } },
    select: { id: true, aceptado: true },
  });
  if (!m) return { ok: false, mensaje: 'Ese reto ya no existe.' };
  if (aceptar) {
    if (!m.aceptado) await prisma.retoAmistadMiembro.update({ where: { id: m.id }, data: { aceptado: true } });
    return { ok: true, mensaje: '¡Os apuntáis al reto!' };
  }
  return salirRetoAmigos(yo, retoId);
}

/// Salir de un reto (o rechazarlo). Si no queda nadie que lo haya aceptado, se borra.
export async function salirRetoAmigos(yo: string, retoId: string) {
  await prisma.retoAmistadMiembro.deleteMany({ where: { retoId, userId: yo } });
  const quedan = await prisma.retoAmistadMiembro.count({ where: { retoId, aceptado: true } });
  if (quedan === 0) await prisma.retoAmistad.deleteMany({ where: { id: retoId } });
  return { ok: true, mensaje: 'Has salido del reto.' };
}

/// Tus retos: el progreso es la suma de libros terminados por quien ya ha aceptado.
/// Cada persona aparece con su aportación, sin ordenar por quién va más.
export async function getRetosAmigos(yo: string) {
  const limite = new Date(Date.now() - DIAS_VISIBLE_TRAS_FIN * DIA_MS);
  const retos = await prisma.retoAmistad.findMany({
    where: { hasta: { gt: limite }, miembros: { some: { userId: yo } } },
    orderBy: { createdAt: 'desc' },
    include: {
      miembros: { include: { user: { select: { id: true, name: true, avatarUrl: true } } } },
    },
  });
  const items = [];
  for (const r of retos) {
    const aceptadas = r.miembros.filter((m) => m.aceptado);
    const yoMiembro = r.miembros.find((m) => m.userId === yo);
    const filas = aceptadas.length
      ? await prisma.readingCompletion.findMany({
          where: { userId: { in: aceptadas.map((m) => m.userId) }, finishedAt: { gte: r.desde, lt: r.hasta } },
          select: { userId: true, bookId: true },
        })
      : [];
    const porPersona = new Map<string, Set<string>>();
    for (const f of filas) {
      if (!porPersona.has(f.userId)) porPersona.set(f.userId, new Set());
      porPersona.get(f.userId)!.add(f.bookId);
    }
    const personas = r.miembros
      .map((m) => ({
        nombre: m.user.name,
        avatarUrl: m.user.avatarUrl ?? '',
        yo: m.userId === yo,
        aceptado: m.aceptado,
        libros: m.aceptado ? (porPersona.get(m.userId)?.size ?? 0) : 0,
      }))
      .sort((a, b) => Number(b.yo) - Number(a.yo) || a.nombre.localeCompare(b.nombre, 'es'));
    const total = personas.reduce((s, p) => s + p.libros, 0);
    items.push({
      id: r.id,
      titulo: r.titulo,
      objetivo: r.objetivo,
      desde: r.desde.toISOString(),
      hasta: r.hasta.toISOString(),
      total,
      conseguido: total >= r.objetivo,
      terminado: r.hasta.getTime() <= Date.now(),
      invitada: !!yoMiembro && !yoMiembro.aceptado,
      creadoPorMi: r.creadorId === yo,
      personas,
    });
  }
  return { ok: true, items };
}

// ─────────────────────────────────────────────────────────────────────────────
// Racha compartida
// ─────────────────────────────────────────────────────────────────────────────

const DIAS_RACHA = 120;

function diaAnterior(d: string) {
  return new Date(new Date(`${d}T00:00:00.000Z`).getTime() - DIA_MS).toISOString().slice(0, 10);
}

/// Cálculo puro: días seguidos en los que las dos habéis hecho check-in.
/// Si hoy aún falta alguna, la racha sigue viva contando desde ayer.
export function rachaConjunta(mias: Set<string>, suyas: Set<string>, hoy: string) {
  const ambas = (d: string) => mias.has(d) && suyas.has(d);
  const hoyLasDos = ambas(hoy);
  let dia = hoyLasDos ? hoy : diaAnterior(hoy);
  let dias = 0;
  while (ambas(dia)) {
    dias++;
    dia = diaAnterior(dia);
  }
  return { dias, hoyLasDos, yoHoy: mias.has(hoy), ellaHoy: suyas.has(hoy) };
}

/// Con quién llevas más días seguidos leyendo: solo amistades que comparten «lo que leo».
export async function getRachasCompartidas(yo: string) {
  const amistades = (await amistadesQueComparten(yo)).filter((a) => a.friendsSeeReading);
  if (amistades.length === 0) return { ok: true, items: [] };
  const hoy = new Date().toISOString().slice(0, 10);
  const desde = new Date(Date.now() - DIAS_RACHA * DIA_MS).toISOString().slice(0, 10);
  const filas = await prisma.dailyCheckin.findMany({
    where: { userId: { in: [yo, ...amistades.map((a) => a.id)] }, date: { gte: desde } },
    select: { userId: true, date: true },
  });
  const porUsuario = new Map<string, Set<string>>();
  for (const f of filas) {
    if (!porUsuario.has(f.userId)) porUsuario.set(f.userId, new Set());
    porUsuario.get(f.userId)!.add(f.date);
  }
  const mias = porUsuario.get(yo) ?? new Set<string>();
  const items = amistades
    .map((a) => ({
      nombre: a.name,
      avatarUrl: a.avatarUrl ?? '',
      ...rachaConjunta(mias, porUsuario.get(a.id) ?? new Set<string>(), hoy),
    }))
    .filter((r) => r.dias >= 2)
    .sort((a, b) => b.dias - a.dias || a.nombre.localeCompare(b.nombre, 'es'));
  return { ok: true, items };
}
