import { z } from "zod";
import { disputeSchema, goals, peaceGoalsSchema, supplyPriorities } from "../game/diplomacy.ts";
import { dispatch } from "../game/engine.ts";
import type { GameState } from "../game/engine.ts";
import { GameRuleError } from "../game/rules.ts";
import { groups, laws, projectTypes, techs } from "../game/society.ts";
import { governanceModes } from "../game/governance.ts";
import { goods } from "../game/industry.ts";
import { institutionCommands, institutionLevelSchema } from "../game/institutions.ts";
import { exciseGoodsSchema, taxBandSchema } from "../game/taxation.ts";
import { tariffBandSchema } from "../game/trade-policy.ts";
import { industrySubsidyLimit } from "../game/industrial.ts";
import { battalionEquipment, battalionKinds, battalionSlotSchema } from "../game/military.ts";
import { navalMissionSchema } from "../game/naval-operations.ts";
import { treatyKindSchema } from "../game/foreign-relations.ts";
import { tradeLimit, tradeModes } from "../game/trade.ts";
import { parseSave } from "../game/storage.ts";
import type { Scenario } from "../scenario/scenario.ts";

export const protocolVersion = 1;
export const speeds = [0, 1000, 2000, 4000] as const;
export type Speed = (typeof speeds)[number];
const id = z.string().regex(/^[\w-]{1,64}$/);
const seq = z.int().nonnegative();
const commandSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("claimState"), stateId: id }),
  z.strictObject({ type: z.literal("setLocalGovernance"), countryId: id, stateId: id, mode: z.enum(governanceModes) }),
  z.strictObject({ type: z.literal(["startIntegration", "cancelIntegration"]), countryId: id, stateId: id }),
  z.strictObject({ type: z.literal("negotiateLocalUnrest"), countryId: id, stateId: id }),
  z.strictObject({ type: z.literal("openTradeRoute"), countryId: id, from: id, to: id, good: z.enum(goods),
    mode: z.enum(tradeModes).optional(), limit: tradeLimit }),
  z.strictObject({ type: z.literal("setTradeRoute"), countryId: id, from: id, to: id, good: z.enum(goods),
    mode: z.enum(tradeModes).optional(), limit: tradeLimit, paused: z.boolean() }),
  z.strictObject({ type: z.literal("removeTradeRoute"), countryId: id, from: id, to: id, good: z.enum(goods),
    mode: z.enum(tradeModes).optional() }),
  z.strictObject({ type: z.literal("queueConstruction"), countryId: id, stateId: id, good: z.enum(projectTypes), privateBuild: z.boolean().optional() }),
  z.strictObject({ type: z.literal("cancelConstruction"), countryId: id, index: seq, stateId: id, good: z.enum(projectTypes), privateBuild: z.boolean().optional() }),
  z.strictObject({ type: z.literal("setConvoyOrder"), countryId: id, stateId: id, operation: z.enum(["add", "move", "cancel"]) }),
  z.strictObject({ type: z.literal("setWarshipOrder"), countryId: id, stateId: id, operation: z.enum(["add", "move", "cancel"]) }),
  z.strictObject({ type: z.literal("setFleetMotorization"), countryId: id, stateId: id, enabled: z.boolean() }),
  z.strictObject({ type: z.enum(institutionCommands), countryId: id, stateId: id, level: institutionLevelSchema }),
  z.strictObject({ type: z.literal("setTaxBand"), countryId: id, band: taxBandSchema }),
  z.strictObject({ type: z.literal("setExciseGoods"), countryId: id, goods: exciseGoodsSchema }),
  z.strictObject({ type: z.literal("setTariffBand"), countryId: id, band: tariffBandSchema }),
  z.strictObject({ type: z.literal("setTradePartner"), countryId: id, partnerId: id, allowed: z.boolean() }),
  z.strictObject({ type: z.literal("setIndustrySubsidy"), countryId: id, stateId: id, limit: industrySubsidyLimit }),
  z.strictObject({ type: z.literal("reorganizeBattalion"), countryId: id, stateId: id, slot: battalionSlotSchema, kind: z.enum(battalionKinds) }),
  z.strictObject({ type: z.literal("setBattalionEquipment"), countryId: id, stateId: id, slot: battalionSlotSchema, equipment: z.enum(battalionEquipment).nullable() }),
  z.strictObject({ type: z.literal("setGovernment"), countryId: id, government: z.array(z.enum(groups)).max(groups.length) }),
  z.strictObject({ type: z.literal("proposeLaw"), countryId: id, law: z.enum(laws) }),
  z.strictObject({ type: z.literal("startResearch"), countryId: id, tech: z.enum(techs) }),
  z.strictObject({ type: z.literal("declareInterest"), countryId: id, targetStateId: id }),
  z.strictObject({ type: z.literal("demandBorder"), countryId: id, targetStateId: id, goal: z.enum(goals) }),
  z.strictObject({ type: z.literal("addGoal"), countryId: id, goal: z.enum(goals) }),
  z.strictObject({ type: z.literal("proposePeace"), countryId: id, goals: peaceGoalsSchema, commercial: z.boolean() }),
  z.strictObject({ type: z.literal(["acceptPeace", "rejectPeace"]), countryId: id }),
  z.strictObject({ type: z.literal("sway"), countryId: id, allyId: id }),
  z.strictObject({ type: z.literal("joinUnion"), countryId: id, leaderId: id }),
  z.strictObject({ type: z.literal("endDiplomaticTie"), countryId: id, partnerId: id }),
  z.strictObject({ type: z.literal("improveRelations"), countryId: id, partnerId: id }),
  z.strictObject({ type: z.literal(["offerTreaty", "acceptTreaty", "declineTreaty", "endTreaty"]),
    countryId: id, partnerId: id, kind: treatyKindSchema }),
  z.strictObject({ type: z.literal("setFrontOrder"), countryId: id, objective: id.nullable(), priority: z.enum(supplyPriorities) }),
  z.strictObject({ type: z.literal("setNavalMission"), countryId: id, mission: navalMissionSchema.nullable() }),
  z.strictObject({ type: z.literal(["backDown", "mobilize", "orderAdvance", "orderDefend", "orderRetreat", "raid", "signTreaty", "armistice", "promoteGeneral", "leaveUnion"]), countryId: id }),
]);
export const memberSchema = z.object({ user: z.uuid(), country: id.nullable() });
export const commandResultSchema = z.object({ id: seq, error: z.string().nullable() });
export const roomSchema = z.object({
  id: z.uuid(),
  code: z.string().regex(/^[A-F0-9]{12}$/),
  host: z.uuid(),
  scenario: id,
  protocol: z.int(),
  version: seq,
  status: z.enum(["lobby", "playing"]),
  speed: z.literal(speeds),
  hostOnline: z.boolean(),
  members: z.array(memberSchema).min(1),
  checkpointVersion: seq,
  snapshot: z.string().nullable(),
  day: z.object({ elapsedDays: seq, borderDispute: disputeSchema.nullable() }).nullable(),
  pending: z.array(z.object({ id: seq, country: id, command: z.unknown() })),
  results: z.array(commandResultSchema),
});
export type Room = z.infer<typeof roomSchema>;

