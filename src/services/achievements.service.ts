import { ReadingStatus } from '@prisma/client';
import { prisma } from '../prisma.js';

export interface AchievementDefinition {
  id: string;
  key: string;
  title: string;
  description: string;
  icon: string;
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
  target: number;
  category: string;
}

export interface AchievementState extends AchievementDefinition {
  progress: number;
  unlocked: boolean;
  unlockedAt: Date | null;
}

interface AchievementData {
  completedBooks: Array<{ bookId: string; finishedAt: Date | null; genreName?: string | null; pages?: number | null }>;
  completedSeries: Array<{ id: string; completedAt: Date | null }>;
  reviews: Array<{ createdAt: Date | null }>;
  comments: number;
  clubvisionVotes: number;
  totalPages: number;
  genreCounts: Map<string, number>;
  booksThisMonth: number;
  booksThisYear: number;
  abandonedBooks: number;
}

export function buildAchievementDefinitions(): AchievementDefinition[] {
  return [
    // ── 📚 LECTORA ──
    { id: 'primer-libro', key: 'primer-libro', title: 'Primer libro', description: 'Completa tu primera lectura.', icon: '📖', rarity: 'common', target: 1, category: 'lectora' },
    { id: 'cinco-libros', key: 'cinco-libros', title: 'Lectora en marcha', description: 'Llega a 5 libros terminados.', icon: '📚', rarity: 'common', target: 5, category: 'lectora' },
    { id: 'diez-libros', key: 'diez-libros', title: 'Lectora habitual', description: 'Alcanza 10 libros finalizados.', icon: '🔟', rarity: 'common', target: 10, category: 'lectora' },
    { id: 'veinticinco-libros', key: 'veinticinco-libros', title: 'Voraz lectora', description: '25 libros en tu historial.', icon: '🌟', rarity: 'rare', target: 25, category: 'lectora' },
    { id: 'cincuenta-libros', key: 'cincuenta-libros', title: 'Biblióvora', description: '50 libros completados.', icon: '🏆', rarity: 'epic', target: 50, category: 'lectora' },
    { id: 'cien-libros', key: 'cien-libros', title: 'Centenaria lectora', description: '100 libros. Una hazaña.', icon: '💯', rarity: 'legendary', target: 100, category: 'lectora' },

    // ── 📄 PÁGINAS ──
    { id: 'mil-paginas', key: 'mil-paginas', title: 'Mil páginas', description: 'Supera las 1.000 páginas leídas.', icon: '📄', rarity: 'common', target: 1000, category: 'paginas' },
    { id: 'cinco-mil-paginas', key: 'cinco-mil-paginas', title: 'Lectora resistente', description: '5.000 páginas en tu contador.', icon: '📃', rarity: 'rare', target: 5000, category: 'paginas' },
    { id: 'diez-mil-paginas', key: 'diez-mil-paginas', title: 'Maratoniana de páginas', description: 'Has leído 10.000 páginas.', icon: '📜', rarity: 'epic', target: 10000, category: 'paginas' },
    { id: 'cincuenta-mil-paginas', key: 'cincuenta-mil-paginas', title: 'Leyenda de las páginas', description: '50.000 páginas. Épico.', icon: '🗺️', rarity: 'legendary', target: 50000, category: 'paginas' },

    // ── 🌀 SAGAS ──
    { id: 'primera-saga', key: 'primera-saga', title: 'Saga completada', description: 'Termina tu primera saga.', icon: '🌀', rarity: 'rare', target: 1, category: 'sagas' },
    { id: 'tres-sagas', key: 'tres-sagas', title: 'Maestra de sagas', description: 'Completa 3 sagas.', icon: '💫', rarity: 'epic', target: 3, category: 'sagas' },
    { id: 'cinco-sagas', key: 'cinco-sagas', title: 'Coleccionista de sagas', description: '5 sagas completas en tu haber.', icon: '🌌', rarity: 'legendary', target: 5, category: 'sagas' },

    // ── 🎭 GÉNEROS ──
    { id: 'romance-addict', key: 'romance-addict', title: 'Romance addict', description: '10 libros de Romance.', icon: '💗', rarity: 'rare', target: 10, category: 'generos' },
    { id: 'fantasia-forever', key: 'fantasia-forever', title: 'Guardiana de mundos', description: '10 libros de Fantasía.', icon: '🧙', rarity: 'rare', target: 10, category: 'generos' },
    { id: 'thriller-queen', key: 'thriller-queen', title: 'Thriller queen', description: '5 libros de Thriller.', icon: '🔪', rarity: 'rare', target: 5, category: 'generos' },
    { id: 'dark-romance', key: 'dark-romance', title: 'Dark side', description: '5 libros de Dark Romance.', icon: '🖤', rarity: 'rare', target: 5, category: 'generos' },
    { id: 'exploradora-generos', key: 'exploradora-generos', title: 'Exploradora', description: 'Lee libros de 5 géneros distintos.', icon: '🗺️', rarity: 'epic', target: 5, category: 'generos' },

    // ── ✍️ RESEÑAS ──
    { id: 'primera-resena', key: 'primera-resena', title: 'Primera reseña', description: 'Escribe tu primera reseña.', icon: '✍️', rarity: 'common', target: 1, category: 'resenas' },
    { id: 'diez-resenas', key: 'diez-resenas', title: 'Crítica literaria', description: '10 reseñas escritas.', icon: '📝', rarity: 'rare', target: 10, category: 'resenas' },
    { id: 'veinticinco-resenas', key: 'veinticinco-resenas', title: 'Pluma incansable', description: '25 reseñas en tu historial.', icon: '🖊️', rarity: 'epic', target: 25, category: 'resenas' },

    // ── 💬 CLUB ──
    { id: 'primer-comentario', key: 'primer-comentario', title: 'Primera voz', description: 'Comenta por primera vez en una lectura.', icon: '💬', rarity: 'common', target: 1, category: 'club' },
    { id: 'diez-comentarios', key: 'diez-comentarios', title: 'Voz del club', description: '10 comentarios en lecturas.', icon: '🗣️', rarity: 'rare', target: 10, category: 'club' },
    { id: 'cincuenta-comentarios', key: 'cincuenta-comentarios', title: 'Alma del club', description: '50 comentarios. La más activa.', icon: '🎤', rarity: 'epic', target: 50, category: 'club' },

    // ── 🗳️ CLUBVISIÓN ──
    { id: 'primer-voto', key: 'primer-voto', title: 'Primera votante', description: 'Participa en tu primera Clubvisión.', icon: '🗳️', rarity: 'common', target: 1, category: 'clubvision' },
    { id: 'cinco-votos', key: 'cinco-votos', title: 'Votante fiel', description: '5 participaciones en Clubvisión.', icon: '🏛️', rarity: 'rare', target: 5, category: 'clubvision' },
    { id: 'diez-votos', key: 'diez-votos', title: 'Electora veterana', description: '10 votaciones en Clubvisión.', icon: '👑', rarity: 'epic', target: 10, category: 'clubvision' },

    // ── 🔥 CONSTANCIA ──
    { id: 'tres-en-mes', key: 'tres-en-mes', title: 'Mes intenso', description: '3 libros en un mismo mes.', icon: '🔥', rarity: 'rare', target: 3, category: 'constancia' },
    { id: 'cinco-en-mes', key: 'cinco-en-mes', title: 'Maratoniana', description: '5 libros en un mes.', icon: '⚡', rarity: 'epic', target: 5, category: 'constancia' },
    { id: 'diez-en-anio', key: 'diez-en-anio', title: 'Gran año lector', description: '10 libros en un año.', icon: '🗓️', rarity: 'rare', target: 10, category: 'constancia' },
    { id: 'veinte-en-anio', key: 'veinte-en-anio', title: 'Año legendario', description: '20 libros en un solo año.', icon: '🏅', rarity: 'legendary', target: 20, category: 'constancia' },
  ];
}

