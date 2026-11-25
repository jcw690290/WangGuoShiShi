import type { Scenario } from "../scenario/scenario.ts";
import type { GameState } from "./engine.ts";

export interface Occupation {
  stateId: string;
  controllerId: string;
}

export function syncOccupation(scenario: Scenario, state: GameState): GameState {
  const { borderDispute, occupation } = state;
  if (borderDispute?.phase === "war" && borderDispute.progress >= scenario.borderDispute.cessionProgress) {
    const { targetStateId: stateId, claimantId: controllerId } = borderDispute;
    if (occupation?.stateId === stateId && occupation.controllerId === controllerId) return state;
    return { ...state, occupation: { stateId, controllerId } };
  }
  if (!occupation) return state;
  const { occupation: released, ...world } = state;
  return world;
}
