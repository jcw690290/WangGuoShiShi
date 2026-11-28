import { z } from "zod";
import { GameRuleError } from "./rules.ts";
import type { Scenario } from "../scenario/scenario.ts";
import { isScenarioFinished } from "./engine.ts";
import type { GameState } from "./engine.ts";
import { initSiteSociety } from "./society.ts";
import { newFrontier } from "./governance.ts";
import { initialStateEconomy } from "./economy.ts";
import { influenceBudget } from "./foreign-relations.ts";

// Demo balance parameter, in the same internal silver units as construction.
export const CLAIM_COST = 50_000;
export const territorialClaimSchema = z.object({
  stateId: z.string(), claimantId: z.string(), declaredDay: z.int().nonnegative(), recognizedBy: z.array(z.string()),
}).refine((claim) => !claim.recognizedBy.includes(claim.claimantId) &&
  new Set(claim.recognizedBy).size === claim.recognizedBy.length);
export type TerritorialClaim = z.infer<typeof territorialClaimSchema>;
export type TerritorialClaimCommand = {
  type: "declareTerritorialClaim" | "renounceTerritorialClaim"; stateId: string; countryId: string;
};

export const territorialClaim = (state: GameState, countryId: string, stateId: string) =>
  state.territorialClaims?.find((claim) => claim.claimantId === countryId && claim.stateId === stateId);

export function territorialClaimError(scenario: Scenario, state: GameState, cmd: TerritorialClaimCommand) {
  const { countryId, stateId } = cmd;
  const claim = territorialClaim(state, countryId, stateId);
  if (cmd.type === "renounceTerritorialClaim") {
    if (!claim) return "本国没有登记该宣称";
    const dispute = state.borderDispute;
    if (dispute && dispute.phase !== "resolved" && dispute.claimantId === countryId && dispute.targetStateId === stateId &&
        dispute.goals.includes("recognition")) return "进行中的承认条款需要保留该宣称";
    return;
  }
  const site = scenario.states[stateId];
  if (!site || state.ownerByStateId[stateId] === countryId) return "请选择尚未归属本国的州";
  if (claim) return "本国已经声明该领土";
  if (!Object.values(state.ownerByStateId).includes(countryId) || state.nations[countryId].overlord)
    return "只有独立且拥有领土的国家可宣称";
  const adjacent = site.neighbors.some((id) => state.ownerByStateId[id] === countryId);
  const overseas = site.coastal && Object.values(scenario.states)
    .some((port) => port.coastal && state.ownerByStateId[port.id] === countryId && state.occupation?.stateId !== port.id);
  if (!adjacent && !overseas) return "需要陆地接壤或沿海通达";
  if (influenceBudget(state, countryId).available < 1) return "可用外交影响力不足";
}

export function applyTerritorialClaim(scenario: Scenario, state: GameState, cmd: TerritorialClaimCommand): GameState {
  const problem = territorialClaimError(scenario, state, cmd);
  if (problem) throw new GameRuleError(problem);
  const { countryId, stateId } = cmd;
  const claims = state.territorialClaims ?? [];
  const territorialClaims = cmd.type === "declareTerritorialClaim"
    ? [...claims, { claimantId: countryId, stateId, declaredDay: state.elapsedDays, recognizedBy: [] }]
    : claims.filter((claim) => claim.claimantId !== countryId || claim.stateId !== stateId);
  return { ...state, territorialClaims };
}

export function recognizeTerritorialClaim(state: GameState, claimantId: string, recognizer: string, stateId: string) {
  const claim = territorialClaim(state, claimantId, stateId)!;
  const recognized = { ...claim, recognizedBy: [...claim.recognizedBy, recognizer] };
  return {
    ...state,
    territorialClaims: state.territorialClaims!.map((row) => row === claim ? recognized : row),
  };
}

export function reconcileTerritorialClaims(state: GameState): GameState {
  if (!state.territorialClaims) return state;
  const live = new Set(Object.values(state.ownerByStateId));
  const territorialClaims = state.territorialClaims
    .filter((claim) => live.has(claim.claimantId) && state.ownerByStateId[claim.stateId] !== claim.claimantId)
    .map((claim) => ({ ...claim, recognizedBy: claim.recognizedBy.filter((id) => live.has(id)) }));
  return { ...state, territorialClaims };
}

export function claimError(
  scenario: Scenario,
  state: GameState,
  stateId: string,
) {
  if (state.playerCountryId === null) return "请先选择国家";
  if (isScenarioFinished(scenario, state)) return "剧本已结束";
  if (!Object.hasOwn(scenario.states, stateId)) return "不存在这个州";
  if (Object.hasOwn(state.ownerByStateId, stateId)) return "只能占领无主领土";
  if (state.countryEconomies[state.playerCountryId].treasury < CLAIM_COST)
    return "国库资金不足";
}

export function applyClaim(
  scenario: Scenario,
  state: GameState,
  stateId: string,
): GameState {
  const error = claimError(scenario, state, stateId);
  if (error) throw new GameRuleError(error);
  const id = state.playerCountryId!,
    site = scenario.states[stateId];
  const country = state.countryEconomies[id];
  return reconcileTerritorialClaims({
    ...state,
    ownerByStateId: { ...state.ownerByStateId, [stateId]: id },
    stateEconomies: {
      ...state.stateEconomies,
      [stateId]: initialStateEconomy(site),
    },
    societies: { ...state.societies, [stateId]: { ...initSiteSociety(site), governance: { ...newFrontier } } },
    countryEconomies: {
      ...state.countryEconomies,
      [id]: { ...country, treasury: country.treasury - CLAIM_COST },
    },
    lastEconomy: null,
  });
}
