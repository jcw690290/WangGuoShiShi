import { z } from "zod";
import { constitutionalLaws, representationLaw, stateForm } from "./constitution.ts";
import type { GameState } from "./engine.ts";
import { GameRuleError } from "./rules.ts";
import { governmentLegitimacy, influence, supporters, unrestOf } from "./society.ts";
import type { Group, Nation, SiteSocial } from "./society.ts";

export const crisisWarningDays = 28;
export const compromiseCost = 50_000;
export const compromiseDays = 180;

export const constitutionalCrisisSchema = z.union([
  z.strictObject({ demand: z.enum(constitutionalLaws), since: z.int().nonnegative().multipleOf(7) }),
  z.strictObject({ compromiseUntil: z.int().positive() }),
]);
export type ConstitutionalCrisis = z.infer<typeof constitutionalCrisisSchema>;
export type ConstitutionalCrisisCommand = { type: "offerConstitutionalCompromise"; countryId: string };

function oppositionSupport(nation: Nation, law: typeof constitutionalLaws[number], power: Record<Group, number>) {
  return supporters[law].reduce((sum, group) => sum + (nation.government.includes(group) ? 0 : power[group]), 0);
}

export function constitutionalCrisisWarning(state: GameState, countryId: string) {
  const crisis = state.constitutionalCrises?.[countryId];
  if (crisis && "demand" in crisis && state.elapsedDays - crisis.since >= crisisWarningDays) return crisis;
}

export function constitutionalSupportByState(state: GameState, countryId: string, demand: typeof constitutionalLaws[number]) {
  const nation = state.nations[countryId];
  return Object.entries(state.ownerByStateId)
    .filter(([, owner]) => owner === countryId)
    .map(([stateId]) => {
      const site = state.societies[stateId];
      const power = influence([site], countryId, nation);
      const opposition = 0.55 * oppositionSupport(nation, demand, power) + 0.45 * unrestOf(site.pops);
      return { stateId, opposition: Math.round(opposition) };
    }).sort((a, b) => b.opposition - a.opposition);
}

export function advanceConstitutionalCrises(state: GameState): GameState {
  const previous = state.constitutionalCrises;
  const crises: Record<string, ConstitutionalCrisis> = {};
  const locals = new Map<string, SiteSocial[]>();
  for (const [siteId, owner] of Object.entries(state.ownerByStateId)) {
    if (!locals.has(owner)) locals.set(owner, []);
    locals.get(owner)!.push(state.societies[siteId]);
  }
  for (const [id, sites] of locals) {
    if (sites.length < 2) continue;
    const existing = previous?.[id];
    if (existing && "compromiseUntil" in existing && state.elapsedDays < existing.compromiseUntil) {
      crises[id] = existing;
      continue;
    }
    const pending = existing && "demand" in existing ? existing : undefined;
    const nation = state.nations[id];
    const power = influence(sites, id, nation);
    const legitimacy = governmentLegitimacy(nation, power);
    if (legitimacy >= (pending ? 40 : 35) || unrestOf(sites.flatMap((site) => site.pops)) < (pending ? 25 : 30)) continue;
    const enacted = [stateForm(nation), representationLaw(nation)];
    const alternatives = constitutionalLaws
      .filter((law) => !enacted.includes(law))
      .map((demand) => ({ demand, support: oppositionSupport(nation, demand, power) }))
      .filter(({ support }) => support >= 24);
    const choice = alternatives.find(({ demand }) => demand === pending?.demand) ??
      alternatives.find(({ demand }) => demand === nation.reform) ??
      alternatives.sort((a, b) => b.support - a.support)[0];
    if (choice) crises[id] = pending && choice.demand === pending.demand ? pending : { demand: choice.demand, since: state.elapsedDays };
  }
  return { ...state, constitutionalCrises: Object.keys(crises).length ? crises : undefined };
}

export function constitutionalCompromiseError(state: GameState, countryId: string) {
  if (!constitutionalCrisisWarning(state, countryId)) return "当前没有需协商的政体冲突";
  if (state.countryEconomies[countryId].treasury < compromiseCost) return "国库不足以支付协商经费";
}

export function applyConstitutionalCompromise(state: GameState, countryId: string): GameState {
  const error = constitutionalCompromiseError(state, countryId);
  if (error) throw new GameRuleError(error);
  const { demand } = constitutionalCrisisWarning(state, countryId)!;
  const economy = state.countryEconomies[countryId], nation = state.nations[countryId];
  return {
    ...state,
    constitutionalCrises: { ...state.constitutionalCrises, [countryId]: { compromiseUntil: state.elapsedDays + compromiseDays } },
    countryEconomies: { ...state.countryEconomies, [countryId]: { ...economy, treasury: economy.treasury - compromiseCost } },
    nations: { ...state.nations, [countryId]: {
      ...nation, reform: demand, reformProgress: nation.reform === demand ? nation.reformProgress : 0,
    } },
  };
}
