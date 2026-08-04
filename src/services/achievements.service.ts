import { ReadingStatus } from '@prisma/client';

import { prisma } from '../prisma.js';

export interface AchievementDefinition {
  id: string;
  key: string;
  title: string;
  description: string;
  icon: string;
  rarity: string;
  target: number;
  category: string;
}

export interface AchievementState extends AchievementDefinition {
  progress: number;
  unlocked: boolean;
  unlockedAt: Date | null;
}

interface CompletedBookStats {
  id: string;
  bookId: string;
  finishedAt: Date | null;
  genreName?: string | null;
}

interface CompletedSeriesStats {
  id: string;
  completedAt: Date | null;
}

interface ReviewStats {
  createdAt: Date | null;
}

interface AchievementData {
  completedBooks: CompletedBookStats[];
  completedSeries: CompletedSeriesStats[];
  reviews: ReviewStats[];
}

export function buildAchievementDefinitions(): AchievementDefinition[] {
  return [
    {
      id: 'primer-libro',
      key: 'primer-libro',
      title: 'Primer libro',
      description: 'Completa tu primera lectura.',
      icon: '📚',
      rarity: 'common',
      target: 1,
      category: 'books',
    },
    {
      id: 'diez-libros',
      key: 'diez-libros',
      title: '10 libros leídos',
      description: 'Alcanza diez libros finalizados.',
      icon: '📖',
      rarity: 'rare',
      target: 10,
      category: 'books',
    },
    {
      id: 'maestra-de-sagas',
      key: 'maestra-de-sagas',
      title: 'Maestra de sagas',
      description: 'Completa una saga entera.',
      icon: '🌀',
      rarity: 'epic',
      target: 1,
      category: 'series',
    },
    {
      id: 'romance-addict',
      key: 'romance-addict',
      title: 'Romance addict',
      description: 'Completa tres libros de romance.',
      icon: '💘',
      rarity: 'rare',
      target: 3,
      category: 'genres',
    },
    {
      id: 'primera-resena',
      key: 'primera-resena',
      title: 'Primera reseña',
      description: 'Escribe tu primera reseña.',
      icon: '✍️',
      rarity: 'common',
      target: 1,
      category: 'reviews',
    },
  ];
}

function getUnlockDate(dates: Array<Date | null>, target: number) {
  const validDates = dates
    .filter((date): date is Date => Boolean(date))
    .sort((left, right) => left.getTime() - right.getTime());

  if (validDates.length < target) {
    return null;
  }

  return validDates[target - 1] ?? null;
}

export function buildAchievementState(
  definitions: AchievementDefinition[],
  data: AchievementData,
): AchievementState[] {
  return definitions.map((definition) => {
    let progress = 0;
    let unlockedAt: Date | null = null;

    switch (definition.key) {
      case 'primer-libro': {
        const finishedDates = data.completedBooks.map((book) => book.finishedAt);
        progress = data.completedBooks.length;
        unlockedAt = getUnlockDate(finishedDates, 1);
        break;
      }
      case 'diez-libros': {
        const finishedDates = data.completedBooks.map((book) => book.finishedAt);
        progress = data.completedBooks.length;
        unlockedAt = getUnlockDate(finishedDates, 10);
        break;
      }
      case 'maestra-de-sagas': {
        progress = data.completedSeries.length;
        unlockedAt = getUnlockDate(
          data.completedSeries.map((series) => series.completedAt),
          1,
        );
        break;
      }
      case 'romance-addict': {
        progress = data.completedBooks.filter(
          (book) => book.genreName?.toLowerCase() === 'romance',
        ).length;
        unlockedAt = getUnlockDate(
          data.completedBooks
            .filter(
              (book) => book.genreName?.toLowerCase() === 'romance',
            )
            .map((book) => book.finishedAt),
          3,
        );
        break;
      }
      case 'primera-resena': {
        progress = data.reviews.length;
        unlockedAt = getUnlockDate(
          data.reviews.map((review) => review.createdAt),
          1,
        );
        break;
      }
      default:
        break;
    }

    const unlocked = progress >= definition.target;

    return {
      ...definition,
      progress,
      unlocked,
      unlockedAt: unlocked ? unlockedAt : null,
    };
  });
}

