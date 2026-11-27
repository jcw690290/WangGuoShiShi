import type { Pop, Tech } from "./society.ts";

export const laborLawFamilies = {
  status: { name: "劳动身份", options: ["自由劳动", "奴隶制", "农奴制", "身份劳役"] },
  protection: { name: "劳动保护", options: ["普通雇佣", "工时与工伤保障", "集体劳动保障"] },
  rights: { name: "妇女权利", options: ["传统性别分工", "妇女就业权", "妇女平等权"] },
} as const;
const categories = Object.entries(laborLawFamilies);
export const laborLaws = Object.values(laborLawFamilies).flatMap(({ options }) => [...options]);
type LaborLaw = (typeof laborLaws)[number];
type LaborStatus = (typeof laborLawFamilies.status.options)[number];
const lawCategories = new Map<string, string>(categories.flatMap(([key, { options }]) =>
  options.map((law) => [law, key] as const)));
export const laborLawCategory = (law: string) => lawCategories.get(law);

export const laborLawTechnology: Partial<Record<string, Tech>> = {
  工时与工伤保障: "劳工保障", 集体劳动保障: "社会保障", 妇女就业权: "公共教育", 妇女平等权: "大众政治",
};
const startingStatus: Partial<Record<string, LaborStatus>> = {
  country_08: "奴隶制", country_09: "农奴制",
  country_24: "身份劳役", country_25: "身份劳役", country_29: "身份劳役",
};
export function startingLaborLaws(id: string): LaborLaw[] {
  return [startingStatus[id] ?? "自由劳动", "普通雇佣", "传统性别分工"];
}
export const neutralLaborLaws = new Set<string>(["自由劳动", "普通雇佣", "传统性别分工"]);
export const laborStatus = (laws: readonly string[]) =>
  laborLawFamilies.status.options.find((law) => laws.includes(law)) ?? "自由劳动";

// Provisional scenario fractions of rural people governed by each labor status.
const bondedShares: Record<LaborStatus, number> = { 自由劳动: 0, 奴隶制: 0.22, 农奴制: 0.45, 身份劳役: 0.25 };
export const bondedRuralShare = (laws: readonly string[]) => bondedShares[laborStatus(laws)];
export const ruralPopulation = (pops: readonly Pop[]) =>
  pops.reduce((sum, pop) => sum + (pop.occupation === "农民" ? pop.people : 0), 0);
export const workForce = (population: number, participation = 0.4) => Math.floor(population * participation);
export const bondedRuralWorkers = (ruralPeople: number, participation: number, laws: readonly string[]) =>
  Math.floor(workForce(ruralPeople, participation) * bondedRuralShare(laws));

export const baseOrdinaryWage = 100;
export function laborProtection(laws: readonly string[]) {
  return laws.includes("集体劳动保障") ? { ordinaryWage: 125, relief: 0.08 }
    : laws.includes("工时与工伤保障") ? { ordinaryWage: 115, relief: 0.04 }
      : { ordinaryWage: baseOrdinaryWage, relief: 0 };
}

export const participationTarget = (laws: readonly string[]) =>
  laws.includes("妇女平等权") ? 0.52 : laws.includes("妇女就业权") ? 0.46 : 0.4;