function getUnlockDate(dates: Array<Date | null>, target: number): Date | null {
  const validDates = dates
    .filter((date): date is Date => Boolean(date))
    .sort((l, r) => l.getTime() - r.getTime());
  return validDates.length >= target ? (validDates[target - 1] ?? null) : null;
}

function getGenreUnlockDate(
  books: Array<{ finishedAt: Date | null; genreName?: string | null }>,
  genre: string,
  target: number,
): Date | null {
  const sorted = [...books]
    .filter((b) => b.genreName?.toLowerCase().trim() === genre)
    .sort((a, b) => (a.finishedAt?.getTime() ?? 0) - (b.finishedAt?.getTime() ?? 0));
  return sorted[target - 1]?.finishedAt ?? null;
}

function getExplorerUnlockDate(
  books: Array<{ finishedAt: Date | null; genreName?: string | null }>,
  target: number,
): Date | null {
  const sorted = [...books].sort(
    (a, b) => (a.finishedAt?.getTime() ?? 0) - (b.finishedAt?.getTime() ?? 0),
  );
  const seen = new Set<string>();
  for (const b of sorted) {
    if (b.genreName) seen.add(b.genreName.toLowerCase().trim());
    if (seen.size >= target) return b.finishedAt ?? null;
  }
  return null;
}

