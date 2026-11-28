import { z } from "zod";
import type { GameState } from "./engine.ts";
import type { EconomyReport } from "./economy.ts";
import { elapsedTicks, TICKS_PER_WEEK } from "./time.ts";

export const reserveDischargeSchema = z.object({
  payer: z.string(),
  site: z.string(),
  people: z.int().positive(),
  through: z.int().positive(),
  ticks: z.int().positive().max(TICKS_PER_WEEK - 1),
});
export type ReserveDischarge = z.infer<typeof reserveDischargeSchema>;

export function recordReserveDischarge(state: GameState, report: EconomyReport) {
  const dispute = state.borderDispute!;
  const through = elapsedTicks(state);
  const ticksSinceClose = through % TICKS_PER_WEEK;
  if (!ticksSinceClose) return state;
  const weekStart = through - ticksSinceClose;
  const records = Object.entries(report.states).flatMap(([site, { conscripts }]) => {
    if (conscripts === 0) return [];
    const owner = state.ownerByStateId[site];
    const order = dispute.mobilization?.[owner];
    const opened = order ? elapsedTicks({ elapsedDays: order.orderedDay, tickInDay: order.orderedTickInDay ?? 0 }) : weekStart;
    const ticks = through - Math.max(weekStart, opened);
    if (ticks === 0) return [];
    const payer = state.civilWar?.countryId === dispute.defenderId && owner === dispute.claimantId ? dispute.defenderId : owner;
    return [{ payer, site, people: conscripts, through, ticks }];
  });
  return records.length ? { ...state, reserveDischarges: [...(state.reserveDischarges ?? []), ...records] } : state;
}
