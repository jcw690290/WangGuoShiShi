import { z } from "zod";

export const publicPayBands = ["low", "standard", "high"] as const;
export const publicPayBandSchema = z.enum(publicPayBands);
export type PublicPayBand = typeof publicPayBands[number];
export const publicPayNames = { low: "低", standard: "标准", high: "高" };
const factor = { low: 0.8, standard: 1, high: 1.2 };
export const publicSalary = (base: number, band: PublicPayBand) => Math.round(base * factor[band]);
export const officersInService = (regulars: number) => Math.ceil(regulars / 100);
export const officerSalary = (regulars: number, band: PublicPayBand) => officersInService(regulars) * publicSalary(200, band);

export function militarySalary(regulars: number, conscripts: number, injured: number, band: PublicPayBand) {
  return (regulars - officersInService(regulars) + conscripts + injured) * publicSalary(120, band) + officerSalary(regulars, band);
}
