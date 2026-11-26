import { z } from "zod";
import { industries } from "./industry.ts";
import type { Good, ScenarioLevels } from "./industry.ts";
import type { Nation } from "./society.ts";

const cropGoods = ["grain", "food", "fiber"] as const;
export const croplandPerLegacyFarm = 200;
export function isCrop(good: string): good is typeof cropGoods[number] {
  return (cropGoods as readonly string[]).includes(good);
}

export function occupiedCropland(buildings: ScenarioLevels) {
  return cropGoods.reduce((used, good) => used + (buildings[good] ?? 0) * industries[good].jobs, 0);
}

export function reservedCropland(buildings: ScenarioLevels, projects: readonly { good: string; levels?: number }[]) {
  return projects.reduce((used, { good, levels = 1 }) => used + (isCrop(good) ? industries[good].jobs * levels : 0), occupiedCropland(buildings));
}

const quantity = z.int().nonnegative();
const stock = z.object({ grain: quantity, wood: quantity });
export const subsistenceReportSchema = z.object({
  cropland: quantity, occupied: quantity, employed: quantity,
  produced: stock, retained: stock, sold: stock,
  householdIncome: quantity, landRent: quantity, rentRate: z.literal([0, 20]),
}).refine(({ cropland, occupied, employed, produced, retained, sold }) =>
  occupied + employed <= cropland && retained.grain + sold.grain <= produced.grain &&
  retained.wood + sold.wood <= produced.wood);
export type SubsistenceReport = z.infer<typeof subsistenceReportSchema>;

export function rentRateOf(nation: Nation) {
  return nation.laws.includes("小农自耕") ? 0 : 20;
}

export function subsistenceHarvest(
  cropland: number, buildings: ScenarioLevels, ruralPeople: number,
  workers: number, ruralWorkers: number, outputEffect: number, rentRate: SubsistenceReport["rentRate"],
): SubsistenceReport {
  const occupied = occupiedCropland(buildings);
  const employed = Math.min(cropland - occupied, workers, ruralWorkers);
  const produced = { grain: Math.floor(employed * 0.8 * outputEffect), wood: Math.floor(employed * 0.1 * outputEffect) };
  const retained = {
    grain: Math.min(produced.grain, Math.round(ruralPeople * industries.grain.demandPerPerson)),
    wood: Math.min(produced.wood, Math.round(ruralPeople * industries.wood.demandPerPerson)),
  };
  return { cropland, occupied, employed, produced, retained, sold: { grain: 0, wood: 0 }, householdIncome: 0, landRent: 0, rentRate };
}

export function harvestGood(good: Good): good is "grain" | "wood" {
  return good === "grain" || good === "wood";
}