async function getCompletedBooksForUser(userId: string) {
  const completions = await prisma.readingCompletion.findMany({
    where: { userId },
    select: {
      id: true,
      bookId: true,
      finishedAt: true,
      book: {
        select: {
          genre: {
            select: { name: true },
          },
        },
      },
    },
    orderBy: { finishedAt: 'asc' },
  });

  const completionMap = new Map(completions.map((item) => [item.bookId, item]));

  const libraries = await prisma.library.findMany({
    where: {
      userId,
      status: ReadingStatus.FINISHED,
    },
    select: {
      bookId: true,
      finishedAt: true,
      updatedAt: true,
      book: {
        select: {
          genre: {
            select: { name: true },
          },
        },
      },
    },
    orderBy: { finishedAt: 'asc' },
  });

  const books = new Map<string, CompletedBookStats>();

  for (const completion of completions) {
    books.set(completion.bookId, {
      id: completion.id,
      bookId: completion.bookId,
      finishedAt: completion.finishedAt,
      genreName: completion.book.genre.name,
    });
  }

  for (const item of libraries) {
    if (books.has(item.bookId)) {
      continue;
    }

    books.set(item.bookId, {
      id: item.bookId,
      bookId: item.bookId,
      finishedAt: item.finishedAt ?? item.updatedAt,
      genreName: item.book.genre.name,
    });
  }

  return Array.from(books.values()).sort(
    (left, right) => {
      const leftTime = left.finishedAt?.getTime() ?? Number.POSITIVE_INFINITY;
      const rightTime = right.finishedAt?.getTime() ?? Number.POSITIVE_INFINITY;
      return leftTime - rightTime;
    },
  );
}

async function getCompletedSeriesForUser(userId: string, completedBooks: CompletedBookStats[]) {
  const completedBookIds = new Set(completedBooks.map((book) => book.bookId));

  const series = await prisma.series.findMany({
    where: { publicationStatus: 'COMPLETED' },
    select: {
      id: true,
      books: {
        select: {
          id: true,
        },
      },
    },
  });

  const completedSeries: CompletedSeriesStats[] = [];

  for (const seriesItem of series) {
    if (!seriesItem.books.length) {
      continue;
    }

    const hasAllBooks = seriesItem.books.every((book) => completedBookIds.has(book.id));

    if (!hasAllBooks) {
      continue;
    }

    const relevantDates = completedBooks
      .filter((book) => seriesItem.books.some((seriesBook) => seriesBook.id === book.bookId))
      .map((book) => book.finishedAt)
      .filter((date): date is Date => Boolean(date));

    completedSeries.push({
      id: seriesItem.id,
      completedAt: relevantDates.length
        ? relevantDates.sort((left, right) => left.getTime() - right.getTime()).at(-1) ?? null
        : null,
    });
  }

  return completedSeries.sort((left, right) => {
    const leftTime = left.completedAt?.getTime() ?? Number.POSITIVE_INFINITY;
    const rightTime = right.completedAt?.getTime() ?? Number.POSITIVE_INFINITY;
    return leftTime - rightTime;
  });
}

async function getReviewsForUser(userId: string) {
  const reviews = await prisma.review.findMany({
    where: {
      userId,
      deletedAt: null,
    },
    select: {
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  return reviews as ReviewStats[];
}

export async function getAchievementsForUser(userName: string) {
  const normalizedUserName = userName.trim();

  if (!normalizedUserName) {
    return {
      ok: false,
      mensaje: 'Falta el nombre de la usuaria',
    };
  }

  const user = await prisma.user.findUnique({
    where: { name: normalizedUserName },
    select: { id: true, name: true },
  });

  if (!user) {
    return {
      ok: false,
      mensaje: 'Usuaria no encontrada',
    };
  }

  const completedBooks = await getCompletedBooksForUser(user.id);
  const completedSeries = await getCompletedSeriesForUser(user.id, completedBooks);
  const reviews = await getReviewsForUser(user.id);

  const definitions = buildAchievementDefinitions();
  const achievements = buildAchievementState(definitions, {
    completedBooks,
    completedSeries,
    reviews,
  });

  return {
    ok: true,
    user: user.name,
    achievements,
  };
}

export async function getRecentClubAchievements(userName?: string) {
  const { club } = await import('./club-context.service.js').then((module) => module.getCurrentClubContext(userName));

  const members = await prisma.clubMember.findMany({
    where: { clubId: club.id },
    select: {
      user: {
        select: {
          id: true,
          name: true,
        },
      },
    },
    orderBy: { joinedAt: 'asc' },
  });

  const unlocks: Array<{
    userId: string;
    user: string;
    unlockedAt: Date;
  } & AchievementState> = [];

  for (const member of members) {
    const data = await getAchievementsForUser(member.user.name);
    if (!data.ok || !Array.isArray(data.achievements)) {
      continue;
    }

    for (const achievement of data.achievements) {
      if (!achievement.unlocked || !achievement.unlockedAt) {
        continue;
      }

      unlocks.push({
        ...achievement,
        userId: member.user.id,
        user: member.user.name,
        unlockedAt: achievement.unlockedAt,
      });
    }
  }

  unlocks.sort((left, right) => right.unlockedAt.getTime() - left.unlockedAt.getTime());

  return {
    ok: true,
    club: club.name,
    achievements: unlocks.slice(0, 20),
  };
}
