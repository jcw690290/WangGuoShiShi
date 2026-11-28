import { z } from "zod";
import type { GameState } from "./engine.ts";
import { GameRuleError } from "./rules.ts";

export const treatyKinds = ["commercial", "defensive"] as const;
export const treatyKindSchema = z.enum(treatyKinds);
export type TreatyKind = z.infer<typeof treatyKindSchema>;
export const treatyNames = { commercial: "通商协定", defensive: "防御同盟" };
export const treatyInfluence = { commercial: 1, defensive: 2 };
export const diplomaticGiftCost = 25_000;
export const diplomaticAidCost = 50_000;
const giftCooldown = 90;
const offerDuration = 42;
const treatyCommitment = 180;
const day = z.int().nonnegative();
const trust = z.int().min(0).max(100);

export const foreignRelationSchema = z.object({
  a: z.string(), b: z.string(), standing: z.int().min(-100).max(100),
  trustAB: trust, trustBA: trust, giftA: day.nullable(), giftB: day.nullable(),
}).refine(({ a, b }) => a < b);
export type ForeignRelation = z.infer<typeof foreignRelationSchema>;

export const foreignTreatySchema = z.object({ a: z.string(), b: z.string(), kind: treatyKindSchema, signedDay: day })
  .refine(({ a, b }) => a < b);
export type ForeignTreaty = z.infer<typeof foreignTreatySchema>;
export const treatyOfferSchema = z.object({ from: z.string(), to: z.string(), kind: treatyKindSchema, offeredDay: day })
  .refine(({ from, to }) => from !== to);
export type TreatyOffer = z.infer<typeof treatyOfferSchema>;
export const aidOfferSchema = z.object({ from: z.string(), to: z.string(), offeredDay: day })
  .refine(({ from, to }) => from !== to);
export type AidOffer = z.infer<typeof aidOfferSchema>;
export const foreignObligationSchema = z.object({ creditor: z.string(), debtor: z.string(), incurredDay: day })
  .refine(({ creditor, debtor }) => creditor !== debtor);
export type ForeignObligation = z.infer<typeof foreignObligationSchema>;

export type ForeignCommand =
  | { type: "improveRelations"; countryId: string; partnerId: string }
  | { type: "offerDiplomaticAid" | "acceptDiplomaticAid" | "declineDiplomaticAid"; countryId: string; partnerId: string }
  | { type: "offerTreaty" | "acceptTreaty" | "declineTreaty" | "endTreaty"; countryId: string; partnerId: string; kind: TreatyKind };

const canonical = (one: string, other: string) => one < other ? { a: one, b: other } : { a: other, b: one };
export const foreignPairKey = (one: string, other: string) => JSON.stringify(canonical(one, other));
const isPair = (a: string, b: string, one: string, other: string) => (a === one && b === other) || (a === other && b === one);
const bounded = (value: number, lower: number, upper: number) => Math.max(lower, Math.min(upper, value));

export const obligationBetween = (state: GameState, creditor: string, debtor: string) =>
  state.foreignObligations?.find((obligation) => obligation.creditor === creditor && obligation.debtor === debtor);

export function fulfillObligation(state: GameState, obligation: ForeignObligation): GameState {
  return { ...adjustForeignRelation(state, obligation.debtor, obligation.creditor, 4, 6),
    foreignObligations: state.foreignObligations!.filter((row) => row !== obligation) };
}

export function relationBetween(state: GameState, one: string, other: string): ForeignRelation {
  return state.foreignRelations?.find(({ a, b }) => isPair(a, b, one, other)) ??
    { ...canonical(one, other), standing: 0, trustAB: 50, trustBA: 50, giftA: null, giftB: null };
}
export const diplomaticTrust = (relation: ForeignRelation, countryId: string) =>
  relation.a === countryId ? relation.trustAB : relation.trustBA;

