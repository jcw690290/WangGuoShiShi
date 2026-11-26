import { z } from "zod";
import type { ByGood } from "./industry.ts";

export const healthcareLevelSchema = z.int().min(0).max(3);
const count = z.int().nonnegative();
export const healthGoods = ["paper", "tools", "services"] as const;
export type HealthGood = typeof healthGoods[number];
export const isHealthGood = (good: string): good is HealthGood => (healthGoods as readonly string[]).includes(good);
export function byHealthGood<T>(make: (good: HealthGood) => T): Record<HealthGood, T> {
  return { paper: make("paper"), tools: make("tools"), services: make("services") };
}

export const healthcareWage = 150;
export const healthcareStaffNeed = (people: number, level: number) => Math.ceil(people * level / 1000);
const inputsPerTen = { paper: 2, tools: 1, services: 4 };
const materialSchema = z.object({ paper: count, tools: count, services: count });
export const healthcareReportSchema = z.object({
  level: healthcareLevelSchema, needed: count, staff: count, wages: count, spending: count,
  orders: materialSchema, delivered: materialSchema, coverage: z.number().min(0).max(1),
}).refine((r) => r.staff <= r.needed && r.wages === r.staff * healthcareWage &&
  healthGoods.every((good) => r.delivered[good] <= r.orders[good]));
export type HealthcareReport = z.infer<typeof healthcareReportSchema>;

export function planHealthcare(population: number, level: number, available: number, cash: number, ceilings: ByGood<number>) {
  const needed = healthcareStaffNeed(population, level);
  const ordersFor = (staff: number) => byHealthGood((good) => Math.ceil(staff * inputsPerTen[good] / 10));
  const cost = (staff: number, orders = ordersFor(staff)) =>
    healthGoods.reduce((sum, good) => sum + orders[good] * ceilings[good], staff * healthcareWage);
  let low = 0, high = Math.min(needed, available, Math.floor(cash / healthcareWage));
  while (low < high) {
    const staff = Math.ceil((low + high) / 2);
    if (cost(staff) <= cash) low = staff;
    else high = staff - 1;
  }
  const staff = low, orders = ordersFor(staff);
  return { level, needed, staff, orders, wages: staff * healthcareWage, reserved: cost(staff, orders) };
}

export function deliverHealthcare(plan: ReturnType<typeof planHealthcare>, delivered: HealthcareReport["delivered"],
  spending: number, administration: number,
): HealthcareReport {
  const { level, needed, staff, orders, wages } = plan;
  const supplied = staff > 0 ? Math.min(...healthGoods.map((good) => delivered[good] / orders[good])) : 0;
  const coverage = needed > 0 ? level / 3 * staff / needed * supplied * (0.75 + 0.25 * administration) : 0;
  return { level, needed, staff, orders, delivered, coverage, wages, spending };
}
