export const DAY_MS = 86_400_000;
export const TICKS_PER_DAY = 4;

export function elapsedTicks(state: { elapsedDays: number; tickInDay: number }) {
  return state.elapsedDays * TICKS_PER_DAY + state.tickInDay;
}

export function calendarMonthsPassed(date: Date, days: number, months: number) {
  if (days < months * 28) return false;
  const start = new Date(date.getTime() - days * DAY_MS);
  const anniversary = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + months + 1, 0));
  anniversary.setUTCDate(Math.min(start.getUTCDate(), anniversary.getUTCDate()));
  return date >= anniversary;
}
