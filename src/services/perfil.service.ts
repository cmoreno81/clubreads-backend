import { ReadingStatus } from '@prisma/client';
import { prisma } from '../prisma.js';

function ratingToFlutter(rating?: number | null) {
  if (rating === 0) return '😞';
  if (!rating) return '';
  return '⭐'.repeat(rating);
}

function fechaToFlutter(fecha?: Date | null) {
  if (!fecha) return '';

  return fecha.toLocaleDateString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export async function getPerfilUsuario(usuario: string) {
  const user = await prisma.user.findUnique({
    where: { name: usuario.trim() },
  });

  if (!user) {
    return { ok: false, mensaje: 'Usuaria no encontrada' };
  }

  const biblioteca = await prisma.library.findMany({
    where: { userId: user.id },
    include: {
      book: {
        include: {
          genre: true,
          reviews: true,
        },
      },
    },
    orderBy: {
      updatedAt: 'desc',
    },
  });

  const comentarios = await prisma.comment.findMany({
    where: {
      userId: user.id,
      deletedAt: null,
    },
    include: {
      likes: true,
    },
  });

  const likesRecibidos = comentarios.reduce(
    (total, comentario) => total + comentario.likes.length,
    0,
  );

  const terminados = biblioteca
    .filter((item) => item.status === ReadingStatus.FINISHED)
    .map((item) => {
      const review = item.book.reviews.find((r) => r.userId === user.id);

      return {
        libro: item.book.title,
        genero: item.book.genre.name,
        fecha: fechaToFlutter(item.finishedAt),
        valoracion: ratingToFlutter(review?.rating),
        resena: review?.review ?? '',
      };
    });

  const abandonados = biblioteca
    .filter((item) => {
      const review = item.book.reviews.find((r) => r.userId === user.id);
      return item.status === ReadingStatus.ABANDONED || review?.rating === 0;
    })
    .map((item) => ({
      libro: item.book.title,
      genero: item.book.genre.name,
      fecha: fechaToFlutter(item.finishedAt),
      valoracion: '😞',
    }));

  const leyendo = biblioteca
    .filter((item) => item.status === ReadingStatus.READING)
    .map((item) => ({
      libro: item.book.title,
      genero: item.book.genre.name,
    }));

  const pendientes = biblioteca
    .filter((item) => item.status === ReadingStatus.PENDING)
    .map((item) => ({
      libro: item.book.title,
      genero: item.book.genre.name,
    }));

  const ratings = terminados
    .map((item) => item.valoracion.length)
    .filter((rating) => rating > 0);

  const media =
    ratings.length === 0
      ? 0
      : Number(
          (
            ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length
          ).toFixed(2),
        );

  const generos = new Map<string, number>();

  for (const item of terminados) {
    generos.set(item.genero, (generos.get(item.genero) ?? 0) + 1);
  }

  const generosFavoritos = Array.from(generos.entries())
    .map(([genero, total]) => ({ genero, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);

  return {
    ok: true,
    usuario: user.name,
    email: user.email,
    resumen: {
      terminados: terminados.length,
      leyendo: leyendo.length,
      pendientes: pendientes.length,
      abandonados: abandonados.length,
      media,
      comentarios: comentarios.length,
      likesRecibidos,
    },
    leyendo,
    terminados,
    abandonados,
    pendientes,
    generosFavoritos,
  };
}