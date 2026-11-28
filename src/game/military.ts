import { occupationAt } from "./conflict-state.ts";
import { z } from "zod";
import type { GameState } from "./engine.ts";
import type { EconomyReport } from "./economy.ts";
import { localGovernanceRule } from "./governance.ts";
import { bondedRuralWorkers, recruitableMilitaryWorkers, ruralPopulation } from "./labor.ts";
import { activeReplacements, fitWorkforce, injuredPersonnel } from "./military-health.ts";
import { GameRuleError } from "./rules.ts";
import { militaryServicePolicy } from "./military-service.ts";
import type { Nation, SiteSocial, Tech } from "./society.ts";

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
export const battalionEquipment = ["standard", "line", "breech", "repeating", "modernArtillery", "mechanized"] as const;
export type BattalionEquipment = (typeof battalionEquipment)[number];
export const equipmentDetails = {
  standard: { name: "基础装备", technology: null, kinds: battalionKinds, attack: 1, defense: 1,
    arms: 1, ammo: 1, refit: [0, 0] },
  line: { name: "线列操练", technology: "线列训练", kinds: ["infantry", "cavalry"], attack: 1.08, defense: 1.15,
    arms: 1, ammo: 1, refit: [2, 6] },
  breech: { name: "后膛装备", technology: "后膛装备", kinds: ["infantry", "cavalry"], attack: 1.18, defense: 1.22,
    arms: 1.2, ammo: 1.25, refit: [18, 20] },
  repeating: { name: "连发装备", technology: "连发装备", kinds: ["infantry", "cavalry"], attack: 1.35, defense: 1.45,
    arms: 1.4, ammo: 1.6, refit: [28, 36] },
  modernArtillery: { name: "现代火炮", technology: "现代火炮", kinds: ["artillery"], attack: 1.35, defense: 1.2,
    arms: 1.5, ammo: 1.6, refit: [40, 60] },
  mechanized: { name: "机械化步兵", technology: "机械化组织", kinds: ["infantry"], attack: 1.55, defense: 1.5,
    arms: 1.55, ammo: 1.75, refit: [45, 48, 20, 16] },
} as const satisfies Record<BattalionEquipment, {
  name: string; technology: Tech | null; kinds: readonly BattalionKind[]; attack: number; defense: number;
  arms: number; ammo: number; refit: readonly [number, number, number?, number?];
}>;

export const equipmentFits = (kind: BattalionKind, equipment: BattalionEquipment) =>
  (equipmentDetails[equipment].kinds as readonly BattalionKind[]).includes(kind);
export const trainingDays = (nation: Nation) => nation.knowledge["常备军组织"] === 100 ? 70 : battalionTrainingDays;
export const commandCapacity = (nation: Nation) => (nation.knowledge["参谋组织"] === 100 ? 400 : 300) * nation.generalRank;

export const battalionSlotSchema = z.int().nonnegative().max(Math.floor(Number.MAX_SAFE_INTEGER / battalionSize));
const trainingDay = z.int().nonnegative();
const battalionOrderSchema = z.object({
  slot: battalionSlotSchema, kind: z.enum(battalionKinds), readyDay: trainingDay,
  equipment: z.enum(battalionEquipment).default("standard"),
  pendingEquipment: z.enum(battalionEquipment).optional(),
}).refine((order) => equipmentFits(order.kind, order.equipment) &&
  (order.pendingEquipment === undefined || (order.equipment !== order.pendingEquipment && equipmentFits(order.kind, order.pendingEquipment))));
export const battalionOrdersSchema = z.array(battalionOrderSchema)
  .refine((orders) => new Set(orders.map((order) => order.slot)).size === orders.length);
export type BattalionOrder = z.infer<typeof battalionOrderSchema>;
export const barracksTrainingSchema = z.array(z.object({ levels: z.int().positive(), readyDay: trainingDay }));

type BattalionLocation = { countryId: string; stateId: string; slot: number };
export type BattalionCommand = BattalionLocation & { type: "reorganizeBattalion"; kind: BattalionKind };
export type BattalionEquipmentCommand = BattalionLocation & { type: "setBattalionEquipment"; equipment: BattalionEquipment | null };
export interface Battalion {
  slot: number;
  kind: BattalionKind;
  personnel: number;
  trained: number;
  readyDay: number;
  equipment: BattalionEquipment;
  pendingEquipment?: BattalionEquipment;
}

export function inTraining(site: SiteSocial, day: number) {
  return (site.barracksTraining ?? []).filter((group) => group.readyDay > day);
}

export function trainNewBarracks(site: SiteSocial, levels: number, day: number, duration = battalionTrainingDays) {
  const readyDay = day + duration;
  const groups = inTraining(site, day);
  const match = groups.findIndex((group) => group.readyDay === readyDay);
  if (match >= 0) groups[match] = { levels: groups[match].levels + levels, readyDay };
  else groups.push({ levels, readyDay });
  return groups.sort((a, b) => a.readyDay - b.readyDay);
}

