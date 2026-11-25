export const DAY_MS = 86_400_000;
export const TICKS_PER_DAY = 4;

export function elapsedTicks(state: { elapsedDays: number; tickInDay: number }) {
  return state.elapsedDays * TICKS_PER_DAY + state.tickInDay;
}
