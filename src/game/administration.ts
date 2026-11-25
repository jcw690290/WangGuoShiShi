import { z } from "zod";
import { administrationDemandMultiplier, governanceOf, governanceRules } from "./governance.ts";
import { industries } from "./industry.ts";
import type { Difficulty } from "./settings.ts";
import type { Nation, SiteSocial } from "./society.ts";

const staffPerLevel = 100;
const wage = 150;
const materialsPerLevel = { paper: 8, services: 2 };
const maximumPrice = {
  paper: Math.ceil(industries.paper.basePrice * 1.75),
  services: Math.ceil(industries.services.basePrice * 1.75),
};
const quantity = z.int().nonnegative();
export const officeReportSchema = z.object({
  need: z.number().positive(),
  staff: quantity,
  wages: quantity,
  paperDemand: quantity,
  serviceDemand: quantity,
  paper: quantity,
  services: quantity,
  purchases: quantity,
  coverage: z.number().min(0).max(1),
}).refine((report) => report.paper <= report.paperDemand && report.services <= report.serviceDemand);
export type OfficeReport = z.infer<typeof officeReportSchema>;

export function officeNeed(population: number, site: SiteSocial, nation: Nation, difficulty: Difficulty) {
  const { mode, integrated } = governanceOf(site);
  const education = nation.knowledge["高等教育"] === 100 ? 2 : nation.knowledge["公共教育"] === 100 ? 1 : 0;
  return population / 10_000 * (1 + 0.15 * education + (integrated ? 0 : 0.30)) *
    governanceRules[mode].administrationCost * administrationDemandMultiplier(difficulty);
}

function productionInputs(staff: number) {
  return {
    wages: staff * wage,
    paperDemand: Math.ceil(staff * materialsPerLevel.paper / staffPerLevel),
    serviceDemand: Math.ceil(staff * materialsPerLevel.services / staffPerLevel),
  };
}

function reserveFor(staff: number) {
  const inputs = productionInputs(staff);
  return inputs.wages + inputs.paperDemand * maximumPrice.paper + inputs.serviceDemand * maximumPrice.services;
}

export function planOffice(need: number, offices: number, specialists: number, treasury: number) {
  const capacity = Math.min(Math.ceil(need), offices * staffPerLevel, specialists);
  let affordable = 0, upper = capacity;
  while (affordable < upper) {
    const mid = Math.ceil((affordable + upper) / 2);
    if (reserveFor(mid) <= treasury) affordable = mid;
    else upper = mid - 1;
  }
  const inputs = productionInputs(affordable);
  return { need, staff: affordable, ...inputs, reserved: reserveFor(affordable) };
}

export function deliverOffice(
  plan: ReturnType<typeof planOffice>, paper: number, services: number, purchases: number,
): OfficeReport {
  const { need, staff, wages, paperDemand, serviceDemand } = plan;
  const supplied = staff > 0 ? Math.min(paper / paperDemand, services / serviceDemand) : 0;
  return { need, staff, wages, paperDemand, serviceDemand, paper, services, purchases,
    coverage: Math.min(1, staff * supplied / need) };
}
