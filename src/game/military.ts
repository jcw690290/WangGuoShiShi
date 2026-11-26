import { z } from "zod";
import type { GameState } from "./engine.ts";
import type { EconomyReport } from "./economy.ts";
import { localGovernanceRule } from "./governance.ts";
import { bondedRuralWorkers, ruralPopulation } from "./labor.ts";
import { activeReplacements, fitWorkforce, injuredPersonnel } from "./military-health.ts";
import { GameRuleError } from "./rules.ts";
import type { SiteSocial } from "./society.ts";

export const battalionSize = 1000;
export const barracksCapacity = 100;
export const battalionTrainingDays = 12 * 7;
export const battalionKinds = ["infantry", "artillery", "cavalry"] as const;
export type BattalionKind = (typeof battalionKinds)[number];
export const battalionDetails = {
  infantry: { name: "步兵", attack: 10, defense: 10, peace: [5, 5, 10], field: [20, 40, 20] },
  artillery: { name: "炮兵", attack: 20, defense: 5, peace: [10, 10, 10], field: [35, 70, 20] },
  cavalry: { name: "骑兵", attack: 12, defense: 8, peace: [5, 5, 15], field: [20, 40, 30] },
} as const;

export const battalionSlotSchema = z.int().nonnegative().max(Math.floor(Number.MAX_SAFE_INTEGER / battalionSize));
const trainingDay = z.int().nonnegative();
export const battalionOrdersSchema = z.array(z.object({
  slot: battalionSlotSchema, kind: z.enum(battalionKinds), readyDay: trainingDay,
})).refine((orders) => new Set(orders.map((order) => order.slot)).size === orders.length);
export const barracksTrainingSchema = z.array(z.object({ levels: z.int().positive(), readyDay: trainingDay }));

export type BattalionCommand = { type: "reorganizeBattalion"; countryId: string; stateId: string; slot: number; kind: BattalionKind };
export interface Battalion {
  slot: number;
  kind: BattalionKind;
  personnel: number;
  trained: number;
  readyDay: number;
}

export function inTraining(site: SiteSocial, day: number) {
  return (site.barracksTraining ?? []).filter((group) => group.readyDay > day);
}

export function trainNewBarracks(site: SiteSocial, levels: number, day: number) {
  const readyDay = day + battalionTrainingDays;
  const groups = inTraining(site, day);
  const last = groups.at(-1);
  if (last?.readyDay === readyDay) groups[groups.length - 1] = { levels: last.levels + levels, readyDay };
  else groups.push({ levels, readyDay });
  return groups;
}

export function garrisonHeadcount(state: GameState, stateId: string) {
  const site = state.societies[stateId], countryId = state.ownerByStateId[stateId];
  const { laws } = state.nations[countryId], { population } = state.stateEconomies[stateId];
  const { militaryShare } = localGovernanceRule(site, laws);
  const workforce = fitWorkforce(site, population, state.elapsedDays);
  const bonded = bondedRuralWorkers(ruralPopulation(site.pops), site.laborParticipation, laws);
  const quota = Math.floor(Math.min(site.barracks * barracksCapacity, population * 0.03) * militaryShare);
  return Math.max(0, Math.min(workforce - bonded, quota - injuredPersonnel(site).regulars));
}

