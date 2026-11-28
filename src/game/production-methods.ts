import { productiveBuildings, productiveDefinitions } from "./industry.ts";
import type { ProductiveBuilding } from "./industry.ts";

export const productionTiers = ["base", "mechanized", "advanced"] as const;
export type ProductionTier = typeof productionTiers[number];
export const productionTierNames = { base: "基础", mechanized: "机械化", advanced: "先进" };
export type ProductionProject = `method-${ProductionTier}-${ProductiveBuilding}`;

export const productionFactors = {
  base: { output: 1, inputs: 1, jobs: 1 },
  mechanized: { output: 1.6, inputs: 1.4, jobs: 0.75 },
  advanced: { output: 2.3, inputs: 1.8, jobs: 0.55 },
};
const methodTechnology = (good: ProductiveBuilding, tier: ProductionTier): "先进材料" | "农业改良" | "机械工具" | null => {
  if (tier === "base") return null;
  if (tier === "advanced") return "先进材料";
  return good === "grain" || good === "food" || good === "fiber" || good === "cashCrops" ? "农业改良" : "机械工具";
};
export const productionProject = (good: ProductiveBuilding, tier: ProductionTier): ProductionProject => `method-${tier}-${good}`;
export const productionProjects = productiveBuildings.flatMap((good) => productionTiers.map((tier) => productionProject(good, tier)));
export const productionProjectDefinitions = Object.fromEntries(productiveBuildings.flatMap((good) => productionTiers.map((tier) => [
  productionProject(good, tier),
  {
    good, tier, technology: methodTechnology(good, tier),
    cost: Math.round(productiveDefinitions[good].cost * (tier === "base" ? 0.4 : tier === "mechanized" ? 0.8 : 1.2)),
    weeks: tier === "base" ? 2 : tier === "mechanized" ? 4 : 5,
  },
]))) as Record<ProductionProject, {
  good: ProductiveBuilding; tier: ProductionTier; technology: ReturnType<typeof methodTechnology>; cost: number; weeks: number;
}>;
export const isProductionProject = (project: string): project is ProductionProject =>
  Object.hasOwn(productionProjectDefinitions, project);
