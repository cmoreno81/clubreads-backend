export type ClubvisionStage = 'VOTACION' | 'RESULTADOS' | 'LECTURA';

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
