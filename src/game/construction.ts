import { z } from "zod";
import type { ByGood } from "./industry.ts";
import type { Project } from "./economy.ts";
import { TICKS_PER_WEEK } from "./time.ts";

export const constructionJobs = 100;
export const constructionWage = 100;
export const constructionPointsPerLevel = 10;
const standbyStaffShare = 0.10;
const workersPerMaintenanceTool = 10;
export const constructionMaterials = ["wood", "tools", "iron"] as const;
type Material = typeof constructionMaterials[number];
type Materials = Record<Material, number>;
const recipe: Materials = { wood: 20, tools: 5, iron: 5 };

const projectTick = z.int().nonnegative();
export const constructionTiming = {
  startedAtTick: projectTick.optional(),
  cancelledAtTick: projectTick.optional(),
};

export const activeConstruction = (project: Project) => project.cancelledAtTick === undefined;

export function validConstructionTiming(project: Project, tick: number) {
  const opening = tick - tick % TICKS_PER_WEEK;
  const { startedAtTick, cancelledAtTick } = project;
  return (startedAtTick === undefined || (startedAtTick > opening && startedAtTick <= tick)) &&
    (cancelledAtTick === undefined || (cancelledAtTick > (startedAtTick ?? opening) && cancelledAtTick <= tick));
}

export function constructionDuty(queue: readonly Project[], closingTick: number | undefined,
  canWork: (project: Project) => boolean, remainingPoints: (project: Project) => number) {
  const opening = (closingTick ?? TICKS_PER_WEEK) - TICKS_PER_WEEK;
  const windows = queue.flatMap((project) => {
    if (!canWork(project) || (closingTick === undefined && !activeConstruction(project))) return [];
    const starts = closingTick === undefined ? 0 : Math.max(0, (project.startedAtTick ?? opening) - opening);
    const ends = closingTick === undefined ? TICKS_PER_WEEK : Math.min(TICKS_PER_WEEK, (project.cancelledAtTick ?? closingTick) - opening);
    return starts < ends ? [{ project, starts, ends, required: remainingPoints(project) }] : [];
  });
  const ticks = Array.from({ length: TICKS_PER_WEEK }, (_, tick) => tick)
    .filter((tick) => windows.some(({ starts, ends }) => starts <= tick && tick < ends));
  const requestedWorkers = Math.ceil(windows.reduce((sum, window) => sum + window.required, 0) *
    constructionJobs / constructionPointsPerLevel);
  return { ticks, windows, requestedWorkers };
}

export function allocateConstructionPoints(duty: ReturnType<typeof constructionDuty>, points: number) {
  const assigned = new Map<Project, number>();
  const { ticks, windows } = duty;
  const fullWeek = windows.every(({ starts, ends }) => starts === 0 && ends === TICKS_PER_WEEK);
  const spend = (at: number, available: number) => {
    for (const { project, starts, ends, required } of windows) {
      if (available <= 0) break;
      if (at < starts || at >= ends) continue;
      const previous = assigned.get(project) ?? 0;
      const used = Math.min(available, required - previous);
      assigned.set(project, Math.min(required, previous + used));
      available -= used;
    }
  };
  if (fullWeek) spend(0, points);
  else for (const tick of ticks) spend(tick, points / ticks.length);
  return assigned;
}

const bill = z.object({ wages: z.int().nonnegative(), materials: z.int().nonnegative(), points: z.number().nonnegative(),
  wageRate: z.int().positive().optional() });
const materialStock = z.record(z.enum(constructionMaterials), z.int().nonnegative());
export const constructionStockSchema = z.object({ public: materialStock, private: materialStock });
export type ConstructionStock = z.infer<typeof constructionStockSchema>;
export const constructionReportSchema = z.object({ public: bill, private: bill });
export type ConstructionReport = z.infer<typeof constructionReportSchema>;
export const constructionMaintenanceSchema = z.object({
  workers: z.int().nonnegative(),
  wages: z.int().nonnegative(),
  wageRate: z.int().positive().optional(),
  tools: z.int().nonnegative(),
  materials: z.int().nonnegative(),
}).refine(({ workers, wages, wageRate, tools, materials }) =>
  wages === workers * (wageRate ?? constructionWage) &&
  (workers > 0 || tools === 0) &&
  (tools > 0 || materials === 0));
export type ConstructionMaintenance = z.infer<typeof constructionMaintenanceSchema>;
export type ConstructionSector = keyof ConstructionReport;
export const constructionSectors = ["public", "private"] as const;

export function emptyConstructionReport(): ConstructionReport {
  return { public: { wages: 0, materials: 0, points: 0 }, private: { wages: 0, materials: 0, points: 0 } };
}

export function constructionSpending(bill: Pick<ConstructionReport[ConstructionSector], "wages" | "materials">) {
  return bill.wages + bill.materials;
}

export function planConstructionMaintenance(unusedSlots: number, cash: number, toolCeiling: number, wage = constructionWage) {
  const jobs = Math.floor(unusedSlots * standbyStaffShare);
  const groupCost = workersPerMaintenanceTool * wage + toolCeiling;
  const groups = Math.min(Math.floor(jobs / workersPerMaintenanceTool), Math.floor(cash / groupCost));
  const staff = groups * workersPerMaintenanceTool;
  const partial = Math.max(0, Math.floor((cash - groups * groupCost - toolCeiling) / wage));
  const workers = staff + Math.min(jobs - staff, partial);
  const tools = Math.ceil(workers / workersPerMaintenanceTool);
  const wages = workers * wage;
  return { workers, tools, wages, reserved: wages + tools * toolCeiling };
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

export function reserveCrew(workers: number, ceilings: ByGood<number>, stock: Materials, wage = constructionWage) {
  const order = materialOrder(workers, stock);
  return constructionMaterials.reduce((sum, good) => sum + order[good] * ceilings[good], workers * wage);
}

export function affordableCrew(max: number, cash: number, ceilings: ByGood<number>, stock: Materials, wage = constructionWage) {
  let low = 0, high = Math.min(max, Math.floor(cash / wage));
  while (low < high) {
    const size = Math.ceil((low + high) / 2);
    if (reserveCrew(size, ceilings, stock, wage) <= cash) low = size;
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
  workers: number, stock: Materials, delivered: Materials, materials: number, efficiency: number, wage = constructionWage,
) {
  const required = crewMaterials(workers), remaining = crewMaterials(0), used = crewMaterials(0);
  for (const good of constructionMaterials) remaining[good] = stock[good] + delivered[good];
  const fraction = workers > 0
    ? Math.min(1, ...constructionMaterials.map((good) => remaining[good] / required[good])) : 0;
  for (const good of constructionMaterials) {
    used[good] = Math.min(remaining[good], Math.ceil(required[good] * fraction));
    remaining[good] -= used[good];
  }
  return { bill: { wages: workers * wage, materials, ...(wage === constructionWage ? {} : { wageRate: wage }),
    points: workers * constructionPointsPerLevel / constructionJobs * efficiency * fraction }, remaining, used };
}
