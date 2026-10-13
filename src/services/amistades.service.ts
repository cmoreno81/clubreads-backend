import { ClubType, FriendshipStatus, ProfileVisibility } from '@prisma/client';

import { prisma } from '../prisma.js';
import { backgroundError } from '../logging/logger.js';
import { getPrivacidadAmistades } from './amistades-ver.service.js';
import { notifyAmistadAceptada, notifyAmistadSolicitud } from './notifications.service.js';
import {
  MAX_BUSQUEDAS_POR_MINUTO,
  MAX_RESULTADOS_BUSQUEDA,
  MAX_SOLICITUDES_PENDIENTES,
  MAX_SOLICITUDES_POR_DIA,
  MIN_LETRAS_BUSQUEDA,
  crearLimitador,
  estadoDeAmistad,
  formatearCodigoAmistad,
  generarCodigoAmistad,
  normalizarCodigoAmistad,
} from './amistades-core.js';

const puedeBuscar = crearLimitador(MAX_BUSQUEDAS_POR_MINUTO);

const NO_ENCONTRADA = 'No hemos encontrado a esa persona.';

/// Personas con las que hay un bloqueo en cualquier sentido: ni se ven en
/// búsquedas ni pueden enviarse solicitudes.
async function bloqueadasConmigo(userId: string): Promise<Set<string>> {
  const filas = await prisma.userBlock.findMany({
    where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
    select: { blockerId: true, blockedId: true },
  });
  return new Set(filas.map((f) => (f.blockerId === userId ? f.blockedId : f.blockerId)));
}

/// Personas con las que ya compartes algún club de verdad (los de tipo SOCIAL; el espacio
/// personal y las lecturas entre dos no cuentan): id de la persona → nombre de un club en común.
export async function clubesEnComun(userId: string): Promise<Map<string, string>> {
  const mios = await prisma.clubMember.findMany({
    where: { userId, club: { tipo: ClubType.SOCIAL } },
    select: { clubId: true },
  });
  if (mios.length === 0) return new Map();
  const otras = await prisma.clubMember.findMany({
    where: { clubId: { in: mios.map((m) => m.clubId) }, userId: { not: userId } },
    select: { userId: true, club: { select: { name: true } } },
    orderBy: { clubId: 'asc' },
  });
  const mapa = new Map<string, string>();
  for (const o of otras) if (!mapa.has(o.userId)) mapa.set(o.userId, o.club.name);
  return mapa;
}

export async function asegurarCodigoAmistad(userId: string): Promise<string> {
  const actual = await prisma.user.findUnique({
    where: { id: userId },
    select: { friendCode: true },
  });
  if (actual?.friendCode) return actual.friendCode;
  for (let intento = 0; intento < 6; intento++) {
    const codigo = generarCodigoAmistad();
    try {
      const { friendCode } = await prisma.user.update({
        where: { id: userId },
        data: { friendCode: codigo },
        select: { friendCode: true },
      });
      return friendCode!;
    } catch (error) {
      // Código repetido (muy improbable): se prueba con otro.
      if ((error as { code?: string }).code !== 'P2002') throw error;
    }
  }
  throw new Error('No se ha podido crear tu código de amistad');
}