export function garrisonHeadcount(state: GameState, stateId: string) {
  const site = state.societies[stateId], countryId = state.ownerByStateId[stateId];
  const { laws } = state.nations[countryId], { population } = state.stateEconomies[stateId];
  const { militaryShare } = localGovernanceRule(site, laws);
  const workforce = fitWorkforce(site, population, state.elapsedDays);
  const bonded = bondedRuralWorkers(ruralPopulation(site.pops), site.laborParticipation, laws);
  const quota = Math.floor(Math.min(site.barracks * militaryServicePolicy(laws).regularsPerBarracks, population * 0.03) * militaryShare);
  const injured = injuredPersonnel(site);
  const available = recruitableMilitaryWorkers(site, laws) - injured.regulars - injured.conscripts;
  return Math.max(0, Math.min(workforce - bonded, quota - injured.regulars, available));
}

export function draftCenterQuota(site: SiteSocial, laws: Nation["laws"]) {
  const { militaryShare } = localGovernanceRule(site, laws);
  return Math.max(0, Math.floor(site.conscription * militaryServicePolicy(laws).reservesPerCenter * militaryShare) -
    injuredPersonnel(site).conscripts);
}

export function battalionsAt(state: GameState, stateId: string, personnel = garrisonHeadcount(state, stateId)): Battalion[] {
  const site = state.societies[stateId], day = state.elapsedDays;
  const { laws } = state.nations[state.ownerByStateId[stateId]];
  const { militaryShare } = localGovernanceRule(site, laws);
  const capacity = militaryServicePolicy(laws).regularsPerBarracks * militaryShare;
  const pending = inTraining(site, day);
  let establishedLevels = site.barracks - pending.reduce((total, group) => total + group.levels, 0);
  const replacements = activeReplacements(site, day).filter((group) => group.regulars > 0);
  const replacementPersonnel = replacements.reduce((total, group) => total + group.regulars, 0);
  const trainedCapacity = Math.max(0, Math.min(personnel, Math.floor(establishedLevels * capacity)) -
    replacementPersonnel);
  const trainingCapacity = pending.map((group) => ({
    readyDay: group.readyDay, through: Math.floor((establishedLevels += group.levels) * capacity),
  }));
  const orders = new Map((site.battalionOrders ?? []).map((order) => [order.slot, order]));
  return Array.from({ length: Math.ceil(personnel / battalionSize) }, (_, slot) => {
    const start = slot * battalionSize;
    const end = Math.min(start + battalionSize, personnel);
    const order = orders.get(slot);
    const readyDay = Math.max(order?.readyDay ?? 0, trainingCapacity.find((group) => end <= group.through)?.readyDay ?? 0,
      end > trainedCapacity && replacements.length > 0 ? replacements[replacements.length - 1].readyDay : 0);
    const trained = order && order.readyDay > day ? 0 : Math.max(0, Math.min(trainedCapacity, end) - start);
    return { slot, kind: order?.kind ?? "infantry", personnel: end - start, trained, readyDay,
      equipment: order?.equipment ?? "standard", ...(order?.pendingEquipment ? { pendingEquipment: order.pendingEquipment } : {}) };
  });
}

export function equipmentNeeds(roster: readonly Battalion[], conscripts: number, field: boolean) {
  const posture = field ? "field" : "peace";
  const totals = battalionDetails.infantry[posture].map((quantity) => quantity * conscripts);
  let mechanized = 0;
  for (const battalion of roster) {
    const [arms, ammo, uniforms] = battalionDetails[battalion.kind][posture];
    const equipment = equipmentDetails[battalion.equipment];
    totals[0] += arms * equipment.arms * battalion.personnel;
    totals[1] += ammo * equipment.ammo * battalion.personnel;
    totals[2] += uniforms * battalion.personnel;
    if (battalion.equipment === "mechanized") mechanized += battalion.personnel;
  }
  return {
    weapons: Math.ceil(totals[0] / battalionSize),
    ammunition: Math.ceil(totals[1] / battalionSize),
    uniforms: Math.ceil(totals[2] / battalionSize),
    fuel: Math.ceil(mechanized * (field ? 25 : 5) / battalionSize),
    spares: Math.ceil(mechanized * (field ? 12 : 3) / battalionSize),
  };
}

export function refitOrder(unit: Battalion) {
  const [weapons, ammunition, fuel = 0, spares = 0] = equipmentDetails[unit.pendingEquipment!].refit;
  return {
    weapons: Math.ceil(weapons * unit.personnel / battalionSize),
    ammunition: Math.ceil(ammunition * unit.personnel / battalionSize),
    uniforms: 0,
    fuel: Math.ceil(fuel * unit.personnel / battalionSize),
    spares: Math.ceil(spares * unit.personnel / battalionSize),
  };
}

