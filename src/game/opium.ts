import { z } from "zod";
import type { GameState } from "./engine.ts";

export const opiumBurdenSchema = z.number().min(0).max(100);
export const opiumLaws = ["鸦片许可经营", "鸦片限医疗", "鸦片禁令"] as const;
export const isOpiumLaw = (law: string) => (opiumLaws as readonly string[]).includes(law);
export const opiumLaw = (laws: readonly string[]) => opiumLaws.find((law) => laws.includes(law)) ?? opiumLaws[0];
export const opiumCommerceAllowed = (laws: readonly string[]) => opiumLaw(laws) !== "鸦片禁令";
const units = z.int().nonnegative();
export const opiumReportSchema = z.object({
  recoverySupport: z.number().min(0).max(1).optional(),
  medical: z.object({ ordered: units, delivered: units, spending: units }),
  nonMedical: z.object({ ordered: units, consumed: units, budget: units, spending: units }),
  illicit: z.object({ attempted: units, seized: units, delivered: units, spending: units }).optional(),
}).refine(({ medical, nonMedical, illicit }) => medical.delivered <= medical.ordered &&
  nonMedical.consumed <= nonMedical.ordered && nonMedical.spending <= nonMedical.budget &&
  (!illicit || (illicit.attempted === illicit.seized + illicit.delivered && illicit.delivered <= nonMedical.consumed &&
    illicit.spending <= nonMedical.spending)));
export type OpiumReport = z.infer<typeof opiumReportSchema>;

export const opiumSmugglingSchema = z.object({
  from: z.string(), to: z.string(), exporter: z.string(), importer: z.string(), mode: z.enum(["land", "sea"]),
  attempted: units.positive(), seized: units, delivered: units, spending: units, lostValue: units,
}).refine((shipment) => shipment.attempted === shipment.seized + shipment.delivered && shipment.from !== shipment.to &&
  shipment.exporter !== shipment.importer && (shipment.delivered === 0) === (shipment.spending === 0) &&
  (shipment.seized === 0) === (shipment.lostValue === 0));
export type OpiumSmuggling = z.infer<typeof opiumSmugglingSchema>;
export const opiumLossSchema = z.object({
  exporter: z.string(), importer: z.string(), stateId: z.string(), amount: units.positive(), day: units,
}).refine((loss) => loss.exporter !== loss.importer);
export type OpiumLoss = z.infer<typeof opiumLossSchema>;
export const minOpiumClaim = 5_000;
const lossWindow = 180;
export const opiumLossKey = ({ exporter, importer, stateId, day }: OpiumLoss) => JSON.stringify([exporter, importer, stateId, day]);

export function recordOpiumLosses(state: GameState, seizures: readonly OpiumSmuggling[]) {
  const day = state.elapsedDays;
  const losses = new Map((state.opiumLosses ?? []).filter((loss) => loss.day !== day && day - loss.day < lossWindow)
    .map((loss) => [opiumLossKey(loss), loss]));
  for (const { exporter, importer, to: stateId, lostValue } of seizures) {
    if (lostValue === 0) continue;
    const entry = { exporter, importer, stateId, amount: lostValue, day };
    const key = opiumLossKey(entry);
    const earlier = losses.get(key);
    losses.set(key, earlier ? { ...entry, amount: earlier.amount + lostValue } : entry);
  }
  return losses.size > 0 ? [...losses.values()] : undefined;
}

export function recentOpiumLosses(state: GameState, countryId: string) {
  const claims = new Map<string, number>();
  for (const entry of state.opiumLosses ?? []) {
    if (entry.exporter !== countryId || state.elapsedDays - entry.day >= lossWindow ||
        state.ownerByStateId[entry.stateId] !== entry.importer) continue;
    claims.set(entry.stateId, (claims.get(entry.stateId) ?? 0) + entry.amount);
  }
  return claims;
}

export function planOpium(population: number, burden: number, exposed: boolean, law: ReturnType<typeof opiumLaw>, medicalStaff: number,
  householdCash: number, publicCash: number, price: number, illicitExposure: boolean) {
  const householdLimit = Math.floor(householdCash * (0.008 + 0.0012 * burden));
  const habitualOrders = Math.floor(population / 1000 * (0.35 + 0.016 * burden));
  const affordable = Math.floor(householdLimit / price);
  const nonMedical = exposed && law === "鸦片许可经营" ? Math.min(habitualOrders, affordable) : 0;
  const illicit = illicitExposure ? Math.min(affordable, Math.floor(population / 1000 * 0.010 * burden)) : 0;
  const medical = exposed && law !== "鸦片禁令" ? Math.min(Math.ceil(medicalStaff / 15), Math.floor(publicCash / price)) : 0;
  return { medical, nonMedical, illicit, householdReserve: (nonMedical + illicit) * price, medicalReserve: medical * price };
}

export function advanceOpiumBurden(burden: number, consumed: number, population: number, recoverySupport: number) {
  const next = Math.min(100, (0.965 - 0.08 * recoverySupport) * burden + 1150 * consumed / population);
  return next < 0.01 ? 0 : next;
}

export function opiumEffects(burden: number | undefined) {
  const intensity = (burden ?? 0) / 100;
  return { workforce: 1 - 0.18 * intensity, mortality: 0.012 * intensity, unrest: 16 * intensity, military: 1 - 0.12 * intensity };
}
