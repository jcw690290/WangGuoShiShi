import { z } from "zod";
import type { SiteReport } from "./economy.ts";

const coveredWeeks = z.number().min(0).max(5);
export const populationServicesSchema = z.object({
  school: coveredWeeks,
  healthcare: coveredWeeks,
  treatment: coveredWeeks,
  policing: coveredWeeks,
  university: coveredWeeks,
});
type PopulationServices = z.infer<typeof populationServicesSchema>;

export function completedServiceWeeks(day: number, lastMonthDay: number) {
  return Math.floor(day / 7) - Math.floor(lastMonthDay / 7);
}

export function accumulatePopulationServices(previous: PopulationServices | undefined, report: SiteReport, population: number) {
  const healthcare = report.healthcare?.coverage ?? 0;
  const medical = report.opium?.medical;
  const week = {
    school: report.education?.coverage ?? 0,
    healthcare,
    treatment: medical?.ordered ? healthcare * medical.delivered / medical.ordered : 0,
    policing: report.policing?.coverage ?? 0,
    university: Math.min(1, (report.universityStaff ?? 0) * 1000 / population),
  };
  if (Object.values(week).every((coverage) => coverage === 0)) return previous;
  if (!previous) return week;
  return {
    school: previous.school + week.school,
    healthcare: previous.healthcare + week.healthcare,
    treatment: previous.treatment + week.treatment,
    policing: previous.policing + week.policing,
    university: previous.university + week.university,
  };
}
