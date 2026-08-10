export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 50;

export class PaginationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaginationError';
  }
}

export type CursorPosition = {
  value: string;
  id: string;
};

export type PaginationRequest = {
  limit: number;
  cursor?: CursorPosition;
};

export type Page<T> = {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
};

export function hasExplicitPagination(query: Record<string, unknown>) {
  return query.limit !== undefined || query.cursor !== undefined;
}

export function parsePagination(
  query: Record<string, unknown>,
): PaginationRequest {
  const rawLimit = query.limit;
  const normalizedLimit = typeof rawLimit === 'string' ? rawLimit.trim() : rawLimit;
  const validLimitType = normalizedLimit === undefined ||
    (typeof normalizedLimit === 'number' && Number.isFinite(normalizedLimit)) ||
    (typeof normalizedLimit === 'string' && /^\d+$/.test(normalizedLimit));
  const limit = normalizedLimit === undefined
    ? DEFAULT_PAGE_LIMIT
    : validLimitType
      ? Number(normalizedLimit)
      : Number.NaN;

  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_LIMIT) {
    throw new PaginationError(
      `limit debe ser un entero entre 1 y ${MAX_PAGE_LIMIT}`,
    );
  }

  const rawCursor = query.cursor;
  return {
    limit,
    ...(rawCursor === undefined || rawCursor === ''
      ? {}
      : { cursor: decodeCursor(String(rawCursor)) }),
  };
}

export function encodeCursor(position: CursorPosition) {
  return Buffer.from(JSON.stringify({ v: 1, ...position }), 'utf8')
    .toString('base64url');
}

export function decodeCursor(cursor: string): CursorPosition {
  try {
    if (!cursor || cursor.length > 1_024 || !/^[A-Za-z0-9_-]+$/.test(cursor)) {
      throw new Error('invalid encoding');
    }
    const decoded = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    ) as Record<string, unknown>;
    if (
      decoded.v !== 1 ||
      typeof decoded.value !== 'string' ||
      !decoded.value ||
      typeof decoded.id !== 'string' ||
      !decoded.id ||
      decoded.id.length > 200 ||
      Number.isNaN(new Date(decoded.value).getTime())
    ) {
      throw new Error('invalid payload');
    }
    return { value: decoded.value, id: decoded.id };
  } catch {
    throw new PaginationError('cursor no válido');
  }
}

export function pageFromRows<T>(
  rows: T[],
  limit: number,
  position: (row: T) => CursorPosition,
): Page<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items.at(-1);
  return {
    items,
    nextCursor: hasMore && last ? encodeCursor(position(last)) : null,
    hasMore,
  };
}

export function descendingCursorFilter(
  field: string,
  cursor?: CursorPosition,
) {
  if (!cursor) return {};
  const value = new Date(cursor.value);
  if (Number.isNaN(value.getTime())) {
    throw new PaginationError('cursor no válido');
  }
  return {
    OR: [
      { [field]: { lt: value } },
      { [field]: value, id: { lt: cursor.id } },
    ],
  };
}

export function ascendingCursorFilter(
  field: string,
  cursor?: CursorPosition,
) {
  if (!cursor) return {};
  const value = new Date(cursor.value);
  if (Number.isNaN(value.getTime())) {
    throw new PaginationError('cursor no válido');
  }
  return {
    OR: [
      { [field]: { gt: value } },
      { [field]: value, id: { gt: cursor.id } },
    ],
  };
}
