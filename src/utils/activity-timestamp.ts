export function activityTimestamp(date: Date | null | undefined) {
  return date?.toISOString() ?? null;
}
