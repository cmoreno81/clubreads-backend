import { ProfileVisibility, ReadingFormat, ReadingStatus } from '@prisma/client';

import { prisma } from '../prisma.js';
import { getCurrentClubContext } from './club-context.service.js';

type FilaPila = {
  ownedAt: Date | null;
  /// Cuándo dejó de ser pendiente (empezó, terminó…); null si sigue pendiente.
  salioEn: Date | null;
};

const MESES_SERIE = 12;

/// Libros "ya los tengo y aún no los he leído" al final de cada mes, de los
/// últimos [MESES_SERIE]. Solo cuenta desde que se guarda la fecha: antes de
/// que haya datos la serie sale a cero.
export function pilaPorMes(filas: FilaPila[], ahora = new Date()) {
  const puntos: { mes: string; pila: number }[] = [];
  for (let i = MESES_SERIE - 1; i >= 0; i--) {
    const finDeMes = new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth() - i + 1, 1));
    const corte = i === 0 ? ahora : new Date(finDeMes.getTime() - 1);
    const pila = filas.filter(
      (f) => f.ownedAt && f.ownedAt <= corte && !(f.salioEn && f.salioEn <= corte),
    ).length;
    puntos.push({ mes: corte.toISOString().slice(0, 7), pila });
  }
  return puntos;
}

/// "Estantería de pendientes": de los libros pendientes de [usuario], los que
/// ya tiene. Cuenta como físico lo que está en papel o sin formato; ebook y
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
    where: { userId: user.id, OR: [{ owned: true }, { status: ReadingStatus.PENDING }] },
    select: {
      bookId: true,
      status: true,
      owned: true,
      ownedAt: true,
      readingFormat: true,
      startedAt: true,
      finishedAt: true,
      updatedAt: true,
      book: { select: { title: true, coverUrl: true } },
    },
  });

  const pendientes = filas.filter((f) => f.status === ReadingStatus.PENDING);
  const tengo = pendientes.filter((f) => f.owned);
  const esFisico = (f: { readingFormat: ReadingFormat | null }) =>
    f.readingFormat === null || f.readingFormat === ReadingFormat.PHYSICAL;
  const enEstanteria = tengo
    .filter(esFisico)
    .sort((a, b) => (b.ownedAt?.getTime() ?? 0) - (a.ownedAt?.getTime() ?? 0));

  return {
    ok: true,
    propia,
    pendientes: pendientes.length,
    tengo: tengo.length,
    enEstanteria: enEstanteria.length,
    otrosFormatos: tengo.length - enEstanteria.length,
    libros: enEstanteria.slice(0, 30).map((f) => ({
      bookId: f.bookId,
      titulo: f.book.title,
      portada: f.book.coverUrl,
    })),
    serie: pilaPorMes(
      filas
        .filter((f) => f.owned)
        .map((f) => ({
          ownedAt: f.ownedAt,
          salioEn:
            f.status === ReadingStatus.PENDING
              ? null
              : (f.startedAt ?? f.finishedAt ?? f.updatedAt),
        })),
    ),
  };
}