export function battalionsAt(state: GameState, stateId: string, personnel = garrisonHeadcount(state, stateId)): Battalion[] {
  const site = state.societies[stateId], day = state.elapsedDays;
  const { militaryShare } = localGovernanceRule(site, state.nations[state.ownerByStateId[stateId]].laws);
  const pending = inTraining(site, day);
  let establishedLevels = site.barracks - pending.reduce((total, group) => total + group.levels, 0);
  const replacements = activeReplacements(site, day).filter((group) => group.regulars > 0);
  const replacementPersonnel = replacements.reduce((total, group) => total + group.regulars, 0);
  const trainedCapacity = Math.max(0, Math.min(personnel, Math.floor(establishedLevels * barracksCapacity * militaryShare)) -
    replacementPersonnel);
  const trainingCapacity = pending.map((group) => ({
    readyDay: group.readyDay, through: Math.floor((establishedLevels += group.levels) * barracksCapacity * militaryShare),
  }));
  const orders = new Map((site.battalionOrders ?? []).map((order) => [order.slot, order]));
  return Array.from({ length: Math.ceil(personnel / battalionSize) }, (_, slot) => {
    const start = slot * battalionSize;
    const end = Math.min(start + battalionSize, personnel);
    const order = orders.get(slot);
    const readyDay = Math.max(order?.readyDay ?? 0, trainingCapacity.find((group) => end <= group.through)?.readyDay ?? 0,
      end > trainedCapacity && replacements.length > 0 ? replacements[replacements.length - 1].readyDay : 0);
    const trained = order && order.readyDay > day ? 0 : Math.max(0, Math.min(trainedCapacity, end) - start);
    return { slot, kind: order?.kind ?? "infantry", personnel: end - start, trained, readyDay };
  });
}

export function equipmentNeeds(roster: readonly Battalion[], conscripts: number, field: boolean) {
  const posture = field ? "field" : "peace";
  const totals = battalionDetails.infantry[posture].map((quantity) => quantity * conscripts);
  for (const battalion of roster)
    battalionDetails[battalion.kind][posture].forEach((quantity, index) => { totals[index] += quantity * battalion.personnel; });
  return {
    weapons: Math.ceil(totals[0] / battalionSize),
    ammunition: Math.ceil(totals[1] / battalionSize),
    uniforms: Math.ceil(totals[2] / battalionSize),
  };
}

export function battalionOrderError(state: GameState, cmd: BattalionCommand) {
  if (state.ownerByStateId[cmd.stateId] !== cmd.countryId || state.occupation?.stateId === cmd.stateId)
    return "只能在本国控制的州改编";
  const battalion = battalionsAt(state, cmd.stateId)[cmd.slot];
  if (!battalion) return "这个营当前没有兵员";
  if (battalion.trained !== battalion.personnel) return "须等现有训练完成";
  if (battalion.kind === cmd.kind) return "已经采用该兵种";
}

export function applyBattalionOrder(state: GameState, cmd: BattalionCommand): GameState {
  const error = battalionOrderError(state, cmd);
  if (error) throw new GameRuleError(error);
  const site = state.societies[cmd.stateId];
  const orders = (site.battalionOrders ?? []).filter((order) => order.slot !== cmd.slot);
  orders.push({ slot: cmd.slot, kind: cmd.kind, readyDay: state.elapsedDays + battalionTrainingDays });
  return { ...state, societies: { ...state.societies, [cmd.stateId]: { ...site, battalionOrders: orders } } };
}

export function chooseBattalionOrder(state: GameState, report: EconomyReport, countryId: string): BattalionCommand | undefined {
  if (state.elapsedDays % battalionTrainingDays !== 0 || state.borderDispute?.phase === "war") return;
  const { regulars, equipment } = report.countries[countryId].military;
  if (regulars < 1500 || equipment.ammunition.delivered < equipment.ammunition.demand * 0.9) return;
  const districts = Object.keys(state.ownerByStateId).filter((id) => state.ownerByStateId[id] === countryId);
  const specialized = districts.reduce((total, id) => total +
    (state.societies[id].battalionOrders ?? []).filter((order) => order.kind !== "infantry").length, 0);
  if (specialized >= Math.floor(regulars / 1500)) return;
  const kind = specialized % 2 === 0 ? "artillery" : "cavalry";
  for (const stateId of districts.sort((a, b) => report.states[b].regulars - report.states[a].regulars)) {
    const unit = battalionsAt(state, stateId).find((b) => b.kind === "infantry" && b.trained === b.personnel);
    if (unit) return { type: "reorganizeBattalion", countryId, stateId, slot: unit.slot, kind };
  }
}
