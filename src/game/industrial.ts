import { z } from "zod";
import { byIndustrialGood, industrialGoods, industries } from "./industry.ts";
import type { ByIndustrialGood, IndustrialGood, ScenarioLevels } from "./industry.ts";

export const inputs = {
  wood: { tools: 2 },
  iron: { tools: 3 },
  coal: { tools: 3 },
  tools: { iron: 30, wood: 20, coal: 5 },
  paper: { wood: 40, coal: 10, tools: 1 },
  services: { paper: 2, tools: 1 },
  food: { tools: 1 },
  fiber: { tools: 1 },
  dailyGoods: { wood: 50, tools: 1 },
  luxury: { fiber: 20, dailyGoods: 30, paper: 4, tools: 2 },
} satisfies Record<IndustrialGood, Readonly<Partial<ByIndustrialGood<number>>>>;
const units = z.int().nonnegative();
export const materialSchema = z.object({
  wood: units, iron: units, coal: units, tools: units, paper: units.default(0), services: units.default(0),
  food: units.default(0), fiber: units.default(0), dailyGoods: units.default(0), luxury: units.default(0),
});
export const industrialAccountSchema = z.object({ capital: units, stocks: materialSchema });
export type IndustrialAccount = z.infer<typeof industrialAccountSchema>;
export const industrialReportSchema = industrialAccountSchema.extend({
  used: materialSchema, bought: materialSchema, spent: units, sales: units, distributed: units,
  skilledWages: units.optional(),
});
export type IndustrialReport = z.infer<typeof industrialReportSchema>;

export function emptyIndustrialAccount(): IndustrialAccount {
  return { capital: 0, stocks: byIndustrialGood(() => 0) };
}

const regularWage = 100;
const skilledPositions = {
  wood: [0, 0], iron: [0, 0], coal: [0, 0], tools: [20, 180], paper: [20, 180], services: [50, 150],
  food: [0, 0], fiber: [0, 0], dailyGoods: [10, 180], luxury: [20, 180],
} satisfies Record<IndustrialGood, [number, number]>;

export function industrialPayroll(good: IndustrialGood, employed: number) {
  const [perHundred, wage] = skilledPositions[good];
  const skilled = Math.ceil(employed * perHundred / 100);
  const skilledWages = skilled * wage;
  return { skilled, skilledWages, total: (employed - skilled) * regularWage + skilledWages };
}

export function trainedLabourCapacity(good: IndustrialGood, trained: number) {
  const [perHundred] = skilledPositions[good];
  return perHundred > 0 ? Math.floor(trained * 100 / perHundred) : Infinity;
}

export function affordableIndustryWorkers(good: IndustrialGood, capital: number) {
  const wage = industrialPayroll(good, 100).total / 100;
  const estimated = Math.floor(capital / wage);
  return industrialPayroll(good, estimated).total <= capital ? estimated : estimated - 1;
}

export function workingCapitalPerLevel(good: IndustrialGood) {
  const recipe: Readonly<Partial<ByIndustrialGood<number>>> = inputs[good];
  const materialCost = industrialGoods.reduce((sum, material) =>
    sum + (recipe[material] ?? 0) * industries[material].basePrice, 0);
  return 4 * (materialCost + industrialPayroll(good, industries[good].jobs).total);
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
