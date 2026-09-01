export type ClubvisionStage = 'VOTACION' | 'RESULTADOS' | 'LECTURA';
export type ClubvisionNoticeType = 'APERTURA' | 'VOTACION' | 'GALA';

export function getClubvisionCalendarFor(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );

  return {
    edition: `${values.year}-${values.month}`,
    day: Number(values.day),
  };
}

export function getClubvisionStage(
  day: number,
  allMembersVoted: boolean,
): ClubvisionStage {
  if (day >= 4) return 'LECTURA';
  if (day >= 3 || allMembersVoted) return 'RESULTADOS';
  return 'VOTACION';
}

export function getTimedClubvisionStage(
  now: Date,
  votingEndsAt: Date,
  resultsEndsAt: Date,
  allMembersVoted: boolean,
): ClubvisionStage {
  if (now >= resultsEndsAt) return 'LECTURA';
  if (now >= votingEndsAt || allMembersVoted) return 'RESULTADOS';
  return 'VOTACION';
}

export function fitsBeforeNextClubvisionEdition(
  start: Date,
  durationHours: number,
) {
  const end = new Date(start.getTime() + durationHours * 60 * 60 * 1000);
  return getClubvisionCalendarFor(start).edition ===
    getClubvisionCalendarFor(end).edition;
}

export function getClubvisionNoticeMomentFor(
  date: Date,
): { type: ClubvisionNoticeType; edition: string } | null {
  const current = getClubvisionCalendarFor(date);
  const tomorrow = getClubvisionCalendarFor(
    new Date(date.getTime() + 24 * 60 * 60 * 1000),
  );

  if (tomorrow.day === 1) {
    return { type: 'APERTURA', edition: tomorrow.edition };
  }
  if (current.day === 1 || current.day === 2) {
    return { type: 'VOTACION', edition: current.edition };
  }
  if (current.day === 3) {
    return { type: 'GALA', edition: current.edition };
  }
  return null;
}
