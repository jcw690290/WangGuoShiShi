import { z } from "zod";
import { byIndustrialGood, byProductiveBuilding, industrialGoods, industries, productiveBuildings, productiveDefinitions } from "./industry.ts";
import type { ByIndustrialGood, IndustrialGood, ProductiveBuilding, ScenarioLevels } from "./industry.ts";
import { baseOrdinaryWage } from "./labor.ts";
import { productionFactors } from "./production-methods.ts";
import type { ProductionTier } from "./production-methods.ts";

export const industrySubsidyLimit = z.int().nonnegative();
export const industrySubsidyReportSchema = z.object({
  limit: industrySubsidyLimit.positive(),
  shortfall: industrySubsidyLimit,
  paid: industrySubsidyLimit,
}).refine(({ limit, shortfall, paid }) => paid <= Math.min(limit, shortfall));
export type IndustrySubsidyReport = z.infer<typeof industrySubsidyReportSchema>;

export const inputs = {
  grain: { tools: 1 },
  cloth: { fiber: 70, tools: 1 },
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
  steel: { iron: 40, coal: 30, tools: 1 },
  arms: { steel: 20, wood: 20, tools: 2 },
  ammo: { iron: 20, coal: 20, tools: 2 },
  shipGoods: { wood: 60, iron: 20, tools: 2 },
  electricity: { coal: 40, tools: 2, steel: 2 },
  oil: { steel: 2, tools: 2, coal: 5 },
  rubber: { tools: 2 },
  opium: { tools: 1 },
  cashCrops: { tools: 1 },
} satisfies Record<ProductiveBuilding, Readonly<Partial<ByIndustrialGood<number>>>>;
const units = z.int().nonnegative();
export const materialSchema = z.object({
  wood: units, iron: units, coal: units, tools: units, paper: units.default(0), services: units.default(0),
  food: units.default(0), fiber: units.default(0), dailyGoods: units.default(0), luxury: units.default(0),
  steel: units.default(0), arms: units.default(0), ammo: units.default(0), shipGoods: units.default(0), electricity: units.default(0),
  oil: units.default(0), rubber: units.default(0), opium: units.default(0),
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

const skilledPositions = {
  grain: [0, 0], cloth: [10, 180],
  wood: [0, 0], iron: [0, 0], coal: [0, 0], tools: [20, 180], paper: [20, 180], services: [50, 150],
  food: [0, 0], fiber: [0, 0], dailyGoods: [10, 180], luxury: [20, 180],
  steel: [20, 180], arms: [30, 180], ammo: [20, 180], shipGoods: [50, 180], electricity: [50, 180],
  oil: [30, 180], rubber: [0, 0], opium: [0, 0],
  cashCrops: [0, 0],
} satisfies Record<ProductiveBuilding, [number, number]>;
type Method = {
  jobs: number; output: number; recipe: Partial<ByIndustrialGood<number>>;
  skill: readonly [number, number]; power: number;
};
const normalMethods = byProductiveBuilding((good): Method => ({
  jobs: productiveDefinitions[good].jobs, output: productiveDefinitions[good].output, recipe: inputs[good], skill: skilledPositions[good], power: 0,
}));
export const electricRetrofits = { tools: "electrifyTools", steel: "electrifySteel" } as const;
export const electricIndustries = ["tools", "steel"] as const;
export const industrialRetrofits = {
  electrifyTools: { good: "tools", technology: "电气化", tier: "advanced" },
  electrifySteel: { good: "steel", technology: "电气化", tier: "advanced" },
  improveGrain: { good: "grain", technology: "农业改良", tier: "mechanized" },
  mechanizeTools: { good: "tools", technology: "机械工具", tier: "mechanized" },
  alloySteel: { good: "steel", technology: "先进材料", tier: "advanced" },
} as const;
type IndustrialRetrofit = keyof typeof industrialRetrofits;
export const isIndustrialRetrofit = (project: string): project is IndustrialRetrofit =>
  Object.hasOwn(industrialRetrofits, project);

const electricMethods = {
  tools: { jobs: 55, output: 184, recipe: { iron: 54, wood: 36, coal: 9 }, skill: [40, 180], power: 35 },
  steel: { jobs: 55, output: 138, recipe: { iron: 72, coal: 54, tools: 1.8 }, skill: [40, 180], power: 50 },
} satisfies Record<(typeof electricIndustries)[number], Method>;

export function industryMethod(good: ProductiveBuilding, electric = false): Method {
  return electric && (good === "tools" || good === "steel") ? electricMethods[good] : normalMethods[good];
}

type SiteMethods = Record<IndustrialRetrofit, number> & { productionMethods?: Partial<Record<ProductiveBuilding, ProductionTier>> };
export function productionTierAt(good: ProductiveBuilding, site: SiteMethods): ProductionTier {
  const selected = site.productionMethods?.[good];
  if (selected) return selected;
  if ((good === "tools" && site.electrifyTools) || (good === "steel" && (site.electrifySteel || site.alloySteel)))
    return "advanced";
  if ((good === "grain" && site.improveGrain) || (good === "tools" && site.mechanizeTools)) return "mechanized";
  return "base";
}

export function industryMethodAt(good: ProductiveBuilding, site: SiteMethods): Method {
  return productionMethod(good, productionTierAt(good, site));
}

export function productionMethod(good: ProductiveBuilding, tier: ProductionTier): Method {
  const base = normalMethods[good];
  if (tier === "base") return base;
  const factor = productionFactors[tier], mechanized = tier === "mechanized";
  const recipe: Partial<ByIndustrialGood<number>> = {};
  for (const [material, units] of Object.entries(base.recipe))
    recipe[material as IndustrialGood] = units * factor.inputs;
  if (mechanized || good === "electricity") recipe.coal = (recipe.coal ?? 0) + (mechanized ? 3 : 5);
  return {
    jobs: Math.round(base.jobs * factor.jobs), output: Math.round(base.output * factor.output), recipe,
    skill: [Math.min(100, base.skill[0] + (mechanized ? 10 : 20)), mechanized ? Math.max(180, base.skill[1]) : 250],
    power: mechanized || good === "electricity" ? 0 : good === "steel" ? 50 : 35,
  };
}

export const electricityUse = (method: Method, workers: number) => Math.ceil(workers * method.power / method.jobs);

export function industrialPayroll(good: ProductiveBuilding, employed: number, method = industryMethod(good), ordinaryWage = baseOrdinaryWage) {
  const [perHundred, wage] = method.skill;
  const skilled = Math.ceil(employed * perHundred / 100);
  const skilledWages = skilled * wage;
  return { skilled, skilledWages, total: (employed - skilled) * ordinaryWage + skilledWages };
}

export function trainedLabourCapacity(good: ProductiveBuilding, trained: number, method = industryMethod(good)) {
  const [perHundred] = method.skill;
  return perHundred > 0 ? Math.floor(trained * 100 / perHundred) : Infinity;
}

export function affordableIndustryWorkers(good: ProductiveBuilding, capital: number, method = industryMethod(good),
  powerPrice = 0, ordinaryWage = baseOrdinaryWage,
) {
  if (powerPrice > 0 && method.power > 0) {
    let low = 0, high = Math.floor(capital / ordinaryWage);
    while (low < high) {
      const count = Math.ceil((low + high) / 2);
      if (industrialPayroll(good, count, method, ordinaryWage).total + electricityUse(method, count) * powerPrice <= capital) low = count;
      else high = count - 1;
    }
    return low;
  }
  const wage = industrialPayroll(good, 100, method, ordinaryWage).total / 100;
  let estimated = Math.floor(capital / wage);
  while (industrialPayroll(good, estimated, method, ordinaryWage).total > capital) estimated -= 1;
  return estimated;
}

export function workingCapitalPerLevel(good: ProductiveBuilding, method = industryMethod(good), ordinaryWage = baseOrdinaryWage) {
  const { recipe } = method;
  const materialCost = industrialGoods.reduce((sum, material) =>
    sum + (recipe[material] ?? 0) * industries[material].basePrice, 0);
  return Math.ceil(4 * (materialCost + industrialPayroll(good, method.jobs, method, ordinaryWage).total +
    method.power * industries.electricity.basePrice));
}

export function workingCapitalTarget(levels: ScenarioLevels, methods = normalMethods, ordinaryWage = baseOrdinaryWage) {
  return productiveBuildings.reduce((sum, good) => sum + (levels[good] ?? 0) * workingCapitalPerLevel(good, methods[good], ordinaryWage), 0);
}

export function initialIndustrialAccount(levels: ScenarioLevels): IndustrialAccount | undefined {
  if (!productiveBuildings.some((good) => (levels[good] ?? 0) > 0)) return;
  const stocks = byIndustrialGood(() => 0);
  for (const good of productiveBuildings) {
    const recipe: Readonly<Partial<ByIndustrialGood<number>>> = inputs[good];
    for (const material of industrialGoods) stocks[material] += (recipe[material] ?? 0) * (levels[good] ?? 0);
  }
  return { capital: workingCapitalTarget(levels), stocks };
}

export function materialWorkers(good: ProductiveBuilding, planned: number, stocks: ByIndustrialGood<number>, method = industryMethod(good)) {
  const { recipe, jobs: jobsPerLevel } = method;
  let employed = planned;
  for (const material of industrialGoods) {
    const needed = recipe[material];
    if (needed !== undefined) employed = Math.min(employed, Math.floor(stocks[material] * jobsPerLevel / needed));
  }
  return employed;
}

export function operateIndustry(
  good: ProductiveBuilding, planned: number, stocks: ByIndustrialGood<number>, restock: ByIndustrialGood<number>,
  method = industryMethod(good), limit = planned,
) {
  if (planned === 0) return 0;
  const { recipe, jobs: jobsPerLevel } = method;
  const employed = materialWorkers(good, Math.min(planned, limit), stocks, method);
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
