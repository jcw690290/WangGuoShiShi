import { z } from "zod";

export const publicPayBands = ["low", "standard", "high"] as const;
export const publicPayBandSchema = z.enum(publicPayBands);
export type PublicPayBand = typeof publicPayBands[number];
export const publicPayNames = { low: "低", standard: "标准", high: "高" };
const factor = { low: 0.8, standard: 1, high: 1.2 };
export const publicSalary = (base: number, band: PublicPayBand) => Math.round(base * factor[band]);

export function militarySalary(regulars: number, conscripts: number, injured: number, band: PublicPayBand) {
  const officers = Math.ceil(regulars / 100);
  return (regulars - officers + conscripts + injured) * publicSalary(120, band) + officers * publicSalary(200, band);
}
