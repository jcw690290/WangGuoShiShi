import { z } from "zod";
import type { GameState } from "./engine.ts";
import { stateForm } from "./constitution.ts";
import { adjustForeignRelation, diplomaticTrust, influenceBudget, opposingParties, relationBetween } from "./foreign-relations.ts";
import { GameRuleError } from "./rules.ts";

export const diplomaticTieKinds = ["investiture", "tributeTrade", "personalUnion"] as const;
export const diplomaticTieKindSchema = z.enum(diplomaticTieKinds);
export const diplomaticTieSchema = z.object({
  kind: diplomaticTieKindSchema,
  senior: z.string(),
  partner: z.string(),
  signedDay: z.int().nonnegative().optional(),
});
export type DiplomaticTie = z.infer<typeof diplomaticTieSchema>;
export const tieNames = {
  investiture: "宗藩册封",
  tributeTrade: "朝贡贸易",
  personalUnion: "共主联合",
} satisfies Record<DiplomaticTie["kind"], string>;
export const diplomaticTieOfferSchema = z.object({
  from: z.string(),
  to: z.string(),
  kind: diplomaticTieKindSchema,
  offeredDay: z.int().nonnegative(),
}).refine(({ from, to }) => from !== to);
export type DiplomaticTieOffer = z.infer<typeof diplomaticTieOfferSchema>;
export type DiplomaticTieCommand = {
  type: "offerDiplomaticTie" | "acceptDiplomaticTie" | "declineDiplomaticTie" | "withdrawDiplomaticTie";
  countryId: string;
  partnerId: string;
  kind: DiplomaticTie["kind"];
};
const offerLifetime = 28;
export const tieInfluence = { investiture: 1, tributeTrade: 1, personalUnion: 2 };

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

function tieEligibility(state: GameState, from: string, to: string, kind: DiplomaticTie["kind"]) {
  const exporter = state.nations[from], partner = state.nations[to];
  if (exporter.overlord || partner.overlord || from.startsWith("civil_") || to.startsWith("civil_"))
    return "双方须为独立国家";
  if (opposingParties(state, from, to)) return "争端对立方无法建立这种关系";
  if (kind === "personalUnion") {
    if (stateForm(exporter) !== "君主制" || stateForm(partner) !== "君主制") return "共主联合需要双方实行君主制";
    if (state.diplomaticTies?.some((tie) => tie.kind === "personalUnion" && (tiePartner(tie, from) || tiePartner(tie, to))))
      return "一方已参加共主联合";
  }
}

export function diplomaticTieCommandError(state: GameState, command: DiplomaticTieCommand) {
  const { countryId, partnerId, kind, type } = command;
  const live = new Set(Object.values(state.ownerByStateId));
  if (countryId === partnerId || !live.has(countryId) || !live.has(partnerId)) return "请选择仍拥有领土的外国";
  const offer = state.diplomaticTieOffers?.find((row) =>
    (row.from === countryId && row.to === partnerId) || (row.from === partnerId && row.to === countryId));
  if (type === "withdrawDiplomaticTie") return offer?.from === countryId && offer.kind === kind ? undefined : "没有可撤回的关系提案";
  if (type === "declineDiplomaticTie") return offer?.to === countryId && offer.kind === kind ? undefined : "没有收到该关系提案";
  const restriction = tieEligibility(state, countryId, partnerId, kind);
  if (restriction) return restriction;
  if (diplomaticTie(state, countryId, partnerId)) return "双方已经建立特殊外交关系";
  if (type === "offerDiplomaticTie") {
    if (offer) return "双方已有待处理的关系提案";
    if (influenceBudget(state, countryId).available < tieInfluence[kind]) return "可用外交影响力不足";
  } else {
    if (offer?.to !== countryId || offer.kind !== kind || state.elapsedDays - offer.offeredDay >= offerLifetime)
      return "没有有效的关系提案";
    const sponsor = influenceBudget(state, partnerId);
    if (influenceBudget(state, countryId).available < tieInfluence[kind] || sponsor.used > sponsor.capacity)
      return "签约双方需要足够的外交影响力";
  }
}

export function applyDiplomaticTieCommand(state: GameState, command: DiplomaticTieCommand): GameState {
  const problem = diplomaticTieCommandError(state, command);
  if (problem) throw new GameRuleError(problem);
  const { countryId, partnerId, kind, type } = command;
  const offers = state.diplomaticTieOffers ?? [];
  if (type === "offerDiplomaticTie") return { ...state,
    diplomaticTieOffers: [...offers, { from: countryId, to: partnerId, kind, offeredDay: state.elapsedDays }] };
  const from = type === "withdrawDiplomaticTie" ? countryId : partnerId;
  const to = type === "withdrawDiplomaticTie" ? partnerId : countryId;
  const diplomaticTieOffers = offers.filter((offer) => offer.from !== from || offer.to !== to);
  if (type !== "acceptDiplomaticTie") return { ...state, diplomaticTieOffers };
  return { ...adjustForeignRelation(state, from, to, 4, 6), diplomaticTieOffers,
    diplomaticTies: [...(state.diplomaticTies ?? []), { senior: from, partner: to, kind, signedDay: state.elapsedDays }] };
}

export function reconcileDiplomaticTies(state: GameState) {
  if (!state.diplomaticTies?.length && !state.diplomaticTieOffers?.length) return state;
  const live = new Set(Object.values(state.ownerByStateId));
  const independent = (id: string) => live.has(id) && state.nations[id].overlord === null;
  const updated = removeDiplomaticTies(state, ({ senior, partner, kind }) =>
    !independent(senior) || !independent(partner) ||
    (state.borderDispute?.phase === "war" && opposingParties(state, senior, partner)) ||
    (kind === "personalUnion" && (stateForm(state.nations[senior]) !== "君主制" || stateForm(state.nations[partner]) !== "君主制")));
  const offers = updated.diplomaticTieOffers?.filter((offer) =>
    independent(offer.from) && independent(offer.to) &&
    state.elapsedDays - offer.offeredDay < offerLifetime && !tieEligibility(updated, offer.from, offer.to, offer.kind) &&
    !diplomaticTie(updated, offer.from, offer.to));
  return offers?.length === updated.diplomaticTieOffers?.length ? updated : { ...updated, diplomaticTieOffers: offers };
}

export function settleAiDiplomaticTieOffers(state: GameState, humanCountries: ReadonlySet<string | null>) {
  let result = reconcileDiplomaticTies(state);
  for (const offer of result.diplomaticTieOffers ?? []) {
    if (humanCountries.has(offer.to)) continue;
    const relation = relationBetween(result, offer.from, offer.to);
    const disposition = relation.standing + diplomaticTrust(relation, offer.to) - 50 -
      0.4 * Math.max(0, result.nations[offer.from].infamy - 24);
    const threshold = offer.kind === "personalUnion" ? 30 : offer.kind === "investiture" ? 10 : 0;
    const accept = { type: "acceptDiplomaticTie", countryId: offer.to, partnerId: offer.from, kind: offer.kind } as const;
    result = applyDiplomaticTieCommand(result, disposition >= threshold && !diplomaticTieCommandError(result, accept) ?
      accept : { ...accept, type: "declineDiplomaticTie" });
  }
  return result;
}
