import { ReadingStatus } from '@prisma/client';

import { prisma } from '../prisma.js';
import { backgroundError } from '../logging/logger.js';
import {
  ratingFromFlutter,
  ratingToFlutter,
} from '../utils/rating.utils.js';
import {
  subirAvatarDesdeBase64,
  subirAvatarDesdeUrl,
} from './cloudinary.service.js';
import { getCurrentClubContext } from './club-context.service.js';
import { formatToFlutter } from './books.service.js';
import { canonicalBookTitle } from './catalog.service.js';
// Añadir import al inicio de perfil.service.ts:
import { getUserSeriesOrders } from './user-series-order.service.js';
import {
  descendingCursorFilter,
  pageFromRows,
  type PaginationRequest,
} from '../utils/cursor-pagination.js';
function fechaToFlutter(fecha?: Date | null) {
  if (!fecha) return '';

  return fecha.toLocaleDateString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Europe/Madrid',
  });
}

function parseFecha(
  valor: unknown,
  campo: string,
): Date | null {
  const texto = String(valor ?? '').trim();

  if (!texto) {
    return null;
  }

  /*
   * Flutter enviará las fechas en formato yyyy-MM-dd.
   * Usamos mediodía UTC para evitar cambios de día por zona horaria.
   */
  const coincidencia = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);

  if (!coincidencia) {
    throw new Error(`${campo} no tiene un formato válido`);
  }

  const anio = Number(coincidencia[1]);
  const mes = Number(coincidencia[2]);
  const dia = Number(coincidencia[3]);

  const fecha = new Date(
    Date.UTC(anio, mes - 1, dia, 12, 0, 0),
  );

  if (
    fecha.getUTCFullYear() !== anio ||
    fecha.getUTCMonth() !== mes - 1 ||
    fecha.getUTCDate() !== dia
  ) {
    throw new Error(`${campo} no es una fecha válida`);
  }

  return fecha;
}

