import { z } from "zod";
import { byIndustrialGood, industrialGoods, industries } from "./industry.ts";
import type { ByIndustrialGood, IndustrialGood, ScenarioLevels } from "./industry.ts";

export const inputs = {
  wood: { tools: 2 },
  iron: { tools: 3 },
  coal: { tools: 3 },
  tools: { iron: 30, wood: 20, coal: 5 },
} satisfies Record<IndustrialGood, Readonly<Partial<ByIndustrialGood<number>>>>;
const units = z.int().nonnegative();
export const materialSchema = z.object(byIndustrialGood(() => units));
export const industrialAccountSchema = z.object({ capital: units, stocks: materialSchema });
export type IndustrialAccount = z.infer<typeof industrialAccountSchema>;
export const industrialReportSchema = industrialAccountSchema.extend({
  used: materialSchema, bought: materialSchema, spent: units, sales: units, distributed: units,
});
export type IndustrialReport = z.infer<typeof industrialReportSchema>;

export function emptyIndustrialAccount(): IndustrialAccount {
  return { capital: 0, stocks: byIndustrialGood(() => 0) };
}

export const industrialWagePerJob = (good: IndustrialGood) => good === "tools" ? 116 : 100;

export function workingCapitalPerLevel(good: IndustrialGood) {
  const recipe: Readonly<Partial<ByIndustrialGood<number>>> = inputs[good];
  const materialCost = industrialGoods.reduce((sum, material) =>
    sum + (recipe[material] ?? 0) * industries[material].basePrice, 0);
  return 4 * (materialCost + industries[good].jobs * industrialWagePerJob(good));
}

export function workingCapitalTarget(levels: ScenarioLevels) {
  return industrialGoods.reduce((sum, good) => sum + (levels[good] ?? 0) * workingCapitalPerLevel(good), 0);
}

export function initialIndustrialAccount(levels: ScenarioLevels): IndustrialAccount | undefined {
  if (!industrialGoods.some((good) => (levels[good] ?? 0) > 0)) return;
  const stocks = byIndustrialGood(() => 0);
  for (const good of industrialGoods) {
    const recipe: Readonly<Partial<ByIndustrialGood<number>>> = inputs[good];
    for (const material of industrialGoods) stocks[material] += (recipe[material] ?? 0) * (levels[good] ?? 0);
  }
  return { capital: workingCapitalTarget(levels), stocks };
}

export function operateIndustry(
  good: IndustrialGood, planned: number, stocks: ByIndustrialGood<number>, restock: ByIndustrialGood<number>,
) {
  const recipe: Readonly<Partial<ByIndustrialGood<number>>> = inputs[good];
  const jobsPerLevel = industries[good].jobs;
  let employed = planned;
  for (const material of industrialGoods) {
    const needed = recipe[material];
    if (needed !== undefined) employed = Math.min(employed, Math.floor(stocks[material] * jobsPerLevel / needed));
  }
  for (const material of industrialGoods) {
    const needed = recipe[material];
    if (needed === undefined) continue;
    stocks[material] -= Math.ceil(employed * needed / jobsPerLevel);
    restock[material] += Math.ceil(planned * needed / jobsPerLevel);
  }
  return employed;
}

export function fundedRestock(capital: number, stocks: ByIndustrialGood<number>, need: ByIndustrialGood<number>) {
  let remaining = capital;
  return byIndustrialGood((good) => {
    const highQuote = Math.ceil(industries[good].basePrice * 1.75);
    const ordered = Math.min(Math.max(0, need[good] - stocks[good]), Math.floor(remaining / highQuote));
    remaining -= ordered * highQuote;
    return ordered;
  });
}