function getPagesUnlockDate(
  books: Array<{ finishedAt: Date | null; pages?: number | null }>,
  target: number,
): Date | null {
  const sorted = [...books].sort(
    (a, b) => (a.finishedAt?.getTime() ?? 0) - (b.finishedAt?.getTime() ?? 0),
  );
  let accumulated = 0;
  for (const b of sorted) {
    accumulated += b.pages ?? 0;
    if (accumulated >= target) return b.finishedAt ?? null;
  }
  return null;
}

function getCountUnlockDate(
  dates: Array<Date | null>,
  target: number,
): Date | null {
  const valid = dates
    .filter((d): d is Date => Boolean(d))
    .sort((a, b) => a.getTime() - b.getTime());
  return valid[target - 1] ?? null;
}

export function buildAchievementState(
  definitions: AchievementDefinition[],
  data: AchievementData,
): AchievementState[] {
  return definitions.map((def) => {
    let progress = 0;
    let unlockedAt: Date | null = null;

    switch (def.key) {
      case 'primer-libro':
      case 'cinco-libros':
      case 'diez-libros':
      case 'veinticinco-libros':
      case 'cincuenta-libros':
      case 'cien-libros':
        progress = data.completedBooks.length;
        unlockedAt = getUnlockDate(data.completedBooks.map(b => b.finishedAt), def.target);
        break;

      case 'mil-paginas':
      case 'cinco-mil-paginas':
      case 'diez-mil-paginas':
      case 'cincuenta-mil-paginas':
        progress = data.totalPages;
        unlockedAt = getPagesUnlockDate(data.completedBooks, def.target);
        break;

      case 'primera-saga':
      case 'tres-sagas':
      case 'cinco-sagas':
        progress = data.completedSeries.length;
        unlockedAt = getUnlockDate(data.completedSeries.map(s => s.completedAt), def.target);
        break;

      case 'romance-addict':
        progress = data.genreCounts.get('romance') ?? 0;
        unlockedAt = getGenreUnlockDate(data.completedBooks, 'romance', def.target);
        break;
      case 'fantasia-forever':
        progress = data.genreCounts.get('fantasía') ?? data.genreCounts.get('fantasia') ?? 0;
        unlockedAt = getGenreUnlockDate(data.completedBooks, 'fantasía', def.target)
          ?? getGenreUnlockDate(data.completedBooks, 'fantasia', def.target);
        break;
      case 'thriller-queen':
        progress = data.genreCounts.get('thriller') ?? 0;
        unlockedAt = getGenreUnlockDate(data.completedBooks, 'thriller', def.target);
        break;
      case 'dark-romance':
        progress = data.genreCounts.get('dark romance') ?? 0;
        unlockedAt = getGenreUnlockDate(data.completedBooks, 'dark romance', def.target);
        break;
      case 'exploradora-generos':
        progress = data.genreCounts.size;
        unlockedAt = getExplorerUnlockDate(data.completedBooks, def.target);
        break;

      case 'primera-resena':
      case 'diez-resenas':
      case 'veinticinco-resenas':
        progress = data.reviews.length;
        unlockedAt = getUnlockDate(data.reviews.map(r => r.createdAt), def.target);
        break;

      case 'primer-comentario':
      case 'diez-comentarios':
      case 'cincuenta-comentarios':
        progress = data.comments;
        // comentarios no tienen fechas individuales en AchievementData — se marca hoy si supera target
        unlockedAt = progress >= def.target ? new Date() : null;
        break;

      case 'primer-voto':
      case 'cinco-votos':
      case 'diez-votos':
        progress = data.clubvisionVotes;
        unlockedAt = progress >= def.target ? new Date() : null;
        break;

      case 'tres-en-mes':
      case 'cinco-en-mes':
        progress = data.booksThisMonth;
        unlockedAt = progress >= def.target
          ? getCountUnlockDate(
              data.completedBooks
                .filter(b => {
                  if (!b.finishedAt) return false;
                  const now = new Date();
                  return b.finishedAt >= new Date(now.getFullYear(), now.getMonth(), 1);
                })
                .map(b => b.finishedAt),
              def.target,
            )
          : null;
        break;

      case 'diez-en-anio':
      case 'veinte-en-anio':
        progress = data.booksThisYear;
        unlockedAt = progress >= def.target
          ? getCountUnlockDate(
              data.completedBooks
                .filter(b => {
                  if (!b.finishedAt) return false;
                  const now = new Date();
                  return b.finishedAt >= new Date(now.getFullYear(), 0, 1);
                })
                .map(b => b.finishedAt),
              def.target,
            )
          : null;
        break;
    }

    const unlocked = progress >= def.target;
    return { ...def, progress, unlocked, unlockedAt: unlocked ? unlockedAt : null };
  });
}