export function applyPlayerCommand(scenario: Scenario, state: GameState, country: string, input: unknown) {
  const parsed = commandSchema.safeParse(input);
  if (!parsed.success) throw new GameRuleError("无效的联机指令");
  const command = parsed.data;
  if ("countryId" in command && command.countryId !== country)
    throw new GameRuleError("只能操作自己控制的国家");
  const result = dispatch(scenario, { ...state, playerCountryId: country }, command);
  return { ...result, playerCountryId: state.playerCountryId };
}

export async function encodeSnapshot(scenario: Scenario, state: GameState) {
  const { tickInDay, settings, ...world } = state;
  if (state.campaign) throw new GameRuleError("单机战役不能作为联机快照");
  if (tickInDay !== 0) throw new GameRuleError("联机快照必须在日界提交");
  if (settings.difficulty !== "standard" || settings.difficultyHistory.length !== 1 || settings.tuning)
    throw new GameRuleError("联机房间使用标准规则");
  // Protocol 1 clients share the existing whole-day snapshot format.
  const envelope = JSON.stringify({ version: 5, scenarioId: scenario.id, weeklyConstruction: true, state: world });
  const stream = new Blob([envelope]).stream().pipeThrough(new CompressionStream("gzip"));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""));
}

export async function decodeSnapshot(scenario: Scenario, snapshot: string) {
  const bytes = Uint8Array.from(atob(snapshot), (char) => char.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return parseSave(scenario, await new Response(stream).json());
}
