import { z } from "zod";
import type { ByGood } from "./industry.ts";
import type { Pop, Tech } from "./society.ts";

export const institutionLevelSchema = z.int().min(0).max(3);
export const institutions = ["healthcare", "policing", "welfare", "education"] as const;
export type Institution = typeof institutions[number];
export const institutionNames = { healthcare: "医疗机构", policing: "警务机构", welfare: "福利机构", education: "学校" };
export const institutionCommands = {
  healthcare: "setHealthcareLevel", policing: "setPolicingLevel", welfare: "setWelfareLevel",
  education: "setEducationLevel",
} as const;
export function byInstitution<T>(make: (institution: Institution) => T): Record<Institution, T> {
  return { healthcare: make("healthcare"), policing: make("policing"), welfare: make("welfare"), education: make("education") };
}
const institutionTechnologies: Record<Institution, Partial<Record<number, Tech>>> = {
  healthcare: { 2: "公共卫生", 3: "公共卫生" },
  policing: {},
  welfare: { 2: "劳工保障", 3: "社会保障" },
  education: { 2: "公共教育", 3: "高等教育" },
};
export const institutionRequiredTech = (kind: Institution, level: number) => institutionTechnologies[kind][level];
export const technologyName = (tech: Tech) => tech === "高等教育" ? "专业大学" : tech;

export const institutionLawKinds = ["education", "healthcare", "welfare"] as const;
type InstitutionLawKind = typeof institutionLawKinds[number];
export const institutionLawOptions = {
  education: ["地方教育", "公共学校", "普及教育"],
  healthcare: ["地方诊疗", "公共诊疗", "普及医疗"],
  welfare: ["地方救济", "公共救济", "社会保险"],
} as const;
export const institutionLawFamilies = { education: "教育法", healthcare: "医疗法", welfare: "福利法" };
const institutionLawIndex = new Map<string, { kind: InstitutionLawKind; level: number }>(
  institutionLawKinds.flatMap((kind) => institutionLawOptions[kind].map((law, index) => [law, { kind, level: index + 1 }] as const)),
);
export const institutionLawDetails = (law: string) => institutionLawIndex.get(law);

export function institutionLawLimit(laws: readonly string[], kind: Institution) {
  if (kind === "policing") return 3;
  const options = institutionLawOptions[kind];
  return (options.findIndex((law) => laws.includes(law)) + 1) || 1;
}

export function institutionLevelError(kind: Institution, level: number, laws: readonly string[], knowledge: Record<Tech, number>) {
  const technology = institutionRequiredTech(kind, level);
  if (technology && knowledge[technology] !== 100) return `需要掌握${technologyName(technology)}技术`;
  const limit = institutionLawLimit(laws, kind);
  if (kind !== "policing" && level > limit)
    return `《${institutionLawOptions[kind][limit - 1]}》允许最高 ${limit} 级`;
}
const count = z.int().nonnegative();
export const institutionGoods = ["paper", "tools", "services"] as const;
type InstitutionGood = typeof institutionGoods[number];
export const isInstitutionGood = (good: string): good is InstitutionGood =>
  (institutionGoods as readonly string[]).includes(good);
export function byInstitutionGood<T>(make: (good: InstitutionGood) => T): Record<InstitutionGood, T> {
  return { paper: make("paper"), tools: make("tools"), services: make("services") };
}

const wages = { healthcare: 150, policing: 130, welfare: 130, education: 150 };
const inputsPerTen = {
  healthcare: { paper: 2, tools: 1, services: 4 },
  policing: { paper: 1, tools: 1, services: 2 },
  welfare: { paper: 2, tools: 1, services: 2 },
  education: { paper: 4, tools: 1, services: 3 },
};
export const institutionStaffNeed = (people: number, level: number) => Math.ceil(people * level / 1000);
const materialSchema = z.object({ paper: count, tools: count, services: count });
const institutionReport = z.object({
  level: institutionLevelSchema, needed: count, staff: count, wages: count, spending: count,
  orders: materialSchema, delivered: materialSchema, coverage: z.number().min(0).max(1),
});
export const institutionReportSchema = byInstitution((kind) => institutionReport.refine((r) =>
  r.staff <= r.needed && r.wages === r.staff * wages[kind] &&
  institutionGoods.every((good) => r.delivered[good] <= r.orders[good])));
export type InstitutionReport = z.infer<typeof institutionReport>;
const recipients = z.object({ 农民: count, 劳工: count });
export const welfareReliefSchema = z.object({ eligible: recipients, paid: recipients });
export type WelfareRelief = z.infer<typeof welfareReliefSchema>;

export function planInstitution(kind: Institution, population: number, level: number, available: number, cash: number, ceilings: ByGood<number>) {
  const wage = wages[kind];
  const needed = institutionStaffNeed(population, level);
  const ordersFor = (staff: number) => byInstitutionGood((good) => Math.ceil(staff * inputsPerTen[kind][good] / 10));
  const cost = (staff: number, orders = ordersFor(staff)) =>
    institutionGoods.reduce((sum, good) => sum + orders[good] * ceilings[good], staff * wage);
  let low = 0, high = Math.min(needed, available, Math.floor(cash / wage));
  while (low < high) {
    const staff = Math.ceil((low + high) / 2);
    if (cost(staff) <= cash) low = staff;
    else high = staff - 1;
  }
  const staff = low, orders = ordersFor(staff);
  return { level, needed, staff, orders, wages: staff * wage, reserved: cost(staff, orders) };
}

export function deliverInstitution(plan: ReturnType<typeof planInstitution>, delivered: InstitutionReport["delivered"],
  spending: number, administration: number,
): InstitutionReport {
  const { level, needed, staff, orders, wages } = plan;
  const supplied = staff > 0 ? Math.min(...institutionGoods.map((good) => delivered[good] / orders[good])) : 0;
  const coverage = needed > 0 ? level / 3 * staff / needed * supplied * (0.75 + 0.25 * administration) : 0;
  return { level, needed, staff, orders, delivered, coverage, wages, spending };
}

export function deliverInstitutionOrders(orders: Record<Institution, number>, totalOrders: number, goods: number, cost: number) {
  const delivered = byInstitution((institution) => {
    const ordered = orders[institution];
    const received = ordered > 0 ? Math.round(goods * ordered / totalOrders) : 0;
    const paid = received > 0 ? Math.floor(cost * received / goods) : 0;
    totalOrders -= ordered;
    goods -= received;
    cost -= paid;
    return { received, paid };
  });
  return { delivered, remainingGoods: goods, remainingCost: cost };
}

const weeklyReliefPerPerson = 2;
export function planWelfareRelief(pops: readonly Pop[], plan: ReturnType<typeof planInstitution>, cash: number) {
  const eligible = { 农民: 0, 劳工: 0 };
  for (const { occupation, people } of pops) {
    if (occupation === "农民" || occupation === "劳工") eligible[occupation] += people;
  }
  const total = eligible.农民 + eligible.劳工;
  const reserved = Math.min(cash, Math.floor(total * weeklyReliefPerPerson * plan.level / 3 * plan.staff / plan.needed));
  return { eligible, total, reserved };
}

export function deliverWelfareRelief(plan: ReturnType<typeof planWelfareRelief>, coverage: number): WelfareRelief {
  const { eligible, total, reserved } = plan;
  const paid = Math.min(reserved, Math.floor(total * weeklyReliefPerPerson * coverage));
  const farmers = paid > 0 ? Math.floor(paid * eligible.农民 / total) : 0;
  return { eligible, paid: { 农民: farmers, 劳工: paid - farmers } };
}
