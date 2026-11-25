import { z } from "zod";
import type { GameState } from "./engine.ts";

export const diplomaticTieSchema = z.object({
  kind: z.enum(["investiture", "tributeTrade", "personalUnion"]),
  senior: z.string(),
  partner: z.string(),
});
export type DiplomaticTie = z.infer<typeof diplomaticTieSchema>;
export const tieNames = {
  investiture: "宗藩册封",
  tributeTrade: "朝贡贸易",
  personalUnion: "共主联合",
} satisfies Record<DiplomaticTie["kind"], string>;

export function tiePartner(tie: DiplomaticTie, countryId: string) {
  if (tie.senior === countryId) return tie.partner;
  if (tie.partner === countryId) return tie.senior;
}

export function diplomaticTie(state: GameState, a: string, b: string) {
  return state.diplomaticTies?.find((tie) => tiePartner(tie, a) === b);
}

export function removeDiplomaticTies(state: GameState, remove: (tie: DiplomaticTie) => boolean): GameState {
  const retained = state.diplomaticTies?.filter((tie) => !remove(tie));
  if (retained?.length === state.diplomaticTies?.length) return state;
  return { ...state, diplomaticTies: retained };
}