export function adjustForeignRelation(state: GameState, actor: string, partner: string, standing: number, partnerTrust: number, gift = false): GameState {
  const prior = relationBetween(state, actor, partner);
  const trustKey = actor === prior.a ? "trustBA" : "trustAB";
  const giftKey = actor === prior.a ? "giftA" : "giftB";
  const updated = {
    ...prior, standing: bounded(prior.standing + standing, -100, 100),
    [trustKey]: bounded(prior[trustKey] + partnerTrust, 0, 100),
    ...(gift ? { [giftKey]: state.elapsedDays } : {}),
  };
  const foreignRelations = (state.foreignRelations ?? []).filter(({ a, b }) => !isPair(a, b, actor, partner));
  return { ...state, foreignRelations: [...foreignRelations, updated] };
}

export const treatyBetween = (state: GameState, one: string, other: string, kind: TreatyKind) =>
  state.foreignTreaties?.find((treaty) => treaty.kind === kind && isPair(treaty.a, treaty.b, one, other));

export function signForeignTreaty(state: GameState, one: string, other: string, kind: TreatyKind): GameState {
  if (treatyBetween(state, one, other, kind)) return state;
  const signed = adjustForeignRelation(adjustForeignRelation(state, one, other, 5, 4), other, one, 0, 4);
  const treatyOffers = (state.treatyOffers ?? []).filter((offer) => !(offer.kind === kind && isPair(offer.from, offer.to, one, other)));
  return { ...signed, treatyOffers, foreignTreaties: [...(state.foreignTreaties ?? []),
    { ...canonical(one, other), kind, signedDay: state.elapsedDays }] };
}

export function treatyPartners(state: GameState, countryId: string, kind: TreatyKind) {
  return (state.foreignTreaties ?? []).flatMap((treaty) => {
    if (treaty.kind !== kind) return [];
    return treaty.a === countryId ? [treaty.b] : treaty.b === countryId ? [treaty.a] : [];
  });
}

export function influenceBudget(state: GameState, countryId: string) {
  const capacity = bounded(2 + Math.floor(state.nations[countryId].prestige / 50), 2, 8);
  const treaties = (state.foreignTreaties ?? []).reduce((sum, treaty) =>
    sum + (treaty.a === countryId || treaty.b === countryId ? treatyInfluence[treaty.kind] : 0), 0);
  const offers = (state.treatyOffers ?? []).reduce((sum, offer) => sum + (offer.from === countryId ? treatyInfluence[offer.kind] : 0), 0) +
    (state.aidOffers ?? []).filter((offer) => offer.from === countryId).length;
  return { capacity, used: treaties + offers, available: Math.max(0, capacity - treaties - offers) };
}

function opposingParties(state: GameState, a: string, b: string) {
  const dispute = state.borderDispute;
  if (!dispute || dispute.phase === "resolved") return false;
  const attackers = [dispute.claimantId, ...dispute.allies], defenders = [dispute.defenderId, ...dispute.defenders];
  return (attackers.includes(a) && defenders.includes(b)) || (attackers.includes(b) && defenders.includes(a));
}

