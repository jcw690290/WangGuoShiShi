import { z } from "zod";

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
}).refine(({ medical, nonMedical }) => medical.delivered <= medical.ordered &&
  nonMedical.consumed <= nonMedical.ordered && nonMedical.spending <= nonMedical.budget);
export type OpiumReport = z.infer<typeof opiumReportSchema>;

export function planOpium(population: number, burden: number, exposed: boolean, law: ReturnType<typeof opiumLaw>, medicalStaff: number,
  householdCash: number, publicCash: number, price: number) {
  if (!exposed || law === "鸦片禁令") return { medical: 0, nonMedical: 0, householdReserve: 0, medicalReserve: 0 };
  const householdLimit = Math.floor(householdCash * (0.008 + 0.0012 * burden));
  const habitualOrders = Math.floor(population / 1000 * (0.35 + 0.016 * burden));
  const nonMedical = law === "鸦片许可经营" ? Math.min(habitualOrders, Math.floor(householdLimit / price)) : 0;
  const medical = Math.min(Math.ceil(medicalStaff / 15), Math.floor(publicCash / price));
  return { medical, nonMedical, householdReserve: nonMedical * price, medicalReserve: medical * price };
}

export function advanceOpiumBurden(burden: number, consumed: number, population: number, recoverySupport: number) {
  const next = Math.min(100, (0.965 - 0.08 * recoverySupport) * burden + 1150 * consumed / population);
  return next < 0.01 ? 0 : next;
}

export function opiumEffects(burden: number | undefined) {
  const intensity = (burden ?? 0) / 100;
  return { workforce: 1 - 0.18 * intensity, mortality: 0.012 * intensity, unrest: 16 * intensity, military: 1 - 0.12 * intensity };
}
