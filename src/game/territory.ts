import { GameRuleError } from "./rules.ts";
import type { Scenario } from "../scenario/scenario.ts";
import { isScenarioFinished } from "./engine.ts";
import type { GameState } from "./engine.ts";
import { initSiteSociety } from "./society.ts";
import { newFrontier } from "./governance.ts";
import { initialStateEconomy } from "./economy.ts";

// Demo balance parameter, in the same internal silver units as construction.
export const CLAIM_COST = 50_000;

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
  return {
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
  };
}
