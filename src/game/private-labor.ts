import { z } from "zod";
import { productiveBuildings } from "./industry.ts";

const headcount = z.int().nonnegative();
export const staffingSchema = z.object({ ordinary: headcount, skilled: headcount })
  .refine(({ ordinary, skilled }) => ordinary + skilled > 0);
export const industryLaborSchema = z.object({
  wage: z.int().positive(),
  staffing: z.partialRecord(z.enum(productiveBuildings), staffingSchema),
});
export type IndustryLabor = z.infer<typeof industryLaborSchema>;
type Staffing = z.infer<typeof staffingSchema>;

export function industrialWage(legalWage: number, workforce: number, capital: number, previous?: IndustryLabor) {
  if (!previous) return legalWage;
  const industries = Object.values(previous.staffing).filter((staff): staff is Staffing => staff !== undefined);
  const employed = industries.reduce((sum, staff) => sum + staff.ordinary + staff.skilled, 0);
  const scarcity = Math.max(0, Math.min(1, (employed / Math.max(1, workforce) - 0.60) / 0.35));
  const competition = Math.min(1, industries.length / 4);
  const funding = Math.min(1, capital / Math.max(1, 4 * previous.wage * employed));
  const target = Math.round(legalWage * (1 + 0.35 * scarcity * competition * funding));
  const difference = target - previous.wage;
  return Math.max(legalWage, previous.wage + Math.sign(difference) * Math.ceil(Math.abs(difference) / 8));
}

export function productionHiringLimit(capacity: number, skilledPercent: number, previous: Staffing | undefined) {
  const skilledCapacity = Math.ceil(capacity * skilledPercent / 100);
  const ordinaryCapacity = capacity - skilledCapacity;
  const skilled = previous?.skilled ?? 0, ordinary = previous?.ordinary ?? 0;
  const skilledLimit = skilled + Math.ceil(Math.max(0, skilledCapacity - skilled) * 0.10);
  const ordinaryLimit = ordinary + Math.ceil(Math.max(0, ordinaryCapacity - ordinary) * 0.25);
  const bySkills = skilledPercent > 0 ? Math.floor(skilledLimit * 100 / skilledPercent) : capacity;
  const byOrdinary = skilledPercent < 100 ? Math.floor(((ordinaryLimit + 1) * 100 - 1) / (100 - skilledPercent)) : capacity;
  return Math.min(capacity, bySkills, byOrdinary);
}
