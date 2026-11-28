import { z } from "zod";
import type { Difficulty } from "./settings.ts";

const cash = z.int().nonnegative();
const fiscalRisk = z.enum(["stable", "warning", "restricted", "defaulted"]);
export const fiscalRiskNames = { stable: "稳定", warning: "信用预警", restricted: "限制新工程", defaulted: "违约" };
const maxSamples = 52;
export const fiscalAccountSchema = z.object({
  debt: cash,
  arrears: cash,
  taxHistory: z.array(cash).min(1).max(maxSamples),
  week: z.object({
    day: cash, creditLimit: cash, annualRate: z.number().nonnegative(),
    borrowed: cash, repaid: cash,
    interestDue: cash, interestPaid: cash,
    upkeepDue: cash, upkeepPaid: cash,
    risk: fiscalRisk,
  }).refine((week) => week.interestPaid <= week.interestDue && week.upkeepPaid <= week.upkeepDue),
});
export type FiscalAccount = z.infer<typeof fiscalAccountSchema>;

const annualRateMultiplier: Record<Difficulty, number> = {
  relaxed: 0.8, standard: 1, challenging: 1.15, extreme: 1.3,
};
const sevenDays = 7 * 86_400_000;

export function fiscalWeekFraction(end: Date) {
  const year = end.getUTCFullYear();
  const turnOfYear = Date.UTC(year, 0, 1);
  const endTime = end.getTime();
  const currentYearTime = Math.min(sevenDays, endTime - turnOfYear);
  const currentYearFraction = currentYearTime / (Date.UTC(year + 1, 0, 1) - turnOfYear);
  const priorYearFraction = (sevenDays - currentYearTime) / (turnOfYear - Date.UTC(year - 1, 0, 1));
  return currentYearFraction + priorYearFraction;
}

interface BudgetInput {
  day: number;
  treasury: number;
  tax: number;
  receipts: number;
  upkeep: number;
  prepaidUpkeep?: number;
  difficulty: Difficulty;
  fractionOfYear: number;
  fiscal?: FiscalAccount;
}

export function availablePrepaymentCredit(fiscal: FiscalAccount | undefined, treasury: number) {
  if (!fiscal || fiscal.week.risk === "restricted" || fiscal.week.risk === "defaulted") return 0;
  return Math.max(0, fiscal.week.creditLimit - fiscal.debt - Math.max(0, -treasury));
}

export function settleFiscal(input: BudgetInput): { treasury: number; fiscal: FiscalAccount } {
  const { day, treasury, tax, receipts, upkeep, prepaidUpkeep = 0, difficulty, fractionOfYear, fiscal } = input;
  if (fiscal && fiscal.week.day >= day) throw new Error("财政周结算已记账");
  const cash = Math.max(0, treasury);
  const advance = Math.max(0, prepaidUpkeep - cash);
  if (advance > availablePrepaymentCredit(fiscal, treasury) || prepaidUpkeep > upkeep)
    throw new Error("必要支出预付超过现款、可用授信或预算");
  const taxHistory = [...(fiscal?.taxHistory.slice(1 - maxSamples) ?? []), tax];
  const averageTax = taxHistory.reduce((sum, value) => sum + value, 0) / taxHistory.length;
  const creditLimit = Math.floor(averageTax * 104);
  // Versions before the credit system kept overdrafts as negative cash.
  const openingDebt = (fiscal?.debt ?? 0) + Math.max(0, -treasury) + advance;
  const openingCash = cash + advance + receipts;
  const creditUse = creditLimit > 0 ? openingDebt / creditLimit : openingDebt > 0 ? 1 : 0;
  const annualRate = (0.06 + 0.1 * creditUse ** 2) * annualRateMultiplier[difficulty];
  const interestDue = (fiscal?.arrears ?? 0) + Math.round(openingDebt * annualRate * fractionOfYear);
  const laterBorrowing = Math.min(
    Math.max(0, creditLimit - openingDebt),
    Math.max(0, interestDue + upkeep - openingCash),
  );
  const available = openingCash + laterBorrowing - prepaidUpkeep;
  const interestPaid = Math.min(available, interestDue);
  const pendingUpkeepPaid = Math.min(available - interestPaid, upkeep - prepaidUpkeep);
  const upkeepPaid = prepaidUpkeep + pendingUpkeepPaid;
  const remaining = available - interestPaid - pendingUpkeepPaid;
  const repaid = Math.min(openingDebt, Math.max(0, remaining - 2 * upkeep));
  const closingCash = remaining - repaid;
  const debt = openingDebt + laterBorrowing - repaid;
  const arrears = interestDue - interestPaid;
  const shortfall = arrears > 0 || upkeepPaid < upkeep;
  const priorShortfall = fiscal?.week.risk === "restricted" || fiscal?.week.risk === "defaulted";
  const risk = shortfall ? (priorShortfall ? "defaulted" : "restricted")
    : debt > 0 && debt >= creditLimit * 0.8 && closingCash < 2 * upkeep ? "warning" : "stable";
  return {
    treasury: closingCash,
    fiscal: {
      debt, arrears, taxHistory,
      week: { day, creditLimit, annualRate, borrowed: advance + laterBorrowing, repaid,
        interestDue, interestPaid, upkeepDue: upkeep, upkeepPaid, risk },
    },
  };
}
