import { z } from "zod";
import type { ByGood } from "./industry.ts";

export const constructionJobs = 100;
export const constructionWage = 100;
export const constructionPointsPerLevel = 10;
export const constructionMaterials = ["wood", "tools", "iron"] as const;
type Material = typeof constructionMaterials[number];
type Materials = Record<Material, number>;
const recipe: Materials = { wood: 20, tools: 5, iron: 5 };

const bill = z.object({ wages: z.int().nonnegative(), materials: z.int().nonnegative(), points: z.number().nonnegative() });
const materialStock = z.record(z.enum(constructionMaterials), z.int().nonnegative());
export const constructionStockSchema = z.object({ public: materialStock, private: materialStock });
export type ConstructionStock = z.infer<typeof constructionStockSchema>;
export const constructionReportSchema = z.object({ public: bill, private: bill });
export type ConstructionReport = z.infer<typeof constructionReportSchema>;
export type ConstructionSector = keyof ConstructionReport;
export const constructionSectors = ["public", "private"] as const;

export function emptyConstructionReport(): ConstructionReport {
  return { public: { wages: 0, materials: 0, points: 0 }, private: { wages: 0, materials: 0, points: 0 } };
}

export function constructionSpending(bill: ConstructionReport[ConstructionSector]) {
  return bill.wages + bill.materials;
}

export function crewMaterials(workers: number): Materials {
  return {
    wood: Math.ceil(workers * recipe.wood / constructionJobs),
    tools: Math.ceil(workers * recipe.tools / constructionJobs),
    iron: Math.ceil(workers * recipe.iron / constructionJobs),
  };
}

export function materialOrder(workers: number, stock: Materials) {
  const order = crewMaterials(workers);
  for (const good of constructionMaterials) order[good] = Math.max(0, order[good] - stock[good]);
  return order;
}

export function reserveCrew(workers: number, ceilings: ByGood<number>, stock: Materials) {
  const order = materialOrder(workers, stock);
  return constructionMaterials.reduce((sum, good) => sum + order[good] * ceilings[good], workers * constructionWage);
}

export function affordableCrew(max: number, cash: number, ceilings: ByGood<number>, stock: Materials) {
  let low = 0, high = Math.min(max, Math.floor(cash / constructionWage));
  while (low < high) {
    const size = Math.ceil((low + high) / 2);
    if (reserveCrew(size, ceilings, stock) <= cash) low = size;
    else high = size - 1;
  }
  return low;
}

export function shareCrew(jobs: number, privateShare: number, publicLimit: number, privateLimit: number) {
  const privateFirst = Math.min(privateLimit, Math.round(jobs * privateShare));
  const publicJobs = Math.min(publicLimit, jobs - privateFirst);
  return { public: publicJobs, private: Math.min(privateLimit, jobs - publicJobs) };
}

export function deliverConstruction(
  workers: number, stock: Materials, delivered: Materials, materials: number, efficiency: number,
) {
  const required = crewMaterials(workers), remaining = crewMaterials(0), used = crewMaterials(0);
  for (const good of constructionMaterials) remaining[good] = stock[good] + delivered[good];
  const fraction = workers > 0
    ? Math.min(1, ...constructionMaterials.map((good) => remaining[good] / required[good])) : 0;
  for (const good of constructionMaterials) {
    used[good] = Math.min(remaining[good], Math.ceil(required[good] * fraction));
    remaining[good] -= used[good];
  }
  return { bill: { wages: workers * constructionWage, materials,
    points: workers * constructionPointsPerLevel / constructionJobs * efficiency * fraction }, remaining, used };
}
