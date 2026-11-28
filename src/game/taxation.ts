import { z } from "zod";
import type { Nation } from "./society.ts";

export const taxLaws = ["传统土地身份税", "比例所得税", "累进所得税", "消费税制"] as const;
export const isTaxLaw = (law: string) => law === "工资税改革" || (taxLaws as readonly string[]).includes(law);
export const taxBands = ["veryLow", "low", "standard", "high", "veryHigh"] as const;
export const taxBandSchema = z.enum(taxBands);
export const taxBandNames = { veryLow: "很低", low: "低", standard: "标准", high: "高", veryHigh: "很高" };
const bandMultipliers = { veryLow: 0.60, low: 0.80, standard: 1, high: 1.20, veryHigh: 1.40 };

export const exciseGoods = ["dailyGoods", "luxury"] as const;
export const exciseGoodsSchema = z.array(z.enum(exciseGoods)).max(exciseGoods.length)
  .refine((goods) => new Set(goods).size === goods.length);

const incomeRates = {
  传统土地身份税: { 农民: 8, 劳工: 8, 工程师: 10, 文职: 10, 教士: 10, 店主: 10, 资本家: 10, 贵族: 18 },
  比例所得税: { 农民: 15, 劳工: 15, 工程师: 15, 文职: 15, 教士: 15, 店主: 15, 资本家: 15, 贵族: 15 },
  累进所得税: { 农民: 10, 劳工: 10, 工程师: 18, 文职: 18, 教士: 18, 店主: 18, 资本家: 28, 贵族: 28 },
  消费税制: { 农民: 5, 劳工: 5, 工程师: 5, 文职: 5, 教士: 5, 店主: 5, 资本家: 5, 贵族: 5 },
  工资税改革: { 农民: 5, 劳工: 14, 工程师: 14, 文职: 14, 教士: 14, 店主: 5, 资本家: 5, 贵族: 5 },
} as const;
export type TaxSystem = keyof typeof incomeRates;
export type HouseholdIncome = Record<keyof typeof incomeRates.传统土地身份税, number>;
export const emptyHouseholdIncome = (): HouseholdIncome => ({
  农民: 0, 劳工: 0, 工程师: 0, 文职: 0, 教士: 0, 店主: 0, 资本家: 0, 贵族: 0,
});
const systems = [...taxLaws, "工资税改革"] as const;
export function taxPolicy(nation: Nation) {
  const system = systems.find((law) => nation.laws.includes(law)) ?? "传统土地身份税";
  const multiplier = bandMultipliers[nation.taxBand];
  const exciseRate = system === "消费税制" ? multiplier * 0.10 : 0;
  return { system, multiplier, exciseRate, excise: nation.exciseGoods };
}

export const exciseOn = (policy: ReturnType<typeof taxPolicy>, good: string) =>
  (policy.excise as readonly string[]).includes(good) ? policy.exciseRate : 0;

export function settleIncomeTax(income: HouseholdIncome, policy: ReturnType<typeof taxPolicy>, collection: number) {
  const rates = incomeRates[policy.system];
  return Object.fromEntries(Object.entries(income).map(([occupation, earned]) => [
    occupation, Math.floor(earned * rates[occupation as keyof HouseholdIncome] * policy.multiplier * collection / 100),
  ])) as HouseholdIncome;
}

export const taxReceiptSchema = z.object({
  system: z.enum(systems),
  band: taxBandSchema,
  income: z.int().nonnegative(),
  excise: z.int().nonnegative(),
});