export function battalionOrderError(state: GameState, cmd: BattalionCommand) {
  if (state.ownerByStateId[cmd.stateId] !== cmd.countryId || !!occupationAt(state, cmd.stateId))
    return "只能在本国控制的州改编";
  const battalion = battalionsAt(state, cmd.stateId)[cmd.slot];
  if (!battalion) return "这个营当前没有兵员";
  if (battalion.pendingEquipment) return "该营有未交付的换装订单";
  if (battalion.trained !== battalion.personnel) return "须等现有训练完成";
  if (battalion.kind === cmd.kind) return "已经采用该兵种";
}

export function applyBattalionOrder(state: GameState, cmd: BattalionCommand): GameState {
  const error = battalionOrderError(state, cmd);
  if (error) throw new GameRuleError(error);
  const site = state.societies[cmd.stateId];
  const unit = battalionsAt(state, cmd.stateId)[cmd.slot];
  const orders = (site.battalionOrders ?? []).filter((order) => order.slot !== cmd.slot);
  orders.push({ slot: cmd.slot, kind: cmd.kind,
    equipment: equipmentFits(cmd.kind, unit.equipment) ? unit.equipment : "standard",
    readyDay: state.elapsedDays + trainingDays(state.nations[cmd.countryId]) });
  return { ...state, societies: { ...state.societies, [cmd.stateId]: { ...site, battalionOrders: orders } } };
}

export function equipmentOrderError(state: GameState, cmd: BattalionEquipmentCommand) {
  if (state.ownerByStateId[cmd.stateId] !== cmd.countryId || !!occupationAt(state, cmd.stateId))
    return "只能在本国控制的州换装";
  if (cmd.equipment === null)
    return state.societies[cmd.stateId].battalionOrders?.some((order) => order.slot === cmd.slot && order.pendingEquipment) ?
      undefined : "没有待交付的换装订单";
  const unit = battalionsAt(state, cmd.stateId)[cmd.slot];
  if (!unit) return "这个营当前没有兵员";
  if (unit.trained !== unit.personnel) return "须等现有训练完成";
  if (cmd.equipment === unit.equipment || cmd.equipment === unit.pendingEquipment) return "该营已采用或订购这种装备";
  if (!equipmentFits(unit.kind, cmd.equipment)) return "该装备不适用于这个兵种";
  const technology = equipmentDetails[cmd.equipment].technology;
  if (technology && state.nations[cmd.countryId].knowledge[technology] !== 100) return `尚未掌握${technology}`;
}

export function applyEquipmentOrder(state: GameState, cmd: BattalionEquipmentCommand): GameState {
  const error = equipmentOrderError(state, cmd);
  if (error) throw new GameRuleError(error);
  const site = state.societies[cmd.stateId];
  if (cmd.equipment === null) {
    const battalionOrders = site.battalionOrders!.map((order) => {
      if (order.slot !== cmd.slot) return order;
      const { pendingEquipment: _cancelled, ...retained } = order;
      return retained;
    });
    return { ...state, societies: { ...state.societies, [cmd.stateId]: { ...site, battalionOrders } } };
  }
  const { slot, kind, equipment } = battalionsAt(state, cmd.stateId)[cmd.slot];
  const orders = (site.battalionOrders ?? []).filter((order) => order.slot !== slot);
  orders.push({ slot, kind, equipment, readyDay: 0, pendingEquipment: cmd.equipment });
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
    const unit = battalionsAt(state, stateId).find((b) => b.kind === "infantry" && b.trained === b.personnel && !b.pendingEquipment);
    if (unit) return { type: "reorganizeBattalion", countryId, stateId, slot: unit.slot, kind };
  }
}

export function chooseEquipmentOrder(state: GameState, report: EconomyReport, countryId: string): BattalionEquipmentCommand | undefined {
  if (state.elapsedDays % battalionTrainingDays !== 0 || state.borderDispute?.phase === "war") return;
  const { military: { equipment: { weapons, ammunition } }, market } = report.countries[countryId];
  if (weapons.demand === 0 || weapons.delivered < weapons.demand || ammunition.delivered < ammunition.demand) return;
  const available = [...battalionEquipment].reverse().filter((gear) => {
    const { technology } = equipmentDetails[gear];
    return technology !== null && state.nations[countryId].knowledge[technology] === 100 &&
      (gear !== "mechanized" || (market.oil.supply > 0 && market.rubber.supply > 0));
  });
  if (available.length === 0) return;
  for (const [stateId, owner] of Object.entries(state.ownerByStateId)) {
    if (owner !== countryId) continue;
    for (const unit of battalionsAt(state, stateId)) {
      if (unit.pendingEquipment || unit.trained !== unit.personnel) continue;
      const equipment = available.find((gear) => equipmentFits(unit.kind, gear));
      if (equipment && equipment !== unit.equipment)
        return { type: "setBattalionEquipment", countryId, stateId, slot: unit.slot, equipment };
    }
  }
}
