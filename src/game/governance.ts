import { z } from "zod";
import type { GameState } from "./engine.ts";
import { elapsedTicks, TICKS_PER_DAY } from "./time.ts";
import type { SiteSocial } from "./society.ts";
import { GameRuleError } from "./rules.ts";
import type { Difficulty } from "./settings.ts";

export const governanceModes = ["PROVINCE", "FRONTIER", "COLONIAL", "INDIRECT"] as const;
export type GovernanceMode = (typeof governanceModes)[number];
export const governanceRules = {
  PROVINCE: { name: "正式州", centralTax: 100, militaryShare: 1, administrationCost: 1 },
  FRONTIER: { name: "边疆辖区", centralTax: 80, militaryShare: 1, administrationCost: 1.2 },
  COLONIAL: { name: "殖民辖区", centralTax: 65, militaryShare: 0.75, administrationCost: 1.1 },
  INDIRECT: { name: "间接辖区", centralTax: 30, militaryShare: 0.25, administrationCost: 0.6 },
} satisfies Record<GovernanceMode, { name: string; centralTax: number; militaryShare: number; administrationCost: number }>;

export const integrationDuration = 60;
export const administrationWage = 150;
export const localGovernanceSchema = z.object({
  mode: z.enum(governanceModes),
  integrated: z.boolean(),
  integration: z.object({
    months: z.number().min(0).lt(integrationDuration),
    startedAtTick: z.int().nonnegative(),
  }).nullable(),
}).refine(({ integrated, mode, integration }) =>
  integrated ? integration === null : mode !== "PROVINCE",
);
export type LocalGovernance = z.infer<typeof localGovernanceSchema>;

const initialProvince: LocalGovernance = { mode: "PROVINCE", integrated: true, integration: null };
export const newFrontier: LocalGovernance = { mode: "FRONTIER", integrated: false, integration: null };
export const governanceOf = (site: SiteSocial) => site.governance ?? initialProvince;
const administrationDemand: Record<Difficulty, number> = {
  relaxed: 0.8, standard: 1, challenging: 1.15, extreme: 1.3,
};
export const administrationDemandMultiplier = (difficulty: Difficulty) => administrationDemand[difficulty];
export const integrationStaffNeeded = (population: number, difficulty: Difficulty) =>
  Math.ceil((20 + population / 50_000) * administrationDemandMultiplier(difficulty));

export type GovernanceCommand =
  | { type: "setLocalGovernance"; countryId: string; stateId: string; mode: GovernanceMode }
  | { type: "startIntegration" | "cancelIntegration"; countryId: string; stateId: string };

export function governanceError(state: GameState, cmd: GovernanceCommand) {
  const { stateId, countryId } = cmd;
  if (state.ownerByStateId[stateId] !== countryId) return "只能管理本国领土";
  if (state.occupation?.stateId === stateId) return "州处于军事占领中";
  const current = governanceOf(state.societies[stateId]);
  if (cmd.type === "setLocalGovernance") {
    if (cmd.mode === "PROVINCE" && !current.integrated) return "正式州须先完成整合";
    if (cmd.mode === current.mode) return "州已采用此治理方式";
  } else if (cmd.type === "startIntegration") {
    if (current.integrated || current.integration !== null) return "州已整合或正在整合";
  } else if (current.integration === null) return "州没有进行中的整合";
}

export function applyGovernanceCommand(state: GameState, cmd: GovernanceCommand): GameState {
  const problem = governanceError(state, cmd);
  if (problem) throw new GameRuleError(problem);
  const site = state.societies[cmd.stateId];
  const current = governanceOf(site);
  const governance = cmd.type === "setLocalGovernance" ? { ...current, mode: cmd.mode } :
    { ...current, integration: cmd.type === "startIntegration" ? { months: 0, startedAtTick: elapsedTicks(state) } : null };
  return { ...state, societies: { ...state.societies, [cmd.stateId]: { ...site, governance } } };
}

export function chooseIntegration(state: GameState, countryId: string): GovernanceCommand | undefined {
  const country = state.countryEconomies[countryId];
  if (country.fiscal && country.fiscal.week.risk !== "stable") return;
  const sites = Object.keys(state.ownerByStateId).filter((stateId) => state.ownerByStateId[stateId] === countryId);
  if (sites.some((stateId) => state.societies[stateId].governance?.integration)) return;
  for (const stateId of sites) {
    const command = { type: "startIntegration", countryId, stateId } as const;
    if (governanceError(state, command)) continue;
    const required = integrationStaffNeeded(state.stateEconomies[stateId].population, state.settings.difficulty);
    if (country.treasury >= required * administrationWage * 8) return command;
  }
}

export function integrationWeekShare(startedAtTick: number, closingTick: number) {
  const ticksPerWeek = 7 * TICKS_PER_DAY;
  return Math.min(1, Math.max(0, (closingTick - startedAtTick) / ticksPerWeek));
}

export function advanceIntegration(
  current: LocalGovernance, paidStaff: number, requiredStaff: number, access: number, fractionOfYear: number,
): LocalGovernance {
  const { integration } = current;
  if (integration === null || paidStaff === 0) return current;
  const pace = Math.min(1, paidStaff / requiredStaff) * (0.75 + 0.5 * access);
  const months = integration.months + 12 * fractionOfYear * pace;
  return months >= integrationDuration
    ? { ...current, integration: null, integrated: true }
    : { ...current, integration: { ...integration, months } };
}