// ─── Data fetching ───────────────────────────────────────────────

async function getCompletedBooksForUser(userId: string) {
  const completions = await prisma.readingCompletion.findMany({
    where: { userId },
    select: {
      id: true, bookId: true, finishedAt: true,
book: { select: { genre: { select: { name: true } }, totalPages: true } },    },
    orderBy: { finishedAt: 'asc' },
  });

  const books = new Map<string, { bookId: string; finishedAt: Date | null; genreName?: string | null; pages?: number | null }>();

  for (const c of completions) {
    books.set(c.bookId, {
      bookId: c.bookId, finishedAt: c.finishedAt,
      genreName: c.book.genre?.name, pages: c.book.totalPages,
    });
  }

  const libraries = await prisma.library.findMany({
    where: { userId, status: ReadingStatus.FINISHED },
    select: {
      bookId: true, finishedAt: true, updatedAt: true,
      book: { select: { genre: { select: { name: true } }, totalPages: true } },
    },
  });

  for (const item of libraries) {
    if (!books.has(item.bookId)) {
      books.set(item.bookId, {
        bookId: item.bookId, finishedAt: item.finishedAt ?? item.updatedAt,
        genreName: item.book.genre?.name, pages: item.book.totalPages,
      });
    }
  }

  return [...books.values()].sort((a, b) =>
    (a.finishedAt?.getTime() ?? Infinity) - (b.finishedAt?.getTime() ?? Infinity));
}

