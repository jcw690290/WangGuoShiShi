import { z } from "zod";
import { administrationDemandMultiplier, governanceOf, localGovernanceRule } from "./governance.ts";
import { industries } from "./industry.ts";
import { institutionLawLimit, institutions } from "./institutions.ts";
import type { Difficulty } from "./settings.ts";
import type { Law, SiteSocial } from "./society.ts";

const staffPerLevel = 100;
const archiveStaffPerLevel = 50;
export const officeStaffCapacity = (offices: number, archive: boolean) =>
  offices * (staffPerLevel + (archive ? archiveStaffPerLevel : 0));
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

export function officeNeed(population: number, site: SiteSocial, difficulty: Difficulty, laws: readonly Law[],
  institutionLevels = institutions.reduce((total, kind) => total + Math.min(site[kind], institutionLawLimit(laws, kind)), 0)) {
  const { integrated } = governanceOf(site);
  return population / 10_000 * (1 + 0.15 * institutionLevels + (integrated ? 0 : 0.30)) *
    localGovernanceRule(site, laws).administrationCost * administrationDemandMultiplier(difficulty);
}

function productionInputs(staff: number, salary: number) {
  return {
    wages: staff * salary,
    paperDemand: Math.ceil(staff * materialsPerLevel.paper / staffPerLevel),
    serviceDemand: Math.ceil(staff * materialsPerLevel.services / staffPerLevel),
  };
}

function reserveFor(staff: number, salary: number) {
  const inputs = productionInputs(staff, salary);
  return inputs.wages + inputs.paperDemand * maximumPrice.paper + inputs.serviceDemand * maximumPrice.services;
}

export function planOffice(need: number, offices: number, specialists: number, treasury: number, archive = false, salary = wage) {
  const capacity = Math.min(Math.ceil(need), officeStaffCapacity(offices, archive), specialists);
  let affordable = 0, upper = capacity;
  while (affordable < upper) {
    const mid = Math.ceil((affordable + upper) / 2);
    if (reserveFor(mid, salary) <= treasury) affordable = mid;
    else upper = mid - 1;
  }
  const inputs = productionInputs(affordable, salary);
  return { need, staff: affordable, ...inputs, reserved: reserveFor(affordable, salary) };
}

export function deliverOffice(
  plan: ReturnType<typeof planOffice>, paper: number, services: number, purchases: number,
): OfficeReport {
  const { need, staff, wages, paperDemand, serviceDemand } = plan;
  const supplied = staff > 0 ? Math.min(paper / paperDemand, services / serviceDemand) : 0;
  return { need, staff, wages, paperDemand, serviceDemand, paper, services, purchases,
    coverage: Math.min(1, staff * supplied / need) };
}