export function foreignCommandError(state: GameState, cmd: ForeignCommand) {
  const { countryId, partnerId } = cmd;
  if (countryId === partnerId || !Object.values(state.ownerByStateId).includes(countryId) ||
      !Object.values(state.ownerByStateId).includes(partnerId)) return "请选择仍拥有领土的外国";
  if (cmd.type === "improveRelations") {
    if (opposingParties(state, countryId, partnerId)) return "争端对立双方无法赠送礼金";
    const relation = relationBetween(state, countryId, partnerId);
    const lastGift = countryId === relation.a ? relation.giftA : relation.giftB;
    if (lastGift !== null && state.elapsedDays - lastGift < giftCooldown) return "两次赠送礼金须相隔至少 90 天";
    if (state.countryEconomies[countryId].treasury < diplomaticGiftCost) return "国库现款不足";
    return;
  }
  if (!("kind" in cmd)) {
    const offer = state.aidOffers?.find((candidate) => isPair(candidate.from, candidate.to, countryId, partnerId));
    if (cmd.type === "declineDiplomaticAid") return offer?.to === countryId ? undefined : "没有收到这项援助提议";
    if (opposingParties(state, countryId, partnerId)) return "争端对立双方无法约定援助";
    if (cmd.type === "offerDiplomaticAid") {
      if (offer) return "已有待处理的援助提议";
      if (obligationBetween(state, countryId, partnerId) || obligationBetween(state, partnerId, countryId))
        return "双方已有待履行的义务";
      if (influenceBudget(state, countryId).available < 1) return "可用外交影响力不足";
      if (state.countryEconomies[countryId].treasury < diplomaticAidCost) return "国库现款不足";
      return;
    }
    if (offer?.to !== countryId) return "没有收到这项援助提议";
    if (state.countryEconomies[partnerId].treasury < diplomaticAidCost) return "援助方国库现款不足";
    const sponsor = influenceBudget(state, partnerId);
    if (sponsor.used > sponsor.capacity) return "援助方外交影响力不足";
    return;
  }
  const treaty = treatyBetween(state, countryId, partnerId, cmd.kind);
  if (cmd.type === "endTreaty") return treaty ? undefined : "未签署该条约";
  const offer = state.treatyOffers?.find((candidate) =>
    candidate.kind === cmd.kind && isPair(candidate.from, candidate.to, countryId, partnerId));
  if (cmd.type === "declineTreaty") return offer?.to === countryId ? undefined : "没有收到该条约提案";
  if (opposingParties(state, countryId, partnerId)) return "争端对立双方无法缔约";
  if (treaty) return "该条约已经生效";
  if (cmd.type === "offerTreaty") {
    if (offer) return "已有待处理的同类提案";
    if (influenceBudget(state, countryId).available < treatyInfluence[cmd.kind]) return "可用外交影响力不足";
    return;
  }
  if (offer?.to !== countryId) return "没有收到该条约提案";
  const proposer = influenceBudget(state, partnerId);
  if (proposer.used > proposer.capacity || influenceBudget(state, countryId).available < treatyInfluence[cmd.kind])
    return "签约双方需要足够的外交影响力";
}

export function applyForeignCommand(state: GameState, cmd: ForeignCommand): GameState {
  const problem = foreignCommandError(state, cmd);
  if (problem) throw new GameRuleError(problem);
  const { countryId, partnerId } = cmd;
  if (cmd.type === "improveRelations") {
    const countries = { ...state.countryEconomies };
    countries[countryId] = { ...countries[countryId], treasury: countries[countryId].treasury - diplomaticGiftCost };
    countries[partnerId] = { ...countries[partnerId], treasury: countries[partnerId].treasury + diplomaticGiftCost };
    return { ...adjustForeignRelation(state, countryId, partnerId, 10, 5, true), countryEconomies: countries };
  }
  if (!("kind" in cmd)) {
    const offers = state.aidOffers ?? [];
    if (cmd.type === "offerDiplomaticAid")
      return { ...state, aidOffers: [...offers, { from: countryId, to: partnerId, offeredDay: state.elapsedDays }] };
    const aidOffers = offers.filter((offer) => !(offer.from === partnerId && offer.to === countryId));
    if (cmd.type === "declineDiplomaticAid") return { ...state, aidOffers };
    const countries = { ...state.countryEconomies };
    countries[partnerId] = { ...countries[partnerId], treasury: countries[partnerId].treasury - diplomaticAidCost };
    countries[countryId] = { ...countries[countryId], treasury: countries[countryId].treasury + diplomaticAidCost };
    return { ...adjustForeignRelation(state, partnerId, countryId, 8, 8), aidOffers, countryEconomies: countries,
      foreignObligations: [...(state.foreignObligations ?? []), {
        creditor: partnerId, debtor: countryId, incurredDay: state.elapsedDays,
      }] };
  }
  const offers = state.treatyOffers ?? [], treaties = state.foreignTreaties ?? [];
  if (cmd.type === "offerTreaty")
    return { ...state, treatyOffers: [...offers, { from: countryId, to: partnerId, kind: cmd.kind, offeredDay: state.elapsedDays }] };
  if (cmd.type === "endTreaty") {
    const treaty = treatyBetween(state, countryId, partnerId, cmd.kind)!;
    const broken = state.elapsedDays - treaty.signedDay < treatyCommitment;
    return { ...adjustForeignRelation(state, countryId, partnerId, broken ? -20 : -5, broken ? -25 : 0),
      foreignTreaties: treaties.filter((candidate) => candidate !== treaty) };
  }
  const treatyOffers = offers.filter((offer) => !(offer.from === partnerId && offer.to === countryId && offer.kind === cmd.kind));
  if (cmd.type === "declineTreaty") return { ...state, treatyOffers };
  return signForeignTreaty(state, countryId, partnerId, cmd.kind);
}

