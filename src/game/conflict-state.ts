import type { BorderDispute } from "./diplomacy.ts";
import type { GameState } from "./engine.ts";
import type { Occupation } from "./occupation.ts";

export interface ForeignTheater {
  dispute: BorderDispute;
  occupation?: Occupation;
}

export function conflictParties(dispute: BorderDispute) {
  return [dispute.claimantId, ...dispute.allies, dispute.defenderId, ...dispute.defenders];
}

export function currentDisputes(state: GameState) {
  return [state.borderDispute, state.foreignTheater?.dispute].filter((d): d is BorderDispute => d != null);
}

export function occupationAt(state: GameState, siteId: string) {
  if (state.occupation?.stateId === siteId) return state.occupation;
  const foreign = state.foreignTheater?.occupation;
  if (foreign?.stateId === siteId) return foreign;
}

export function inCivilTheater(state: GameState, countryId: string) {
  return state.civilWar !== undefined &&
    (countryId === state.borderDispute!.claimantId || countryId === state.civilWar.countryId);
}

export function foreignTheaterView(state: GameState): GameState {
  if (!state.civilWar) return state;
  const { civilWar: _civilWar, foreignTheater, occupation: _civilOccupation, ...world } = state;
  return { ...world, borderDispute: foreignTheater?.dispute ?? null,
    ...(foreignTheater?.occupation ? { occupation: foreignTheater.occupation } : {}) };
}

export function attachForeignTheater(civil: GameState, foreign: GameState): GameState {
  const { borderDispute: dispute, occupation, ...world } = foreign;
  const theater = dispute === civil.foreignTheater?.dispute && occupation === civil.foreignTheater?.occupation
    ? civil.foreignTheater : dispute && { dispute, ...(occupation ? { occupation } : {}) };
  return { ...world, borderDispute: civil.borderDispute, civilWar: civil.civilWar!,
    ...(civil.occupation ? { occupation: civil.occupation } : {}),
    ...(theater ? { foreignTheater: theater } : {}) };
}

export function separateTheaters(civil: GameState, dispute: BorderDispute | null) {
  return !dispute || dispute.phase === "resolved" || conflictParties(dispute).every((id) => !inCivilTheater(civil, id));
}
