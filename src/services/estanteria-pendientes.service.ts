import { ProfileVisibility, ReadingFormat, ReadingStatus } from '@prisma/client';

import { prisma } from '../prisma.js';
import { getCurrentClubContext } from './club-context.service.js';

type FilaPila = {
  /// Cuándo entró en la biblioteca (y en la pila de pendientes).
  entro: Date | null;
  /// Cuándo dejó de ser pendiente (empezó, terminó…); null si sigue pendiente.
  salioEn: Date | null;
};

const MESES_SERIE = 12;

type FilaAnio = FilaPila & {
  enPendiente: boolean;
  owned: boolean;
  /// Papel o sin formato: los ebooks y audiolibros no ocupan estantería.
  fisico: boolean;
  /// La salida viene del trigger (exacta), no de una fecha de lectura.
  exacta?: boolean;
};

const UNA_HORA = 60 * 60 * 1000;

/// Un libro pasó de verdad por la pila si sigue pendiente o si empezó bastante
/// después de añadirse (los que se añaden ya empezados o terminados no cuentan).
function pasoPorLaPila(f: FilaAnio) {
  if (f.enPendiente || f.exacta) return true;
  return Boolean(f.entro && f.salioEn && f.salioEn.getTime() - f.entro.getTime() > UNA_HORA);
}

/// Balance del año, solo de libros en papel: pendientes que se han empezado o leído, los que han
/// entrado nuevos y, de los que salieron, cuántos ya estaban en casa.
export function balanceAnual(filas: FilaAnio[], ahora = new Date()) {
  const anio = ahora.getUTCFullYear();
  const delAnio = (d: Date | null) => Boolean(d && d.getUTCFullYear() === anio);
  const pasaron = filas.filter((f) => f.fisico && pasoPorLaPila(f));
  const leidos = pasaron.filter((f) => !f.enPendiente && delAnio(f.salioEn));
  return {
    anio,
    leidos: leidos.length,
    leidosEnCasa: leidos.filter((f) => f.owned).length,
    entraron: pasaron.filter((f) => delAnio(f.entro)).length,
  };
}

/// Pendientes al final de cada mes, de los últimos [MESES_SERIE]: los libros
/// que ya estaban en la biblioteca y todavía no se habían empezado.
export function pilaPorMes(filas: FilaPila[], ahora = new Date()) {
  const puntos: { mes: string; pila: number }[] = [];
  for (let i = MESES_SERIE - 1; i >= 0; i--) {
    const finDeMes = new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth() - i + 1, 1));
    const corte = i === 0 ? ahora : new Date(finDeMes.getTime() - 1);
    const pila = filas.filter(
      (f) => f.entro && f.entro <= corte && !(f.salioEn && f.salioEn <= corte),
    ).length;
    puntos.push({ mes: corte.toISOString().slice(0, 7), pila });
  }
  return puntos;
}

/// "Pila de pendientes": de los libros pendientes de [usuario], los que ya
/// tiene y cómo evoluciona el total mes a mes. Cuenta como físico lo que está en papel o sin formato; ebook y
/// audiolibro se suman aparte. Lo ve la propia lectora y las de su club,
/// salvo perfil "Solo yo".
export async function getEstanteriaPendientes(usuario: string, solicitante: string) {
  const nombre = usuario.trim();
  if (!nombre) return { ok: false, mensaje: 'Usuaria requerida.' };
  let propia = nombre === solicitante.trim();
  const club = propia ? null : (await getCurrentClubContext(solicitante)).club;
  let user = await prisma.user.findFirst({
    where: {
      name: nombre,
      ...(club ? { clubMemberships: { some: { clubId: club.id } } } : {}),
    },
    select: { id: true, profileVisibility: true },
  });
  if (!user && !propia && solicitante.trim()) {
    const yo = await prisma.user.findUnique({
      where: { name: solicitante.trim() },
      select: { id: true, profileVisibility: true },
    });
    if (yo) {
      user = yo;
      propia = true;
    }
  }
  if (!user) return { ok: false, mensaje: 'Usuaria no encontrada.' };
  if (!propia && user.profileVisibility === ProfileVisibility.PRIVADO) {
    return { ok: false, privado: true };
  }

  const filas = await prisma.library.findMany({
    where: { userId: user.id },
    select: {
      bookId: true,
      status: true,
      owned: true,
      ownedAt: true,
      createdAt: true,
      leftPendingAt: true,
      readingFormat: true,
      startedAt: true,
      finishedAt: true,
      updatedAt: true,
    },
  });

  const esFisico = (f: { readingFormat: ReadingFormat | null }) =>
    f.readingFormat === null || f.readingFormat === ReadingFormat.PHYSICAL;
  // La fecha exacta del trigger si existe; en filas antiguas, la de empezar.
  const salida = (f: (typeof filas)[number]) =>
    f.status === ReadingStatus.PENDING
      ? null
      : (f.leftPendingAt ?? f.startedAt ?? f.finishedAt ?? f.updatedAt);
  const inicioAnio = new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1));
  const terminados = await prisma.readingCompletion.findMany({
    where: { userId: user.id, finishedAt: { gte: inicioAnio } },
    select: { readingFormat: true },
  });
  const terminadosPapel = terminados.filter(esFisico).length;
  const pendientes = filas.filter((f) => f.status === ReadingStatus.PENDING);
  const tengo = pendientes.filter((f) => f.owned);
  const enEstanteria = tengo.filter(esFisico);

  return {
    ok: true,
    propia,
    pendientes: pendientes.length,
    tengo: tengo.length,
    enEstanteria: enEstanteria.length,
    otrosFormatos: tengo.length - enEstanteria.length,
    terminadosPapel,
    anio: balanceAnual(
      filas.map((f) => ({
        entro: f.createdAt,
        salioEn: salida(f),
        enPendiente: f.status === ReadingStatus.PENDING,
        owned: f.owned,
        fisico: esFisico(f),
        exacta: f.leftPendingAt !== null,
      })),
    ),
    serie: pilaPorMes(filas.map((f) => ({ entro: f.createdAt, salioEn: salida(f) }))),
  };
}
