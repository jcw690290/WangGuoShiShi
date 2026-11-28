import { z } from "zod";
import { productiveBuildings } from "./industry.ts";
import type { ByProductiveBuilding, ProductiveBuilding } from "./industry.ts";

export const ownershipKinds = ["PUBLIC", "PRIVATE", "LAND", "COOP"] as const;
export const ownershipSchema = z.enum(ownershipKinds);
export type Ownership = z.infer<typeof ownershipSchema>;
export const ownershipNames = { PUBLIC: "国有", PRIVATE: "私人", LAND: "土地所有", COOP: "合作" };
export const ownershipAmountsSchema = z.record(ownershipSchema, z.int().nonnegative());
export type OwnershipAmounts = z.infer<typeof ownershipAmountsSchema>;
export const emptyOwnershipAmounts = (): OwnershipAmounts => ({ PUBLIC: 0, PRIVATE: 0, LAND: 0, COOP: 0 });
export const industryOwnershipSchema = z.partialRecord(z.enum(productiveBuildings), ownershipAmountsSchema);
export type IndustryOwnership = z.infer<typeof industryOwnershipSchema>;

export const economicLaws = ["国家主导", "干预主义", "自由放任", "合作经济"] as const;
export const isEconomicLaw = (law: string) => (economicLaws as readonly string[]).includes(law);
export const economicLaw = (laws: readonly string[]) => economicLaws.find((law) => laws.includes(law)) ?? economicLaws[0];
const rates = {
  国家主导: { privateConstruction: 0.20, privateReinvestment: 0.10 },
  干预主义: { privateConstruction: 0.50, privateReinvestment: 0.25 },
  自由放任: { privateConstruction: 0.75, privateReinvestment: 0.40 },
  合作经济: { privateConstruction: 0.50, privateReinvestment: 0.10 },
};
export const economicOwnershipRules = (laws: readonly string[]) => rates[economicLaw(laws)];

export function openingOwnership(good: ProductiveBuilding): Ownership {
  if (good === "grain" || good === "fiber" || good === "rubber" || good === "cashCrops") return "LAND";
  if (good === "arms" || good === "ammo" || good === "electricity") return "PUBLIC";
  return "PRIVATE";
}

export function projectOwnership(good: ProductiveBuilding, laws: readonly string[], privateBuild: boolean): Ownership {
  if (!privateBuild) return "PUBLIC";
  if (economicLaw(laws) === "合作经济") return "COOP";
  return openingOwnership(good) === "LAND" ? "LAND" : "PRIVATE";
}

export function ownedLevels(good: ProductiveBuilding, levels: number, ownership: IndustryOwnership | undefined): OwnershipAmounts {
  return ownership?.[good] ?? { ...emptyOwnershipAmounts(), [openingOwnership(good)]: levels };
}

export function allocateIndustrialSurplus(surplus: number, margins: ByProductiveBuilding<number>, buildings: ByProductiveBuilding<number>,
  ownership: IndustryOwnership | undefined,
): OwnershipAmounts {
  const weights = emptyOwnershipAmounts();
  const hasProfit = productiveBuildings.some((good) => buildings[good] > 0 && margins[good] > 0);
  for (const good of productiveBuildings) {
    const levels = buildings[good];
    if (levels === 0) continue;
    const share = hasProfit ? Math.max(0, margins[good]) / levels : 1;
    const owned = ownedLevels(good, levels, ownership);
    for (const kind of ownershipKinds) weights[kind] += owned[kind] * share;
  }
  const total = ownershipKinds.reduce((sum, kind) => sum + weights[kind], 0);
  const shares = emptyOwnershipAmounts();
  if (total === 0) return { ...shares, PRIVATE: surplus };
  let cumulative = 0, allocated = 0;
  for (const kind of ownershipKinds) {
    cumulative += weights[kind];
    const target = Math.round(surplus * cumulative / total);
    shares[kind] = target - allocated;
    allocated = target;
  }
  return shares;
}
