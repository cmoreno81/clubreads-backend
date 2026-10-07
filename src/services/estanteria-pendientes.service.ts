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
      readingFormat: true,
      startedAt: true,
      finishedAt: true,
      updatedAt: true,
    },
  });

  const pendientes = filas.filter((f) => f.status === ReadingStatus.PENDING);
  const tengo = pendientes.filter((f) => f.owned);
  const esFisico = (f: { readingFormat: ReadingFormat | null }) =>
    f.readingFormat === null || f.readingFormat === ReadingFormat.PHYSICAL;
  const enEstanteria = tengo.filter(esFisico);

  return {
    ok: true,
    propia,
    pendientes: pendientes.length,
    tengo: tengo.length,
    enEstanteria: enEstanteria.length,
    otrosFormatos: tengo.length - enEstanteria.length,
    serie: pilaPorMes(
      filas.map((f) => ({
        entro: f.createdAt,
        salioEn:
          f.status === ReadingStatus.PENDING
            ? null
            : (f.startedAt ?? f.finishedAt ?? f.updatedAt),
      })),
    ),
  };
}
