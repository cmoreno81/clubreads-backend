import { prisma } from '../prisma.js';
import { getCurrentClubContext } from './club-context.service.js';

function top<T>(items: T[], limit = 5) {
  return items.slice(0, limit);
}

export async function getTendenciasClub(usuario = '') {
  const { club } = await getCurrentClubContext(usuario);
  const leyendoAhora = await prisma.library.findMany({
    where: {
      status: { in: ['READING', 'REREADING'] },
      user: { clubMemberships: { some: { clubId: club.id } } },
    },
    include: {
      user: true,
      book: {
        include: {
          genre: true,
        },
      },
    },
    orderBy: {
      updatedAt: 'desc',
    },
  });

  const generos = new Map<string, number>();
  const libros = new Map<
    string,
    {
      id: string;
      nombre: string;
      total: number;
      coverUrl: string;
    }
  >();
  const lectores = new Map<
    string,
    {
      id: string;
      nombre: string;
      total: number;
      avatarUrl: string;
    }
  >();

  for (const item of leyendoAhora) {
    const genero = item.book.genre?.name ?? 'Sin género';
    const libro = libros.get(item.book.id);
    const lector = lectores.get(item.user.id);

    generos.set(genero, (generos.get(genero) ?? 0) + 1);
    libros.set(item.book.id, {
      id: item.book.id,
      nombre: item.book.title,
      total: (libro?.total ?? 0) + 1,
      coverUrl: item.book.coverUrl ?? '',
    });
    lectores.set(item.user.id, {
      id: item.user.id,
      nombre: item.user.name,
      total: (lector?.total ?? 0) + 1,
      avatarUrl: item.user.avatarUrl ?? '',
    });
  }

  const generosTop = top(
    Array.from(generos.entries())
      .map(([nombre, total]) => ({ nombre, total }))
      .sort((a, b) => b.total - a.total),
  );

  const librosTop = top(
    Array.from(libros.values())
      .sort((a, b) => b.total - a.total),
  );

  const lectoresTop = top(
    Array.from(lectores.values())
      .sort((a, b) => b.total - a.total),
  );

  const generoPrincipal = generosTop[0];

  const titular = generoPrincipal
    ? `${generoPrincipal.nombre} domina las lecturas actuales del club.`
    : 'El club está repartido entre varias lecturas.';

  const narrador = generoPrincipal
    ? `Ahora mismo ${generoPrincipal.total} ${generoPrincipal.total === 1 ? 'persona está' : 'personas están'} leyendo ${generoPrincipal.nombre}. Parece que este género está marcando el ritmo del club.`
    : 'No hay una tendencia clara todavía. El club está explorando lecturas distintas.';

  return {
    titular,
    narrador,
    generos: generosTop,
    libros: librosTop,
    lectoras: lectoresTop,
    totalLeyendo: leyendoAhora.length,
  };
}