export async function getAmistades(userId: string) {
  const [filas, bloqueadas, codigo, privacidad, enComun] = await Promise.all([
    prisma.friendship.findMany({
      where: { OR: [{ requesterId: userId }, { addresseeId: userId }] },
      include: {
        requester: { select: { id: true, name: true, avatarUrl: true } },
        addressee: { select: { id: true, name: true, avatarUrl: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
    bloqueadasConmigo(userId),
    asegurarCodigoAmistad(userId),
    getPrivacidadAmistades(userId),
    clubesEnComun(userId),
  ]);

  const persona = (fila: (typeof filas)[number]) =>
    fila.requesterId === userId ? fila.addressee : fila.requester;
  const visibles = filas.filter((f) => !bloqueadas.has(persona(f).id));
  const dato = (fila: (typeof filas)[number]) => ({
    nombre: persona(fila).name,
    avatarUrl: persona(fila).avatarUrl ?? '',
    fecha: (fila.respondedAt ?? fila.createdAt).toISOString(),
    clubEnComun: enComun.get(persona(fila).id) ?? '',
  });

  return {
    ok: true,
    miCodigo: formatearCodigoAmistad(codigo),
    privacidad,
    amistades: visibles
      .filter((f) => f.status === FriendshipStatus.ACCEPTED)
      .map(dato)
      // Primero quienes no son de tu club (con ellas es con quien más aporta ser amistad).
      .sort(
        (a, b) =>
          Number(Boolean(a.clubEnComun)) - Number(Boolean(b.clubEnComun)) ||
          a.nombre.localeCompare(b.nombre, 'es'),
      ),
    recibidas: visibles
      .filter((f) => f.status === FriendshipStatus.PENDING && f.addresseeId === userId)
      .map(dato),
    enviadas: visibles
      .filter((f) => f.status === FriendshipStatus.PENDING && f.requesterId === userId)
      .map(dato),
  };
}

/// Búsqueda por nombre. Solo salen personas con el perfil público (las que ya
/// enseñan nombre y foto a toda la comunidad), mínimo 3 letras y con límite de
/// resultados y de búsquedas por minuto, para que no sirva para rastrear gente.
export async function buscarPersonas(userId: string, consulta: string) {
  const texto = String(consulta ?? '').trim().slice(0, 40);
  if (texto.length < MIN_LETRAS_BUSQUEDA) {
    return { ok: false, mensaje: `Escribe al menos ${MIN_LETRAS_BUSQUEDA} letras.` };
  }
  if (!puedeBuscar(userId)) {
    return { ok: false, mensaje: 'Estás buscando muy rápido. Espera un momento.' };
  }

  const bloqueadas = await bloqueadasConmigo(userId);
  const candidatas = await prisma.user.findMany({
    where: {
      id: { not: userId, notIn: [...bloqueadas] },
      name: { contains: texto, mode: 'insensitive' },
      profileVisibility: ProfileVisibility.PUBLICO,
    },
    select: { id: true, name: true, avatarUrl: true },
    take: 40,
  });

  const minuscula = texto.toLowerCase();
  const ordenadas = candidatas
    .sort((a, b) => {
      const aEmpieza = a.name.toLowerCase().startsWith(minuscula) ? 0 : 1;
      const bEmpieza = b.name.toLowerCase().startsWith(minuscula) ? 0 : 1;
      return aEmpieza - bEmpieza || a.name.localeCompare(b.name, 'es');
    })
    .slice(0, MAX_RESULTADOS_BUSQUEDA);

  const enComun = await clubesEnComun(userId);
  const relaciones = ordenadas.length
    ? await prisma.friendship.findMany({
        where: {
          OR: [
            { requesterId: userId, addresseeId: { in: ordenadas.map((p) => p.id) } },
            { addresseeId: userId, requesterId: { in: ordenadas.map((p) => p.id) } },
          ],
        },
        select: { requesterId: true, addresseeId: true, status: true },
      })
    : [];
  const porPersona = new Map(
    relaciones.map((r) => [r.requesterId === userId ? r.addresseeId : r.requesterId, r]),
  );

  return {
    ok: true,
    personas: ordenadas.map((p) => ({
      nombre: p.name,
      avatarUrl: p.avatarUrl ?? '',
      estado: estadoDeAmistad(userId, porPersona.get(p.id)),
      clubEnComun: enComun.get(p.id) ?? '',
    })),
  };
}

/// Envía una solicitud (por nombre o por código). Si la otra persona ya te
/// la había enviado a ti, se acepta directamente.
export async function solicitarAmistad(
  userId: string,
  entrada: { nombre?: string; codigo?: string },
) {
  const yo = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true },
  });
  if (!yo) return { ok: false, mensaje: 'Usuaria no encontrada' };

  const codigo = entrada.codigo?.trim() ? normalizarCodigoAmistad(entrada.codigo) : null;
  if (entrada.codigo?.trim() && !codigo) {
    return { ok: false, mensaje: 'Ese código no es válido. Tiene 8 letras y números.' };
  }

  const destino = codigo
    ? await prisma.user.findUnique({
        where: { friendCode: codigo },
        select: { id: true, name: true },
      })
    : entrada.nombre?.trim()
      ? await prisma.user.findFirst({
          where: {
            name: { equals: entrada.nombre.trim(), mode: 'insensitive' },
            profileVisibility: ProfileVisibility.PUBLICO,
          },
          select: { id: true, name: true },
        })
      : null;

  if (!destino) return { ok: false, mensaje: NO_ENCONTRADA };
  if (destino.id === userId) return { ok: false, mensaje: 'Ese código o nombre eres tú 🙂' };
  if ((await bloqueadasConmigo(userId)).has(destino.id)) {
    return { ok: false, mensaje: NO_ENCONTRADA };
  }

  const existente = await prisma.friendship.findFirst({
    where: {
      OR: [
        { requesterId: userId, addresseeId: destino.id },
        { requesterId: destino.id, addresseeId: userId },
      ],
    },
  });
  if (existente?.status === FriendshipStatus.ACCEPTED) {
    return { ok: true, estado: 'AMIGA', nombre: destino.name, mensaje: 'Ya sois amigos.' };
  }
  if (existente && existente.requesterId === userId) {
    return { ok: true, estado: 'ENVIADA', nombre: destino.name, mensaje: 'La solicitud ya estaba enviada.' };
  }
  if (existente) {
    // La otra persona ya te había invitado: se acepta.
    await prisma.friendship.update({
      where: { id: existente.id },
      data: { status: FriendshipStatus.ACCEPTED, respondedAt: new Date() },
    });
    void notifyAmistadAceptada({ aUserId: destino.id, deNombre: yo.name, deUserId: yo.id }).catch(
      backgroundError('friendship_accept_notify_failed'),
    );
    return { ok: true, estado: 'AMIGA', nombre: destino.name, aceptada: true, mensaje: '¡Ya sois amigos! 🎉' };
  }

  const hace24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [pendientes, deHoy] = await Promise.all([
    prisma.friendship.count({ where: { requesterId: userId, status: FriendshipStatus.PENDING } }),
    prisma.friendship.count({ where: { requesterId: userId, createdAt: { gte: hace24h } } }),
  ]);
  if (pendientes >= MAX_SOLICITUDES_PENDIENTES) {
    return { ok: false, mensaje: 'Tienes muchas solicitudes pendientes. Espera a que respondan o cancela alguna.' };
  }
  if (deHoy >= MAX_SOLICITUDES_POR_DIA) {
    return { ok: false, mensaje: 'Has enviado muchas solicitudes hoy. Prueba mañana.' };
  }

  await prisma.friendship.create({
    data: { requesterId: userId, addresseeId: destino.id },
  });
  void notifyAmistadSolicitud({ aUserId: destino.id, deNombre: yo.name, deUserId: yo.id }).catch(
    backgroundError('friendship_request_notify_failed'),
  );
  return { ok: true, estado: 'ENVIADA', nombre: destino.name, mensaje: 'Solicitud enviada.' };
}

export async function responderAmistad(userId: string, nombre: string, aceptar: boolean) {
  const fila = await prisma.friendship.findFirst({
    where: {
      addresseeId: userId,
      status: FriendshipStatus.PENDING,
      requester: { name: { equals: String(nombre ?? '').trim(), mode: 'insensitive' } },
    },
    include: {
      requester: { select: { id: true, name: true } },
      addressee: { select: { id: true, name: true } },
    },
  });
  if (!fila) return { ok: false, mensaje: 'Esa solicitud ya no existe.' };

  if (!aceptar) {
    // Se descarta sin avisar a quien la envió.
    await prisma.friendship.delete({ where: { id: fila.id } });
    return { ok: true, estado: 'NINGUNA' };
  }
  await prisma.friendship.update({
    where: { id: fila.id },
    data: { status: FriendshipStatus.ACCEPTED, respondedAt: new Date() },
  });
  void notifyAmistadAceptada({
    aUserId: fila.requester.id,
    deNombre: fila.addressee.name,
    deUserId: fila.addressee.id,
  }).catch(backgroundError('friendship_accept_notify_failed'));
  return { ok: true, estado: 'AMIGA', nombre: fila.requester.name };
}

export async function cancelarSolicitudAmistad(userId: string, nombre: string) {
  const { count } = await prisma.friendship.deleteMany({
    where: {
      requesterId: userId,
      status: FriendshipStatus.PENDING,
      addressee: { name: { equals: String(nombre ?? '').trim(), mode: 'insensitive' } },
    },
  });
  return count > 0 ? { ok: true } : { ok: false, mensaje: 'Esa solicitud ya no existe.' };
}

export async function quitarAmistad(userId: string, nombre: string) {
  const objetivo = String(nombre ?? '').trim();
  const { count } = await prisma.friendship.deleteMany({
    where: {
      status: FriendshipStatus.ACCEPTED,
      OR: [
        { requesterId: userId, addressee: { name: { equals: objetivo, mode: 'insensitive' } } },
        { addresseeId: userId, requester: { name: { equals: objetivo, mode: 'insensitive' } } },
      ],
    },
  });
  return count > 0 ? { ok: true } : { ok: false, mensaje: 'No sois amistades.' };
}

/// ¿Son amistades estas dos personas? (para las comprobaciones de visibilidad)
export async function sonAmistades(a: string, b: string) {
  const fila = await prisma.friendship.findFirst({
    where: {
      status: FriendshipStatus.ACCEPTED,
      OR: [
        { requesterId: a, addresseeId: b },
        { requesterId: b, addresseeId: a },
      ],
    },
    select: { id: true },
  });
  return Boolean(fila);
}
