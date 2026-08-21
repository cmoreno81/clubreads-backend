import { Prisma, ReadingStatus } from '@prisma/client';

import { prisma } from '../prisma.js';
import { resolveCanonicalBookId } from './book-identity.service.js';
import { invalidatePrefix } from '../utils/simple-cache.js';

const statusRank: Record<ReadingStatus, number> = {
  PENDING: 0,
  PAUSED: 1,
  ABANDONED: 2,
  READING: 3,
  REREADING: 4,
  FINISHED: 5,
};

type CompletionForMerge = {
  id: string;
  userId: string;
  bookId: string;
  startedAt: Date | null;
  finishedAt: Date;
  isReread: boolean;
  rating: number | null;
  review: string | null;
  readingFormat: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export function equivalentCompletionKey(
  completion: Pick<CompletionForMerge, 'userId' | 'finishedAt' | 'isReread'>,
) {
  return `${completion.userId}:${completion.finishedAt.toISOString().slice(0, 10)}:${completion.isReread}`;
}

function completionScore(completion: CompletionForMerge) {
  return Number(Boolean(completion.startedAt)) +
    Number(completion.rating !== null) +
    Number(Boolean(completion.review?.trim())) * 2 +
    Number(Boolean(completion.readingFormat));
}

export function mostCompleteCompletion<T extends CompletionForMerge>(completions: T[]) {
  if (completions.length === 0) throw new Error('EMPTY_COMPLETION_GROUP');
  return [...completions].sort((left, right) =>
    completionScore(right) - completionScore(left) ||
    right.updatedAt.getTime() - left.updatedAt.getTime() ||
    right.createdAt.getTime() - left.createdAt.getTime() ||
    left.id.localeCompare(right.id)
  )[0];
}

export async function consolidateEquivalentCompletions(
  tx: Prisma.TransactionClient,
  bookIds: string[],
  canonicalBookId: string,
) {
  const completions = await tx.readingCompletion.findMany({
    where: { bookId: { in: bookIds } },
  });
  const completionGroups = new Map<string, typeof completions>();
  for (const completion of completions) {
    const key = equivalentCompletionKey(completion);
    completionGroups.set(key, [...(completionGroups.get(key) ?? []), completion]);
  }
  for (const group of completionGroups.values()) {
    const keeper = mostCompleteCompletion(group);
    const ordered = [keeper, ...group.filter(({ id }) => id !== keeper.id)];
    const firstValue = <T>(valueFor: (item: typeof group[number]) => T | null | undefined) =>
      ordered.map(valueFor).find((value) => value !== null && value !== undefined) ?? null;
    await tx.readingCompletion.update({
      where: { id: keeper.id },
      data: {
        bookId: canonicalBookId,
        startedAt: firstValue(({ startedAt }) => startedAt),
        rating: firstValue(({ rating }) => rating),
        review: firstValue(({ review }) => review?.trim() || null),
        readingFormat: firstValue(({ readingFormat }) => readingFormat),
      },
    });
    const duplicateIds = group.filter(({ id }) => id !== keeper.id).map(({ id }) => id);
    if (duplicateIds.length > 0) {
      await tx.readingCompletion.deleteMany({ where: { id: { in: duplicateIds } } });
    }
  }
}

export async function mergeBooks(sourceIdValue: string, canonicalIdValue: string, reason?: string) {
  const result = await prisma.$transaction(async (tx) => {
    const sourceId = await resolveCanonicalBookId(tx, sourceIdValue);
    const canonicalId = await resolveCanonicalBookId(tx, canonicalIdValue);
    if (sourceId === canonicalId) return { canonicalBookId: canonicalId, sourceBookId: sourceId, alreadyMerged: true as const };

    const orderedIds = [sourceId, canonicalId].sort();
    await tx.$queryRaw`
      SELECT "id" FROM "Book"
      WHERE "id" IN (${Prisma.join(orderedIds)})
      ORDER BY "id" FOR UPDATE
    `;

    const [source, canonical] = await Promise.all([
      tx.book.findUnique({
        where: { id: sourceId },
        include: {
          author: true,
          library: { include: { progressReactions: true } },
          readingCompletions: true,
          reviews: true,
          readings: { include: { conversations: true } },
          clubvisionCandidates: { include: { clubvisionVotes: true } },
          wonClubvisions: true,
          clubvisionResults: true,
        },
      }),
      tx.book.findUnique({ where: { id: canonicalId }, include: { author: true } }),
    ]);
    if (!source || source.deletedAt) throw new Error('SOURCE_BOOK_NOT_FOUND');
    if (!canonical || canonical.deletedAt) throw new Error('CANONICAL_BOOK_NOT_FOUND');

    const notifications = await tx.notification.findMany({ where: { bookId: sourceId } });
    await tx.bookMergeAudit.create({
      data: {
        sourceBookId: sourceId,
        canonicalBookId: canonicalId,
        snapshot: JSON.parse(JSON.stringify({ source, notifications })) as Prisma.InputJsonValue,
      },
    });

    for (const sourceLibrary of source.library) {
      const targetLibrary = await tx.library.findUnique({
        where: { userId_bookId: { userId: sourceLibrary.userId, bookId: canonicalId } },
        include: { progressReactions: true },
      });
      if (!targetLibrary) {
        await tx.library.update({ where: { id: sourceLibrary.id }, data: { bookId: canonicalId } });
        continue;
      }
      for (const reaction of sourceLibrary.progressReactions) {
        await tx.progressReaction.upsert({
          where: { libraryId_userId: { libraryId: targetLibrary.id, userId: reaction.userId } },
          update: { reaction: reaction.reaction },
          create: { libraryId: targetLibrary.id, userId: reaction.userId, reaction: reaction.reaction },
        });
      }
      const preferred = statusRank[sourceLibrary.status] > statusRank[targetLibrary.status]
        ? sourceLibrary
        : targetLibrary;
      await tx.library.update({
        where: { id: targetLibrary.id },
        data: {
          status: preferred.status,
          priority: preferred.priority,
          readingFormat: targetLibrary.readingFormat ?? sourceLibrary.readingFormat,
          startedAt: targetLibrary.startedAt ?? sourceLibrary.startedAt,
          finishedAt: targetLibrary.finishedAt ?? sourceLibrary.finishedAt,
          pausedAt: targetLibrary.pausedAt ?? sourceLibrary.pausedAt,
          pauseReason: targetLibrary.pauseReason ?? sourceLibrary.pauseReason,
          currentPage: Math.max(targetLibrary.currentPage ?? 0, sourceLibrary.currentPage ?? 0) || null,
          lastProgress: Math.max(targetLibrary.lastProgress ?? 0, sourceLibrary.lastProgress ?? 0) || null,
          progressNote: targetLibrary.progressNote ?? sourceLibrary.progressNote,
          progressUpdatedAt: targetLibrary.progressUpdatedAt ?? sourceLibrary.progressUpdatedAt,
        },
      });
      await tx.library.delete({ where: { id: sourceLibrary.id } });
    }

    await consolidateEquivalentCompletions(tx, [sourceId, canonicalId], canonicalId);

    for (const sourceReview of source.reviews) {
      const targetReview = await tx.review.findUnique({
        where: { userId_bookId: { userId: sourceReview.userId, bookId: canonicalId } },
      });
      if (!targetReview) {
        await tx.review.update({ where: { id: sourceReview.id }, data: { bookId: canonicalId } });
        continue;
      }
      const texts = [targetReview.review?.trim(), sourceReview.review?.trim()].filter(Boolean);
      await tx.review.update({
        where: { id: targetReview.id },
        data: {
          rating: sourceReview.updatedAt > targetReview.updatedAt ? sourceReview.rating : targetReview.rating,
          review: [...new Set(texts)].join('\n\n') || null,
          containsSpoilers: targetReview.containsSpoilers || sourceReview.containsSpoilers,
          edited: true,
          deletedAt: targetReview.deletedAt && sourceReview.deletedAt
            ? (targetReview.deletedAt > sourceReview.deletedAt ? targetReview.deletedAt : sourceReview.deletedAt)
            : null,
        },
      });
      await tx.review.delete({ where: { id: sourceReview.id } });
    }

    for (const reading of source.readings) {
      const activeTarget = reading.status === 'ACTIVE'
        ? await tx.reading.findFirst({ where: { clubId: reading.clubId, bookId: canonicalId, status: 'ACTIVE' } })
        : null;
      if (!activeTarget) {
        await tx.reading.update({ where: { id: reading.id }, data: { bookId: canonicalId } });
      } else {
        await tx.conversation.updateMany({ where: { readingId: reading.id }, data: { readingId: activeTarget.id } });
        await tx.reading.delete({ where: { id: reading.id } });
      }
    }

    for (const candidate of source.clubvisionCandidates) {
      const targetCandidate = await tx.clubvisionCandidate.findUnique({
        where: { clubvisionId_bookId: { clubvisionId: candidate.clubvisionId, bookId: canonicalId } },
      });
      if (!targetCandidate) {
        await tx.clubvisionCandidate.update({ where: { id: candidate.id }, data: { bookId: canonicalId } });
        continue;
      }
      for (const vote of candidate.clubvisionVotes) {
        const existing = await tx.clubvisionVote.findUnique({
          where: {
            clubvisionId_userId_candidateId: {
              clubvisionId: vote.clubvisionId,
              userId: vote.userId,
              candidateId: targetCandidate.id,
            },
          },
        });
        if (!existing) {
          await tx.clubvisionVote.update({ where: { id: vote.id }, data: { candidateId: targetCandidate.id } });
        } else {
          await tx.clubvisionVote.delete({ where: { id: vote.id } });
        }
      }
      await tx.clubvisionCandidate.delete({ where: { id: candidate.id } });
    }

    await Promise.all([
      tx.clubvision.updateMany({ where: { winnerBookId: sourceId }, data: { winnerBookId: canonicalId } }),
      tx.clubvisionResult.updateMany({ where: { winnerBookId: sourceId }, data: { winnerBookId: canonicalId } }),
      tx.notification.updateMany({ where: { bookId: sourceId }, data: { bookId: canonicalId } }),
    ]);

    await tx.book.update({ where: { id: sourceId }, data: { deletedAt: new Date() } });
    const merged = await tx.book.update({
      where: { id: canonicalId },
      data: {
        coverUrl: canonical.coverUrl?.trim() || source.coverUrl?.trim() || null,
        goodreadsUrl: canonical.goodreadsUrl?.trim() || source.goodreadsUrl?.trim() || null,
        synopsis: canonical.synopsis?.trim() || source.synopsis?.trim() || null,
        isbn: canonical.isbn?.trim() || source.isbn?.trim() || null,
        publicationYear: canonical.publicationYear ?? source.publicationYear,
        totalPages: canonical.totalPages ?? source.totalPages,
        authorId: canonical.authorId ?? source.authorId,
        genreId: canonical.genreId ?? source.genreId,
        seriesId: canonical.seriesId ?? source.seriesId,
        seriesOrder: canonical.seriesOrder?.trim() || source.seriesOrder?.trim() || null,
      },
    });
    await tx.bookRedirect.upsert({
      where: { oldBookId: sourceId },
      update: { canonicalBookId: canonicalId, reason: reason?.trim() || null },
      create: { oldBookId: sourceId, canonicalBookId: canonicalId, reason: reason?.trim() || null },
    });
    await tx.bookRedirect.updateMany({
      where: { canonicalBookId: sourceId },
      data: { canonicalBookId: canonicalId },
    });
    return { canonicalBookId: merged.id, sourceBookId: sourceId, alreadyMerged: false };
  }, { maxWait: 10_000, timeout: 120_000, isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  // Invalidar cachés de biblioteca para que todos los usuarios vean
  // el estado correcto sin necesidad de reiniciar el servidor.
  invalidatePrefix('libros:');
  invalidatePrefix('finalizados:');

  return result;
}