export function expireTreatyOffers(state: GameState) {
  const treatyOffers = state.treatyOffers?.filter((offer) => state.elapsedDays - offer.offeredDay < offerDuration);
  const aidOffers = state.aidOffers?.filter((offer) => state.elapsedDays - offer.offeredDay < offerDuration);
  return treatyOffers?.length === state.treatyOffers?.length && aidOffers?.length === state.aidOffers?.length ?
    state : { ...state, treatyOffers, aidOffers };
}

export function reconcileTreaties(state: GameState) {
  const live = new Set(Object.values(state.ownerByStateId));
  const active = state.foreignTreaties?.filter(({ a, b }) => live.has(a) && live.has(b));
  const offers = state.treatyOffers?.filter(({ from, to }) => live.has(from) && live.has(to));
  const aidOffers = state.aidOffers?.filter(({ from, to }) => live.has(from) && live.has(to));
  const foreignObligations = state.foreignObligations?.filter(({ creditor, debtor }) => live.has(creditor) && live.has(debtor));
  return { ...state, ...(active ? { foreignTreaties: active } : {}), ...(offers ? { treatyOffers: offers } : {}),
    ...(aidOffers ? { aidOffers } : {}), ...(foreignObligations ? { foreignObligations } : {}) };
}

export function breakOpposedTreaties(state: GameState, attacker: string) {
  let result = state;
  const foreignTreaties = state.foreignTreaties?.filter((treaty) => {
    if (!opposingParties(state, treaty.a, treaty.b)) return true;
    const dispute = state.borderDispute!;
    const violator = treaty.a === attacker || dispute.allies.includes(treaty.a) ? treaty.a : treaty.b;
    const partner = violator === treaty.a ? treaty.b : treaty.a;
    result = adjustForeignRelation(result, violator, partner, -20, -25);
    return false;
  });
  const treatyOffers = state.treatyOffers?.filter((offer) => !opposingParties(state, offer.from, offer.to));
  const aidOffers = state.aidOffers?.filter((offer) => !opposingParties(state, offer.from, offer.to));
  return { ...result, ...(foreignTreaties ? { foreignTreaties } : {}), ...(treatyOffers ? { treatyOffers } : {}),
    ...(aidOffers ? { aidOffers } : {}) };
}

export function settleAiForeignOffers(state: GameState, humanCountries: ReadonlySet<string | null>): GameState {
  let result = state;
  for (const offer of state.treatyOffers ?? []) {
    if (humanCountries.has(offer.to)) continue;
    const reply = { type: "acceptTreaty", countryId: offer.to, partnerId: offer.from, kind: offer.kind } as const;
    const relation = relationBetween(result, offer.from, offer.to);
    const suspicion = Math.max(0, result.nations[offer.from].infamy - 24) * 0.4;
    const defensible = offer.kind === "commercial" || result.nations[offer.to].overlord === null;
    const disposition = relation.standing - suspicion + (diplomaticTrust(relation, offer.to) - 50);
    const accept = defensible && disposition >= (offer.kind === "commercial" ? 0 : 18) && !foreignCommandError(result, reply);
    result = applyForeignCommand(result, accept ? reply : { ...reply, type: "declineTreaty" });
  }
  for (const offer of result.aidOffers ?? []) {
    if (humanCountries.has(offer.to)) continue;
    const reply = { type: "acceptDiplomaticAid", countryId: offer.to, partnerId: offer.from } as const;
    const relation = relationBetween(result, offer.from, offer.to);
    const trust = diplomaticTrust(relation, offer.to);
    const accept = trust >= 35 && relation.standing >= -10 && result.nations[offer.from].infamy < 75 &&
      !foreignCommandError(result, reply);
    result = applyForeignCommand(result, accept ? reply : { ...reply, type: "declineDiplomaticAid" });
  }
  return result;
}