export async function getPerfilUsuario(
  usuario: string,
  solicitante = usuario,
) {
  const nombre = usuario.trim();

  if (!nombre) {
    return {
      ok: false,
      mensaje: 'Falta el nombre de la usuaria',
    };
  }

  const ownProfile = nombre === solicitante.trim();
  const club = ownProfile
    ? null
    : (await getCurrentClubContext(solicitante)).club;
  const user = await prisma.user.findFirst({
    where: {
      name: nombre,
      ...(club
        ? { clubMemberships: { some: { clubId: club.id } } }
        : {}),
    },
    include: {
      _count: {
        select: { clubMemberships: true },
      },
    },
  });

  if (!user) {
    return {
      ok: false,
      mensaje: 'Usuaria no encontrada',
    };
  }

  const biblioteca = await prisma.library.findMany({
    where: {
      userId: user.id,
    },
    include: {
      book: {
        include: {
          author: true,
          genre: true,
          series: {
            include: {
              books: {
                where: { deletedAt: null },
                include: { author: true },
              },
            },
          },
          reviews: {
            where: {
              userId: user.id,
              deletedAt: null,
            },
          },
        },
      },
    },
    orderBy: [
      {
        finishedAt: 'desc',
      },
      {
        updatedAt: 'desc',
      },
    ],
  });

  const historialTerminados = await prisma.readingCompletion.findMany({
    where: { userId: user.id },
    include: {
      book: { include: { genre: true } },
    },
    orderBy: { finishedAt: 'desc' },
  });

  const bibliotecaPorLibro = new Map(
    biblioteca.map((item) => [item.bookId, item]),
  );

  const esAbandonado = (
  item: (typeof biblioteca)[number],
) => {
  const review = item.book.reviews[0];

  return (
    item.status === ReadingStatus.ABANDONED ||
    review?.rating === 0
  );
};

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

const historialBookIds = new Set(
  historialTerminados.map((item) => item.bookId),
);
const terminados = [
  ...historialTerminados.map((item) => ({
  completionId: item.id,
  libraryId: bibliotecaPorLibro.get(item.bookId)?.id ?? '',
  bookId: item.bookId,
  libro: item.book.title,
  genero: item.book.genre.name,
  fechaInicio: fechaToFlutter(item.startedAt),
  fechaFin: fechaToFlutter(item.finishedAt),
  valoracion: ratingToFlutter(item.rating),
  resena: item.review ?? '',
  formato: formatToFlutter(item.readingFormat),
  coverUrl: item.book.coverUrl ?? '',
  esRelectura: item.isReread,
  })),
  ...biblioteca
    .filter(
      (item) =>
        item.status === ReadingStatus.FINISHED &&
        !historialBookIds.has(item.bookId),
    )
    .map((item) => {
      const review = item.book.reviews[0];
      return {
        completionId: '',
        libraryId: item.id,
        bookId: item.bookId,
        libro: item.book.title,
        genero: item.book.genre.name,
        fechaInicio: fechaToFlutter(item.startedAt),
        fechaFin: '',
        valoracion: ratingToFlutter(review?.rating),
        resena: review?.review ?? '',
        formato: formatToFlutter(item.readingFormat),
        coverUrl: item.book.coverUrl ?? '',
        esRelectura: false,
      };
    }),
];

const abandonados = biblioteca
  .filter(
    (item) => item.status === ReadingStatus.ABANDONED,
  )
  .map((item) => {
    const review = item.book.reviews[0];

    return {
      libraryId: item.id,
      bookId: item.bookId,
      libro: item.book.title,
      genero: item.book.genre.name,
      fechaInicio: fechaToFlutter(item.startedAt),
      fechaFin: fechaToFlutter(item.finishedAt),
      valoracion: ratingToFlutter(review?.rating),
      resena: review?.review ?? '',
      coverUrl: item.book.coverUrl ?? '',
    };
  });

const leyendo = biblioteca
    .filter(
      (item) =>
        item.status === ReadingStatus.READING ||
        item.status === ReadingStatus.REREADING,
    )
  .map((item) => ({
      libraryId: item.id,
      bookId: item.bookId,
      libro: item.book.title,
      genero: item.book.genre.name,
      fechaInicio: fechaToFlutter(item.startedAt),
    coverUrl: item.book.coverUrl ?? '',
    esRelectura: item.status === ReadingStatus.REREADING,
  }));

  const pendientes = biblioteca
    .filter(
      (item) => item.status === ReadingStatus.PENDING,
    )
    .map((item) => ({
      libro: item.book.title,
      genero: item.book.genre.name,
    }));



  /*
   * TypeScript no tiene `.where`, así que calculamos la media
   * de forma explícita.
   */
const ultimaFinalizacionPorLibro = new Map<string, (typeof historialTerminados)[number]>();
for (const item of historialTerminados) {
  if (!ultimaFinalizacionPorLibro.has(item.bookId)) {
    ultimaFinalizacionPorLibro.set(item.bookId, item);
  }
}

const valoresRating = Array.from(ultimaFinalizacionPorLibro.values())
  .map((item) => item.rating)
  .filter((rating): rating is number => typeof rating === 'number' && rating > 0);

  const media =
    valoresRating.length === 0
      ? 0
      : Number(
          (
            valoresRating.reduce(
              (suma, rating) => suma + rating,
              0,
            ) / valoresRating.length
          ).toFixed(2),
        );

  const generos = new Map<string, number>();

  for (const item of ultimaFinalizacionPorLibro.values()) {
    const genero = item.book.genre.name;
    generos.set(
      genero,
      (generos.get(genero) ?? 0) + 1,
    );
  }

  const generosFavoritos = Array.from(
    generos.entries(),
  )
    .map(([genero, total]) => ({
      genero,
      total,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);

  const finalizadosIds = new Set([
    ...historialTerminados.map((item) => item.bookId),
    ...biblioteca
      .filter((item) => item.status === ReadingStatus.FINISHED)
      .map((item) => item.bookId),
  ]);
  const bibliotecaPorId = new Map(
    biblioteca.map((item) => [item.bookId, item]),
  );

  const hiddenSeriesIds = new Set(
    (await prisma.hiddenUserSeries.findMany({
      where: { userId: user.id },
      select: { seriesId: true },
    })).map(({ seriesId }) => seriesId),
  );

  // Overrides de tomos (LEIDO_EXTERNO / OMITIDO)
  const overridesRaw = await prisma.seriesBookOverride.findMany({
    where: { userId: user?.id ?? '' },
  });

  // Orden personal por usuario
  const userSeriesOrders = await getUserSeriesOrders(user?.id ?? '');
  // Mapa: seriesId -> Map<posicion, tipo>
  const overridesBySeries = new Map<string, Map<number, string>>();
  for (const o of overridesRaw) {
    if (!overridesBySeries.has(o.seriesId)) {
      overridesBySeries.set(o.seriesId, new Map());
    }
    overridesBySeries.get(o.seriesId)!.set(o.posicion, o.tipo);
  }

  type SeriePersonal = NonNullable<
    (typeof biblioteca)[number]['book']['series']
  >;
  const seriesPersonales = new Map<string, SeriePersonal>();

  for (const item of biblioteca) {
    if (item.book.series && !hiddenSeriesIds.has(item.book.series.id)) {
      const key = canonicalBookTitle(item.book.series.name);
      const current = seriesPersonales.get(key);
      if (!current) {
        seriesPersonales.set(key, {
          ...item.book.series,
          books: [...item.book.series.books],
        });
        continue;
      }

      const books = new Map(current.books.map((book) => [book.id, book]));
      for (const book of item.book.series.books) {
        books.set(book.id, book);
      }
      seriesPersonales.set(key, {
        ...current,
        publicationStatus:
          current.publicationStatus === 'COMPLETED' ||
          item.book.series.publicationStatus === 'COMPLETED'
            ? 'COMPLETED'
            : current.publicationStatus === 'ONGOING' ||
                item.book.series.publicationStatus === 'ONGOING'
              ? 'ONGOING'
              : 'UNKNOWN',
        totalBooks: Math.max(
          current.totalBooks ?? 0,
          item.book.series.totalBooks ?? 0,
        ) || null,
        books: [...books.values()],
      });
    }
  }

  const numeroSaga = (value: string | null) => {
    const parsed = Number.parseFloat(value?.replace(',', '.') ?? '');
    return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
  };
  const datosNumeroSaga = (value: string | null) => {
    const text = value?.trim() ?? '';
    const fraction = /^(\d+)\s*(?:\/|de)\s*(\d+)$/i.exec(text);
    if (fraction) {
      return {
        posicion: Number(fraction[1]),
        total: Number(fraction[2]),
      };
    }
    const parsed = numeroSaga(value);
    return {
      posicion:
        parsed === Number.MAX_SAFE_INTEGER ? null : Math.ceil(parsed),
      total: null,
    };
  };

  const sagas = [...seriesPersonales.values()]
    .map((series) => {
      const preferredBooks = new Map<
        string,
        (typeof series.books)[number]
      >();
      for (const book of series.books) {
        const key = `${canonicalBookTitle(book.title)}:${book.author?.name
          .trim()
          .toLocaleLowerCase('es') ?? ''}`;
        const current = preferredBooks.get(key);
        if (
          !current ||
          (bibliotecaPorId.has(book.id) && !bibliotecaPorId.has(current.id)) ||
          (!current.coverUrl && Boolean(book.coverUrl))
        ) {
          preferredBooks.set(key, book);
        }
      }
      const booksByPosition = new Map<
        string,
        (typeof series.books)[number]
      >();
      for (const book of preferredBooks.values()) {
        const position = datosNumeroSaga(book.seriesOrder).posicion;
        const key = position == null ? `book:${book.id}` : `position:${position}`;
        const current = booksByPosition.get(key);
        if (
          !current ||
          (bibliotecaPorId.has(book.id) && !bibliotecaPorId.has(current.id)) ||
          (!current.coverUrl && Boolean(book.coverUrl))
        ) {
          booksByPosition.set(key, book);
        }
      }
      const books = [...booksByPosition.values()].sort((left, right) => {
        const byOrder =
          numeroSaga(left.seriesOrder) - numeroSaga(right.seriesOrder);
        return byOrder !== 0
          ? byOrder
          : left.title.localeCompare(right.title, 'es');
      });
      const volumes = books.map((book) => {
        const library = bibliotecaPorId.get(book.id);
        // Posición: primero miramos si el usuario tiene un orden personal
        const userOrderForSeries = userSeriesOrders.get(series.id);
        const userPositionOverride = userOrderForSeries?.get(book.id);
        const posicionNumBase = datosNumeroSaga(book.seriesOrder).posicion;
        const posicionNum = userPositionOverride ?? posicionNumBase;
        const override = posicionNum != null
          ? overridesBySeries.get(series.id)?.get(posicionNum)
          : undefined;
        const status = finalizadosIds.has(book.id)
          ? 'LEIDO'
          : override === 'LEIDO_EXTERNO'
            ? 'LEIDO_EXTERNO'
            : override === 'OMITIDO'
              ? 'OMITIDO'
              : library?.status === ReadingStatus.READING ||
                  library?.status === ReadingStatus.REREADING
                ? 'LEYENDO'
                : library?.status === ReadingStatus.ABANDONED
                  ? 'ABANDONADO'
                  : library
                    ? 'PENDIENTE'
                    : 'NO_ANADIDO';
        return {
          bookId: book.id,
          titulo: book.title,
          numero: book.seriesOrder ?? '',
          posicion: posicionNum, 
          coverUrl: book.coverUrl ?? '',
          estado: status,
        };
      });
      const bookPositions = new Set(
        volumes
          .map(({ posicion }) => posicion)
          .filter((position): position is number => position != null),
      );
      for (const [posicion, tipo] of overridesBySeries.get(series.id) ?? []) {
        if (bookPositions.has(posicion)) continue;
        volumes.push({
          bookId: '',
          titulo: `Tomo ${posicion}`,
          numero: String(posicion),
          posicion,
          coverUrl: '',
          estado: tipo,
        });
      }
      volumes.sort((left, right) =>
        (left.posicion ?? Number.MAX_SAFE_INTEGER) -
        (right.posicion ?? Number.MAX_SAFE_INTEGER)
      );
      const read = volumes.filter(
        ({ estado }) => estado === 'LEIDO' || estado === 'LEIDO_EXTERNO',
      ).length;
      const covered = volumes.filter(
        ({ estado }) =>
          estado === 'LEIDO' ||
          estado === 'LEIDO_EXTERNO' ||
          estado === 'OMITIDO',
      ).length;
      const hasAbandoned = volumes.some(({ estado }) => estado === 'ABANDONADO');
      const highestOrder = books.reduce((highest, book) => {
        const value = numeroSaga(book.seriesOrder);
        return Number.isFinite(value) &&
          value !== Number.MAX_SAFE_INTEGER
          ? Math.max(highest, Math.ceil(value))
          : highest;
      }, 0);
      const declaredInOrders = books.reduce(
        (highest, book) =>
          Math.max(highest, datosNumeroSaga(book.seriesOrder).total ?? 0),
        0,
      );
      const knownTotal = Math.max(
        series.totalBooks ?? 0,
        books.length,
        highestOrder,
        declaredInOrders,
      );
      const knownPositions = new Set(
        volumes
          .map(({ posicion }) => posicion)
          .filter((position): position is number => position != null),
      );
      const requiredPositionLimit =
        series.publicationStatus === 'COMPLETED'
          ? knownTotal
          : highestOrder;
      const hasPreviousGaps = Array.from(
        { length: requiredPositionLimit },
        (_, index) => index + 1,
      ).some((position) => !knownPositions.has(position));
      const allKnownVolumesRead =
        volumes.length > 0 && covered === volumes.length;
      const isComplete =
        series.publicationStatus === 'COMPLETED' &&
        allKnownVolumesRead &&
        !hasPreviousGaps &&
        knownTotal > 0 &&
        volumes.length >= knownTotal &&
        covered >= knownTotal;
      const next =
        volumes.find(
          ({ estado }) =>
            estado !== 'LEIDO' &&
            estado !== 'LEIDO_EXTERNO' &&
            estado !== 'OMITIDO' &&
            estado !== 'LEYENDO',
        ) ?? null;
      const reading =
        volumes.find(({ estado }) => estado === 'LEYENDO') ?? null;
      const hasStarted = read > 0 || reading != null;

      return {
        id: series.id,
        nombre: series.name,
        autor: books.find((book) => book.author)?.author?.name ?? '',
        leidos: read,
        totalConocidos: books.length,
        totalSaga: knownTotal,
        estadoEditorial: series.publicationStatus,
        estado: isComplete
          ? 'COMPLETADA'
          : hasAbandoned && !hasStarted
            ? 'ABANDONADA'
            : hasAbandoned
              ? 'ABANDONADA'
              : !hasStarted
                ? 'PENDIENTE'
                : allKnownVolumesRead && !hasPreviousGaps
                ? 'AL_DIA'
                : 'EN_CURSO',
        volumenes: volumes,
        siguiente: reading ?? next,
      };
    })
    .sort((left, right) => {
      const order: Record<string, number> = {
        EN_CURSO: 0,
        AL_DIA: 1,
        COMPLETADA: 2,
        ABANDONADA: 3,
      };
      const byStatus = order[left.estado] - order[right.estado];
      return byStatus !== 0
        ? byStatus
        : left.nombre.localeCompare(right.nombre, 'es');
    });

  return {
    ok: true,
    usuario: user.name,
    email: user.email,
    avatarUrl: user.avatarUrl ?? '',

    resumen: {
      terminados: finalizadosIds.size,
      relecturas: historialTerminados.filter((item) => item.isReread).length,
      leyendo: leyendo.length,
      pendientes: pendientes.length,
      abandonados: abandonados.length,
      media,
      comentarios: comentarios.length,
      likesRecibidos,
      clubes: user._count.clubMemberships,
      sagasAbiertas: sagas.filter(
        ({ estado }) =>
          estado !== 'PENDIENTE' &&
          estado !== 'COMPLETADA' &&
          estado !== 'ABANDONADA',
      ).length,
    },

    leyendo,
    terminados,
    abandonados,
    pendientes,
    generosFavoritos,
    sagas,
    historicoMeses: buildHistoricoMeses(historialTerminados),
    favoritos: biblioteca
      .filter((item) => item.isFavorite)
      .map((item) => ({
        id: item.book.id,
        title: item.book.title,
        authorName: item.book.author?.name ?? null,
        coverUrl: item.book.coverUrl ?? null,
        genreName: item.book.genre.name,
      })),
  };
}

export async function getPerfilHistorialPage(
  usuario: string,
  solicitante: string,
  pagination: PaginationRequest,
) {
  const nombre = usuario.trim();
  if (!nombre) return { items: [], nextCursor: null, hasMore: false };
  const ownProfile = nombre === solicitante.trim();
  const club = ownProfile
    ? null
    : (await getCurrentClubContext(solicitante)).club;
  const user = await prisma.user.findFirst({
    where: {
      name: nombre,
      ...(club ? { clubMemberships: { some: { clubId: club.id } } } : {}),
    },
    select: { id: true },
  });
  if (!user) return { items: [], nextCursor: null, hasMore: false };

  const rows = await prisma.readingCompletion.findMany({
    where: {
      userId: user.id,
      ...descendingCursorFilter('finishedAt', pagination.cursor),
    },
    select: {
      id: true,
      bookId: true,
      startedAt: true,
      finishedAt: true,
      rating: true,
      review: true,
      readingFormat: true,
      isReread: true,
      book: {
        select: {
          title: true,
          coverUrl: true,
          genre: { select: { name: true } },
        },
      },
    },
    orderBy: [{ finishedAt: 'desc' }, { id: 'desc' }],
    take: pagination.limit + 1,
  });
  const page = pageFromRows(rows, pagination.limit, (item) => ({
    value: item.finishedAt.toISOString(),
    id: item.id,
  }));
  const libraries = await prisma.library.findMany({
    where: {
      userId: user.id,
      bookId: { in: page.items.map(({ bookId }) => bookId) },
    },
    select: { id: true, bookId: true },
  });
  const libraryByBook = new Map(
    libraries.map((library) => [library.bookId, library.id]),
  );
  return {
    ...page,
    items: page.items.map((item) => ({
      completionId: item.id,
      libraryId: libraryByBook.get(item.bookId) ?? '',
      bookId: item.bookId,
      libro: item.book.title,
      genero: item.book.genre.name,
      fechaInicio: fechaToFlutter(item.startedAt),
      fechaFin: fechaToFlutter(item.finishedAt),
      valoracion: ratingToFlutter(item.rating),
      resena: item.review ?? '',
      formato: formatToFlutter(item.readingFormat),
      coverUrl: item.book.coverUrl ?? '',
      esRelectura: item.isReread,
    })),
  };
}

// ─────────────────────────────────────────────
// Histórico de meses lectores
// ─────────────────────────────────────────────

function buildHistoricoMeses(
  historial: Array<{
    id: string;
    bookId: string;
    startedAt: Date | null;
    finishedAt: Date;
    rating: number | null;
    book: { title: string; coverUrl: string | null };
  }>,
) {
  // Agrupa las lecturas por mes (Europe/Madrid)
  const mesesMap = new Map<
    string,
    {
      anio: number;
      mes: number;
      lecturas: Array<{
        id: string;
        bookId: string;
        titulo: string;
        coverUrl: string;
        fechaInicio: string;
        fechaFin: string;
        valoracion: number | null;
      }>;
    }
  >();

  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  for (const item of historial) {
    const parts = fmt.formatToParts(item.finishedAt);
    const v = Object.fromEntries(parts.map((p) => [p.type, p.value]));
    const key = `${v.year}-${v.month}`;
    const anio = Number(v.year);
    const mes  = Number(v.month);

    if (!mesesMap.has(key)) {
      mesesMap.set(key, { anio, mes, lecturas: [] });
    }

    const startParts = item.startedAt
      ? fmt.formatToParts(item.startedAt)
      : null;
    const sv = startParts
      ? Object.fromEntries(startParts.map((p) => [p.type, p.value]))
      : null;

    mesesMap.get(key)!.lecturas.push({
      id: item.id,
      bookId: item.bookId,
      titulo: item.book.title,
      coverUrl: item.book.coverUrl ?? '',
      fechaInicio: sv ? `${sv.day}/${sv.month}/${sv.year}` : '',
      fechaFin: `${v.day}/${v.month}/${v.year}`,
      valoracion: item.rating ?? null,
    });
  }

  // Ordenar de más reciente a más antiguo
  return Array.from(mesesMap.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([, data]) => data);
}

export async function actualizarFechasLectura(params: {
  usuario: string;
  libraryId: string;
  completionId?: string;
  fechaInicio: unknown;
  fechaFin: unknown;
  valoracion?: unknown;
  resena?: unknown;
}) {
  const usuario = params.usuario.trim();
  const libraryId = params.libraryId.trim();
  const completionId = params.completionId?.trim() ?? '';

  if (!usuario) {
    return {
      ok: false,
      mensaje: 'Falta la usuaria',
    };
  }

  if (!libraryId) {
    return {
      ok: false,
      mensaje: 'Falta el identificador de la lectura',
    };
  }

  try {
    const fechaInicio = parseFecha(
      params.fechaInicio,
      'La fecha de inicio',
    );

    const fechaFin = parseFecha(
      params.fechaFin,
      'La fecha de fin',
    );

    if (
      fechaInicio &&
      fechaFin &&
      fechaFin.getTime() < fechaInicio.getTime()
    ) {
      return {
        ok: false,
        mensaje:
          'La fecha de fin no puede ser anterior a la fecha de inicio',
      };
    }

    const user = await prisma.user.findUnique({
      where: {
        name: usuario,
      },
      select: {
        id: true,
      },
    });

    if (!user) {
      return {
        ok: false,
        mensaje: 'Usuaria no encontrada',
      };
    }

    const lectura = await prisma.library.findFirst({
      where: {
        id: libraryId,
        userId: user.id,
      },
      select: {
        id: true,
        bookId: true,
        status: true,
      },
    });

    if (!lectura) {
      return {
        ok: false,
        mensaje: 'Lectura no encontrada',
      };
    }

    const esLecturaActiva =
      lectura.status === ReadingStatus.READING ||
      lectura.status === ReadingStatus.REREADING;

    if (lectura.status !== ReadingStatus.FINISHED && !esLecturaActiva) {
      return {
        ok: false,
        mensaje:
          'Solo se pueden editar lecturas activas o terminadas',
      };
    }

    if (esLecturaActiva && !fechaInicio) {
      return { ok: false, mensaje: 'La fecha de inicio es obligatoria' };
    }

    const finalizacion = esLecturaActiva
      ? null
      : await prisma.readingCompletion.findFirst({
          where: {
            userId: user.id,
            bookId: lectura.bookId,
            ...(completionId ? { id: completionId } : {}),
          },
          orderBy: completionId ? undefined : { finishedAt: 'desc' },
        });

    if (completionId && !finalizacion) {
      return { ok: false, mensaje: 'Finalización no encontrada' };
    }

    const ultimaFinalizacion = !esLecturaActiva
      ? await prisma.readingCompletion.findFirst({
          where: { userId: user.id, bookId: lectura.bookId },
          orderBy: { finishedAt: 'desc' },
          select: { id: true },
        })
      : null;

    const actualizaFichaActual =
      !finalizacion || ultimaFinalizacion?.id === finalizacion.id;

    const valoracionFueEnviada =
      params.valoracion !== undefined;

    const resenaFueEnviada =
      params.resena !== undefined;

    const textoValoracion = valoracionFueEnviada
      ? String(params.valoracion ?? '').trim()
      : '';

    const textoResena = resenaFueEnviada
      ? String(params.resena ?? '').trim()
      : '';

    const rating = valoracionFueEnviada
      ? ratingFromFlutter(textoValoracion)
      : undefined;

    /*
     * Permitimos borrar la valoración enviando una cadena vacía.
     * En ese caso eliminamos la Review si tampoco queda reseña.
     */
    await prisma.$transaction(async (tx) => {
      if (esLecturaActiva || actualizaFichaActual) {
        await tx.library.update({
          where: { id: lectura.id },
          data: {
            startedAt: fechaInicio,
            finishedAt: esLecturaActiva ? null : fechaFin,
          },
        });
      }

      if (esLecturaActiva) return;

      const reviewActual = await tx.review.findUnique({
        where: {
          userId_bookId: {
            userId: user.id,
            bookId: lectura.bookId,
          },
        },
      });

      const ratingFinal = valoracionFueEnviada
        ? rating
        : finalizacion?.rating ?? reviewActual?.rating;

      const resenaFinal = resenaFueEnviada
        ? textoResena || null
        : finalizacion?.review ?? reviewActual?.review ?? null;

      if (finalizacion) {
        if (!fechaFin) {
          throw new Error('La fecha de fin es obligatoria');
        }

        await tx.readingCompletion.update({
          where: { id: finalizacion.id },
          data: {
            startedAt: fechaInicio,
            finishedAt: fechaFin,
            rating: ratingFinal ?? null,
            review: resenaFinal,
          },
        });
      }

      if (!actualizaFichaActual) return;

      if (!valoracionFueEnviada && !resenaFueEnviada) return;

      /*
       * Si no queda ni valoración ni reseña, eliminamos la review.
       * Esto permite usar "Quitar valoración" de forma real.
       */
      if (
        ratingFinal === undefined ||
        ratingFinal === null
      ) {
        if (!resenaFinal) {
          if (reviewActual) {
            await tx.review.delete({
              where: {
                id: reviewActual.id,
              },
            });
          }

          return;
        }

        /*
         * El modelo Review exige rating. Si existe reseña pero se ha
         * quitado la valoración, conservamos el rating anterior cuando
         * sea posible. Si no existía, no creamos una Review inválida.
         */
        if (!reviewActual) {
          throw new Error(
            'No se puede guardar una reseña sin valoración',
          );
        }
      }

      await tx.review.upsert({
        where: {
          userId_bookId: {
            userId: user.id,
            bookId: lectura.bookId,
          },
        },
        update: {
          rating: ratingFinal ?? reviewActual!.rating,
          review: resenaFinal,
          edited: true,
          deletedAt: null,
        },
        create: {
          userId: user.id,
          bookId: lectura.bookId,
          rating: ratingFinal!,
          review: resenaFinal,
          edited: true,
        },
      });
    });

    return {
      ok: true,
      mensaje: 'Lectura actualizada correctamente',
      fechaInicio: fechaToFlutter(fechaInicio),
      fechaFin: fechaToFlutter(fechaFin),
      valoracion:
        valoracionFueEnviada && rating != null
          ? ratingToFlutter(rating)
          : undefined,
      resena:
        resenaFueEnviada
          ? textoResena
          : undefined,
    };
  } catch (error) {
    return {
      ok: false,
      mensaje:
        error instanceof Error
          ? error.message
          : 'No se ha podido actualizar la lectura',
    };
  }
}

export async function actualizarAvatarPerfil(params: {
  usuario: string;
  avatarUrl: string;
}) {
  const usuario = params.usuario.trim();
  const avatarRecibido = params.avatarUrl.trim();

  if (!usuario) {
    return {
      ok: false,
      mensaje: 'Falta la usuaria',
    };
  }

  const user = await prisma.user.findUnique({
    where: {
      name: usuario,
    },
    select: {
      id: true,
    },
  });

  if (!user) {
    return {
      ok: false,
      mensaje: 'Usuaria no encontrada',
    };
  }

  /*
   * Una cadena vacía elimina la foto actual.
   */
  if (!avatarRecibido) {
    await prisma.user.update({
      where: {
        id: user.id,
      },
      data: {
        avatarUrl: null,
      },
    });

    return {
      ok: true,
      mensaje: 'Foto de perfil eliminada',
      avatarUrl: '',
    };
  }

  try {
    let avatarCloudinary: string;

    /*
     * Imagen seleccionada desde la galería de Flutter.
     */
    if (avatarRecibido.startsWith('data:image/')) {
      const resultado = await subirAvatarDesdeBase64({
        imageBase64: avatarRecibido,
        usuario,
      });

      avatarCloudinary = resultado.url;
    } else {
      /*
       * Imagen pegada desde Internet.
       */
      const uri = new URL(avatarRecibido);

      if (uri.protocol !== 'https:' && uri.protocol !== 'http:') {
        return {
          ok: false,
          mensaje: 'La URL de la imagen no es válida',
        };
      }

      const resultado = await subirAvatarDesdeUrl({
        imageUrl: avatarRecibido,
        usuario,
      });

      avatarCloudinary = resultado.url;
    }

    await prisma.user.update({
      where: {
        id: user.id,
      },
      data: {
        avatarUrl: avatarCloudinary,
      },
    });

    return {
      ok: true,
      mensaje: 'Foto de perfil actualizada',
      avatarUrl: avatarCloudinary,
    };
  } catch (error) {
    backgroundError('avatar_update_failed')(error);

    return {
      ok: false,
      mensaje:
        error instanceof Error
          ? error.message
          : 'No se ha podido procesar la imagen',
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Favoritos
// ─────────────────────────────────────────────────────────────────────────────

const MAX_FAVORITOS = 5;

export async function toggleFavorito(params: {
  usuario: string;
  bookId: string;
}): Promise<{ ok: boolean; mensaje: string; isFavorite?: boolean }> {
  const { usuario, bookId } = params;

  const user = await prisma.user.findFirst({
    where: { name: usuario },
    select: { id: true },
  });
  if (!user) return { ok: false, mensaje: 'Usuario no encontrado' };

  const entry = await prisma.library.findUnique({
    where: { userId_bookId: { userId: user.id, bookId } },
    select: { id: true, isFavorite: true },
  });
  if (!entry) return { ok: false, mensaje: 'Libro no encontrado en tu biblioteca' };

  // Si ya es favorito → desmarcar
  if (entry.isFavorite) {
    await prisma.library.update({
      where: { id: entry.id },
      data: { isFavorite: false },
    });
    return { ok: true, mensaje: 'Eliminado de favoritos', isFavorite: false };
  }

  // Si NO es favorito → comprobar límite
  const totalFavoritos = await prisma.library.count({
    where: { userId: user.id, isFavorite: true },
  });
  if (totalFavoritos >= MAX_FAVORITOS) {
    return {
      ok: false,
      mensaje: `Ya tienes ${MAX_FAVORITOS} favoritos. Quita uno antes de añadir otro.`,
    };
  }

  await prisma.library.update({
    where: { id: entry.id },
    data: { isFavorite: true },
  });
  return { ok: true, mensaje: 'Añadido a favoritos', isFavorite: true };
}

export async function getFavoritosDelClub(params: {
  usuario: string;
}): Promise<{
  ok: boolean;
  miembros: Array<{
    nombre: string;
    avatarUrl: string;
    favoritos: Array<{ id: string; title: string; authorName: string | null; coverUrl: string | null; genreName: string }>;
  }>;
}> {
  const { usuario } = params;

  const user = await prisma.user.findFirst({
    where: { name: usuario },
    select: { id: true },
  });
  if (!user) return { ok: false, miembros: [] };

  const ctx = await getCurrentClubContext(user.id);
  if (!ctx?.club?.id) return { ok: true, miembros: [] };

  const members = await prisma.clubMember.findMany({
    where: { clubId: ctx.club.id, userId: { not: user.id } },
    select: {
      user: {
        select: {
          name: true,
          avatarUrl: true,
          library: {
            where: { isFavorite: true },
            include: {
              book: { include: { author: true, genre: true } },
            },
            orderBy: { updatedAt: 'asc' },
            take: 5,
          },
        },
      },
    },
  });

  const miembros = members
    .filter((m) => m.user.library.length > 0)
    .map((m) => ({
      nombre: m.user.name,
      avatarUrl: m.user.avatarUrl ?? '',
      favoritos: m.user.library.map((e) => ({
        id: e.book.id,
        title: e.book.title,
        authorName: e.book.author?.name ?? null,
        coverUrl: e.book.coverUrl ?? null,
        genreName: e.book.genre?.name ?? '',
      })),
    }));

  return { ok: true, miembros };
}

export async function getFavoritosUsuario(params: {
  usuario: string;
}): Promise<{ ok: boolean; favoritos: Array<{ id: string; title: string; authorName: string | null; coverUrl: string | null; genreName: string }> }> {
  const { usuario } = params;

  const user = await prisma.user.findFirst({
    where: { name: usuario },
    select: { id: true },
  });
  if (!user) return { ok: false, favoritos: [] };

  const entries = await prisma.library.findMany({
    where: { userId: user.id, isFavorite: true },
    include: {
      book: {
        include: { author: true, genre: true },
      },
    },
    orderBy: { updatedAt: 'asc' },
    take: MAX_FAVORITOS,
  });

  return {
    ok: true,
    favoritos: entries.map((e) => ({
      id: e.book.id,
      title: e.book.title,
      authorName: e.book.author?.name ?? null,
      coverUrl: e.book.coverUrl ?? null,
      genreName: e.book.genre?.name ?? '',
    })),
  };
}