async function getCompletedSeriesForUser(
  userId: string,
  completedBooks: Array<{ bookId: string; finishedAt: Date | null }>,
) {
  const completedBookIds = new Set(completedBooks.map(b => b.bookId));
  const series = await prisma.series.findMany({
    where: { publicationStatus: 'COMPLETED' },
    select: { id: true, books: { select: { id: true } } },
  });

  const result: Array<{ id: string; completedAt: Date | null }> = [];
  for (const s of series) {
    if (!s.books.length) continue;
    if (!s.books.every(b => completedBookIds.has(b.id))) continue;
    const dates = completedBooks
      .filter(b => s.books.some(sb => sb.id === b.bookId))
      .map(b => b.finishedAt)
      .filter((d): d is Date => Boolean(d))
      .sort((a, b) => a.getTime() - b.getTime());
    result.push({ id: s.id, completedAt: dates.at(-1) ?? null });
  }
  return result;
}

export async function getAchievementsForUser(userName: string) {
  const user = await prisma.user.findUnique({
    where: { name: userName.trim() }, select: { id: true, name: true },
  });
  if (!user) return { ok: false, mensaje: 'Usuaria no encontrada' };

  const completedBooks = await getCompletedBooksForUser(user.id);
  const completedSeries = await getCompletedSeriesForUser(user.id, completedBooks);

  const reviews = await prisma.review.findMany({
    where: { userId: user.id, deletedAt: null },
    select: { createdAt: true }, orderBy: { createdAt: 'asc' },
  });

  const comments = await prisma.comment.count({ where: { userId: user.id } });
  const clubvisionVotes = await prisma.clubvisionVote.count({ where: { userId: user.id } });

  const totalPages = completedBooks.reduce((sum, b) => sum + (b.pages ?? 0), 0);

  const genreCounts = new Map<string, number>();
  for (const b of completedBooks) {
    if (!b.genreName) continue;
    const key = b.genreName.toLowerCase().trim();
    genreCounts.set(key, (genreCounts.get(key) ?? 0) + 1);
  }

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const booksThisMonth = completedBooks.filter(b => b.finishedAt && b.finishedAt >= monthStart).length;
  const booksThisYear = completedBooks.filter(b => b.finishedAt && b.finishedAt >= yearStart).length;

  const definitions = buildAchievementDefinitions();
  const achievements = buildAchievementState(definitions, {
    completedBooks, completedSeries, reviews,
    comments, clubvisionVotes, totalPages,
    genreCounts, booksThisMonth, booksThisYear,
    abandonedBooks: 0,
  });

  return { ok: true, user: user.name, achievements };
}

export async function getRecentClubAchievements(userName?: string) {
  const { club } = await import('./club-context.service.js')
    .then(m => m.getCurrentClubContext(userName));

  const members = await prisma.clubMember.findMany({
    where: { clubId: club.id },
    select: { user: { select: { id: true, name: true, avatarUrl: true } } },
  });

  const unlocks: Array<AchievementState & { userId: string; user: string; avatarUrl: string; unlockedAt: Date }> = [];

  for (const member of members) {
    const data = await getAchievementsForUser(member.user.name);
    if (!data.ok || !Array.isArray(data.achievements)) continue;

    for (const ach of data.achievements) {
      if (!ach.unlocked || !ach.unlockedAt) continue;
      unlocks.push({
        ...ach,
        userId: member.user.id,
        user: member.user.name,
        avatarUrl: member.user.avatarUrl ?? '',
        unlockedAt: ach.unlockedAt as Date,
      });
    }
  }

  unlocks.sort((a, b) => b.unlockedAt.getTime() - a.unlockedAt.getTime());
  return {
    ok: true,
    club: club.name,
    achievements: unlocks.slice(0, 30).map((u) => ({
      userName: u.user,
      avatarUrl: u.avatarUrl,
      achievementTitle: u.title,
      achievementIcon: u.icon,
      unlockedAt: u.unlockedAt.toISOString(),
    })),
  };
}