import { GameRuleError } from "./rules.ts";
import { z } from "zod";
import { diplomaticTie, removeDiplomaticTies } from "./diplomatic-ties.ts";
import { localGovernanceRule, newFrontier } from "./governance.ts";
import { connectedRailway, convoyCargoCapacity, portCapacity } from "./transport.ts";
import { effectiveConvoyCapacity } from "./fleet.ts";
import type { MaritimeTerminal } from "./transport.ts";
import { unrestEffects } from "./unrest.ts";
import type { Scenario } from "../scenario/scenario.ts";
import type { GameState } from "./engine.ts";
import type { EconomyReport } from "./economy.ts";
import { projectOpeningCapital } from "./economy.ts";
import { ruleTuning } from "./settings.ts";
import { syncOccupation } from "./occupation.ts";
import { adjustForeignRelation, breakOpposedTreaties, diplomaticTrust, expireTreatyOffers, influenceBudget, reconcileTreaties,
  fulfillObligation, obligationBetween, relationBetween, signForeignTreaty, treatyBetween,
  treatyInfluence, treatyPartners } from "./foreign-relations.ts";
import { governmentLegitimacy, hash, influence, unrestOf } from "./society.ts";
import { battalionDetails, battalionTrainingDays, battalionsAt, commandCapacity, equipmentDetails, garrisonHeadcount } from "./military.ts";
import { applyMilitaryLoss, warLossesSchema } from "./military-health.ts";
import { fleetPower, navalMissionSchema, navalMissionTargets, planNavalOperations } from "./naval-operations.ts";
import type { NavalMissionCommand } from "./naval-operations.ts";
import { recognizeTerritorialClaim, reconcileTerritorialPlans, settlementAt, territorialClaim, territorialClaimError } from "./territory.ts";
import type { TerritorialClaimCommand } from "./territory.ts";
import { minOpiumClaim, opiumEffects, recentOpiumLosses } from "./opium.ts";

export const goals = ["cession", "reparations", "puppet", "vassal", "protectorate", "annex", "recognition", "haltSettlement", "opiumCompensation"] as const;
export type Goal = (typeof goals)[number];
export const goalNames = {
  cession: "割让争端州",
  reparations: "支付赔款",
  puppet: "成为傀儡国",
  vassal: "成为封臣",
  protectorate: "成为保护国",
  annex: "吞并附属国",
  recognition: "承认领土宣称",
  haltSettlement: "终止领土项目",
  opiumCompensation: "赔偿鸦片贸易损失",
};
export function subjectGoal(g: Goal): g is "puppet" | "vassal" | "protectorate" {
  return g === "puppet" || g === "vassal" || g === "protectorate";
}
function unrecognizedClaim(state: GameState, claimantId: string, defenderId: string, targetStateId: string) {
  const claim = territorialClaim(state, claimantId, targetStateId);
  return claim !== undefined && !claim.recognizedBy.includes(defenderId);
}

const transfersLand = (goal: Goal) => goal === "cession" || goal === "annex";

export function canDemandGoal(state: GameState, claimantId: string, defenderId: string, goal: Goal, targetStateId: string) {
  return (
    goal !== "haltSettlement" && goal !== "opiumCompensation" &&
    !treatyBetween(state, claimantId, defenderId, "defensive") &&
    (goal !== "annex" || state.nations[defenderId].overlord === claimantId) &&
    (goal !== "recognition" || unrecognizedClaim(state, claimantId, defenderId, targetStateId)) &&
    (!subjectGoal(goal) || !state.nations[claimantId].marketLeader)
  );
}

export function canAddGoal(state: GameState, dispute: BorderDispute, goal: Goal) {
  return (
    !dispute.goals.includes(goal) &&
    (!subjectGoal(goal) || !dispute.goals.some(subjectGoal)) &&
    (goal !== "recognition" || !dispute.goals.some(transfersLand)) &&
    (!transfersLand(goal) || !dispute.goals.includes("recognition")) &&
    canDemandGoal(state, dispute.claimantId, dispute.defenderId, goal, dispute.targetStateId)
  );
}

function demandInfamy(state: GameState, claimantId: string, defenderId: string, targetStateId: string, goal: Goal) {
  if (goal === "annex") return 3;
  if (goal === "recognition") return 4;
  if (goal === "haltSettlement" || goal === "opiumCompensation") return 6;
  if (goal === "cession" && territorialClaim(state, claimantId, targetStateId)?.recognizedBy.includes(defenderId)) return 6;
  return 12;
}

export const peaceGoalsSchema = z.array(z.enum(goals)).max(goals.length)
  .refine((terms) => new Set(terms).size === terms.length);
const peaceOfferSchema = z.object({
  from: z.string(), goals: peaceGoalsSchema, commercial: z.boolean(), offeredDay: z.int().nonnegative(),
});
type PeaceOffer = z.infer<typeof peaceOfferSchema>;
const peaceOfferDuration = 14;

const mobilizationBaseDays = 28;
const mobilizationDelayDays = 7;
const mobilizationPlanSchema = z.object({
  orderedDay: z.int().nonnegative(),
  readyDay: z.int().nonnegative(),
  origins: z.array(z.string()).nonempty().refine((sites) => new Set(sites).size === sites.length),
}).refine(({ orderedDay, readyDay }) =>
  [0, 1, 2].some((delay) => readyDay - orderedDay === mobilizationBaseDays + delay * mobilizationDelayDays));
export const supplyPriorities = ["front", "balanced", "civilian"] as const;
export const supplyPriorityDetails = {
  front: { name: "前线优先", share: 1 },
  balanced: { name: "军民兼顾", share: 0.8 },
  civilian: { name: "保障民用", share: 0.55 },
} as const;
const frontOrderSchema = z.object({ objective: z.string().nullable(), priority: z.enum(supplyPriorities) });
type FrontOrder = z.infer<typeof frontOrderSchema>;

export const disputeSchema = z.object({
  targetStateId: z.string(),
  settlementStateId: z.string().optional(),
  opiumClaim: z.object({ loss: z.int().min(minOpiumClaim), paid: z.int().nonnegative().optional() })
    .refine((claim) => claim.paid === undefined || claim.paid <= claim.loss).optional(),
  claimantId: z.string(),
  defenderId: z.string(),
  phase: z.enum(["escalation", "bargaining", "countdown", "war", "resolved"]),
  since: z.int().nonnegative(),
  goals: z.array(z.enum(goals)).min(1),
  unacceptedGoals: z.array(z.enum(goals)).nonempty().optional(),
  peaceOffer: peaceOfferSchema.optional(),
  lastPeaceOfferDay: z.int().nonnegative().optional(),
  agreedPeace: z.object({ goals: peaceGoalsSchema, commercial: z.boolean() }).optional(),
  maneuvers: z.int().nonnegative(),
  allies: z.array(z.string()),
  promises: z.array(z.string()),
  defenders: z.array(z.string()),
  containment: z.array(z.string()).optional(),
  mobilized: z.array(z.string()),
  mobilization: z.record(z.string(), mobilizationPlanSchema).optional(),
  losses: z.record(z.string(), warLossesSchema).optional(),
  advance: z.array(z.string()),
  retreating: z.array(z.string()).optional(),
  frontOrders: z.record(z.string(), frontOrderSchema).optional(),
  raid: z.array(z.string()),
  navalMissions: z.record(z.string(), navalMissionSchema).optional(),
  progress: z.int().min(0).max(100),
  lastChange: z.int().nullable(),
  outcome: z.enum(["victory", "withdrawal", "statusQuo"]).nullable(),
});
export type BorderDispute = z.infer<typeof disputeSchema>;
export function infamyLevel(infamy: number) {
  return infamy < 25 ? "常规警惕" : infamy < 50 ? "合作受阻" : infamy < 75 ? "联合风险" : "遏制风险";
}

export const swayCost = (infamy: number) => infamy < 25 ? 1 : infamy < 75 ? 2 : 3;
export type BorderCommand =
  | { type: "declareInterest"; countryId: string; targetStateId: string }
  | { type: "demandBorder"; countryId: string; targetStateId: string; goal: Goal }
  | { type: "addGoal"; countryId: string; goal: Goal }
  | { type: "sway"; countryId: string; allyId: string; useObligation?: boolean }
  | { type: "proposePeace"; countryId: string; goals: Goal[]; commercial: boolean }
  | { type: "acceptPeace" | "rejectPeace"; countryId: string }
  | ({ type: "setFrontOrder"; countryId: string } & FrontOrder)
  | NavalMissionCommand
  | { type: "endDiplomaticTie"; countryId: string; partnerId: string }
  | { type: "joinContainment"; countryId: string }
  | { type: "challengeTerritorialSettlement"; countryId: string; stateId: string }
  | { type: "demandOpiumCompensation"; countryId: string; stateId: string }
  | {
      type:
        | "backDown"
        | "mobilize"
        | "orderAdvance"
        | "orderDefend"
        | "orderRetreat"
        | "raid"
        | "signTreaty"
        | "armistice"
        | "promoteGeneral"
        | "leaveUnion";
      countryId: string;
    }
  | { type: "joinUnion"; countryId: string; leaderId: string };
export function holdings(scenario: Scenario, state: GameState, owner: string) {
  return Object.values(scenario.states).filter((s) => state.ownerByStateId[s.id] === owner);
}
export function landBorder(scenario: Scenario, state: GameState, id: string, target: string) {
  return scenario.states[target].neighbors.some((n) => state.ownerByStateId[n] === id);
}
export function canReach(
  scenario: Scenario,
  state: GameState,
  id: string,
  target: string,
  hasPort?: boolean,
) {
  const site = scenario.states[target];
  return (
    site &&
    Object.hasOwn(state.ownerByStateId, target) &&
    state.ownerByStateId[target] !== id &&
    (landBorder(scenario, state, id, target) ||
      (site.coastal && (hasPort ?? holdings(scenario, state, id).some((s) => s.coastal))))
  );
}

export function settlementChallengeError(scenario: Scenario, state: GameState, countryId: string, stateId: string) {
  const project = settlementAt(state, stateId);
  if (!project || project.countryId === countryId) return "只可对他国进行中的领土项目提出异议";
  if (state.borderDispute && state.borderDispute.phase !== "resolved") return "当前已有地区博弈";
  if (!territorialClaim(state, countryId, stateId) || state.nations[countryId].overlord)
    return "本国需独立并持有该地区的宣称";
  if (state.ownerByStateId[project.anchorId] !== project.countryId || !canReach(scenario, state, countryId, project.anchorId))
    return "需要能接触主持项目的来源州";
  if (treatyBetween(state, countryId, project.countryId, "defensive")) return "防御盟国之间不能发起异议";
}

export function opiumDemandError(scenario: Scenario, state: GameState, countryId: string, stateId: string) {
  if (state.borderDispute && state.borderDispute.phase !== "resolved") return "当前已有地区博弈";
  if ((recentOpiumLosses(state, countryId).get(stateId) ?? 0) < minOpiumClaim) return "近期实际贸易损失不足";
  const partner = state.ownerByStateId[stateId];
  if (state.nations[countryId].overlord || !canReach(scenario, state, countryId, stateId) ||
      !interested(scenario, state, countryId, stateId)) return "需要独立且在可达的目标州拥有地区利益";
  if (treatyBetween(state, countryId, partner, "defensive")) return "防御盟国之间不能提出该赔偿要求";
}

function openDispute(state: GameState, id: string, target: string, goal: Goal,
  context: Pick<BorderDispute, "settlementStateId" | "opiumClaim"> = {}): GameState {
  const defender = state.ownerByStateId[target], nation = state.nations[id];
  const defenders = new Set(Object.keys(state.nations).filter((countryId) =>
    countryId !== id && countryId !== defender &&
    ((state.nations[countryId].overlord === defender && state.nations[countryId].subjectType !== "protectorate") ||
      countryId === state.nations[defender].overlord)));
  for (const partner of treatyPartners(state, defender, "defensive"))
    if (partner !== id) defenders.add(partner);
  const allies = Object.keys(state.nations).filter((countryId) => countryId !== defender && !defenders.has(countryId) &&
    state.nations[countryId].overlord === id && state.nations[countryId].subjectType !== "protectorate");
  const repeated = nation.lastThreatDay !== undefined && state.elapsedDays - nation.lastThreatDay < 180;
  const pressure = adjustForeignRelation(state, id, defender, repeated ? -17 : -12, repeated ? -10 : -5);
  return {
    ...pressure,
    nations: { ...pressure.nations, [id]: {
      ...nation, infamy: nation.infamy + demandInfamy(state, id, defender, target, goal),
      lastThreatDay: state.elapsedDays, prestige: nation.prestige - (repeated ? 8 : 0),
    } },
    borderDispute: {
      phase: "escalation", claimantId: id, defenderId: defender, targetStateId: target,
      ...context,
      since: state.elapsedDays, goals: [goal], maneuvers: 2, allies, promises: [], defenders: [...defenders],
      mobilized: [], advance: [], raid: [], progress: 0, lastChange: null, outcome: null,
    },
  };
}
export function interested(scenario: Scenario, state: GameState, id: string, target: string) {
  return (
    landBorder(scenario, state, id, target) ||
    state.nations[id].interests.includes(target)
  );
}
export function participants(d: BorderDispute) {
  return [d.claimantId, ...d.allies, d.defenderId, ...d.defenders];
}

export function containmentCandidates(scenario: Scenario, state: GameState, dispute: BorderDispute) {
  const infamy = state.nations[dispute.claimantId].infamy;
  if (infamy < 50 || (dispute.phase !== "bargaining" && dispute.phase !== "countdown")) return [];
  const severe = infamy >= 75;
  if ((dispute.containment?.length ?? 0) >= (severe ? 3 : 2)) return [];
  const involved = new Set(participants(dispute));
  const targets = scenario.states[dispute.targetStateId];
  const strengths: Record<string, number> = {};
  for (const [siteId, owner] of Object.entries(state.ownerByStateId))
    strengths[owner] = (strengths[owner] ?? 0) + garrisonHeadcount(state, siteId);
  if (targets.coastal)
    for (const id of Object.keys(strengths)) strengths[id] += 80 * fleetPower(state, id);
  const attackers = [dispute.claimantId, ...dispute.allies].reduce((sum, id) => sum + strengths[id], 0);
  const defenders = [dispute.defenderId, ...dispute.defenders].reduce((sum, id) => sum + strengths[id], 0);
  const eligible = Object.keys(strengths).filter((id) =>
    !involved.has(id) && state.nations[id].overlord === null && strengths[id] > 0 &&
    !treatyBetween(state, id, dispute.claimantId, "defensive") &&
    (landBorder(scenario, state, id, targets.id) ||
      (severe && interested(scenario, state, id, targets.id) && canReach(scenario, state, id, targets.id))) &&
    defenders + strengths[id] >= attackers * (severe ? 0.45 : 0.6));
  return eligible.sort((a, b) => strengths[b] - strengths[a] || a.localeCompare(b));
}

export function swayError(scenario: Scenario, state: GameState, dispute: BorderDispute, cmd: Extract<BorderCommand, { type: "sway" }>) {
  const { countryId, allyId, useObligation } = cmd;
  if (countryId !== dispute.claimantId || dispute.phase !== "bargaining") return "没有可用博弈点";
  if (!state.nations[allyId] || participants(dispute).includes(allyId) || state.nations[allyId].overlord ||
      !Object.values(state.ownerByStateId).includes(allyId) || !interested(scenario, state, allyId, dispute.targetStateId))
    return "第三国需保有独立领土和目标地区利益";
  const obligation = useObligation && obligationBetween(state, countryId, allyId);
  if (useObligation && !obligation) return "对方没有待履行的义务";
  const relationship = relationBetween(state, countryId, allyId);
  if (relationship.standing < (obligation ? -55 : -35) || diplomaticTrust(relationship, allyId) < (obligation ? 10 : 25))
    return "关系或信任过低，第三国拒绝支持";
  if (dispute.maneuvers < swayCost(state.nations[countryId].infamy)) return "恶名提高了拉拢成本，博弈点不足";
}
export function attacking(d: BorderDispute, id: string) {
  return id === d.claimantId || d.allies.includes(id);
}
const withoutPeaceOffer = ({ peaceOffer: _offer, ...dispute }: BorderDispute) => dispute;
function treaty(state: GameState, d: BorderDispute, victory: boolean, withdrawal = false, terms = d.goals): GameState {
  const { occupation: released, ...world } = state;
  let diplomaticState: GameState = world;
  let opiumClaim = d.opiumClaim;
  const ownerByStateId = { ...state.ownerByStateId },
    countryEconomies = { ...state.countryEconomies },
    nations = { ...state.nations },
    societies = { ...state.societies };
  const a = d.claimantId,
    b = d.defenderId;
  if (victory) {
    if (terms.includes("annex") || terms.includes("cession")) {
      for (const id of Object.keys(ownerByStateId))
        if (ownerByStateId[id] === b && (id === d.targetStateId || terms.includes("annex"))) {
          ownerByStateId[id] = a;
          const site = societies[id];
          societies[id] = {
            ...site, governance: { ...newFrontier }, battalionOrders: [],
            barracksTraining: site.barracks === 0 ? [] : [{ levels: site.barracks, readyDay: state.elapsedDays + battalionTrainingDays }],
            ...(site.militaryHealth ? { militaryHealth: {
              injuries: site.militaryHealth.injuries.map((injury) => ({ ...injury, regulars: 0, conscripts: 0 })),
              replacements: [],
            } } : {}),
          };
        }
      const subsidies = countryEconomies[b].industrySubsidies;
      countryEconomies[b] = {
        ...countryEconomies[b],
        treasury: countryEconomies[b].treasury + countryEconomies[b].queue.reduce((sum, p) =>
          sum + (ownerByStateId[p.stateId] === b ? 0 : projectOpeningCapital(p)), 0),
        queue: countryEconomies[b].queue.filter((p) => ownerByStateId[p.stateId] === b),
        ...(subsidies ? { industrySubsidies: Object.fromEntries(Object.entries(subsidies)
          .filter(([stateId]) => ownerByStateId[stateId] === b)) } : {}),
      };
      const { fleet, navy } = nations[b];
      const motorizationPort = fleet.motorizationPort;
      nations[b] = {
        ...nations[b],
        fleet: { ...fleet, order: fleet.order && ownerByStateId[fleet.order.stateId] === b ? fleet.order : null,
          motorizationPort: motorizationPort !== null && ownerByStateId[motorizationPort] === b ? motorizationPort : null },
        navy: { ...navy, order: navy.order && ownerByStateId[navy.order.stateId] === b ? navy.order : null },
        investment: nations[b].investment + nations[b].privateQueue.reduce((sum, p) =>
          sum + (ownerByStateId[p.stateId] === b ? 0 : projectOpeningCapital(p)), 0),
        privateQueue: nations[b].privateQueue.filter((p) => ownerByStateId[p.stateId] === b),
      };
    }
    if (terms.includes("reparations")) {
      const amount = Math.floor(Math.max(0, countryEconomies[b].treasury) * 0.15);
      countryEconomies[b] = { ...countryEconomies[b], treasury: countryEconomies[b].treasury - amount };
      countryEconomies[a] = { ...countryEconomies[a], treasury: countryEconomies[a].treasury + amount };
    }
    if (terms.includes("opiumCompensation")) {
      const loss = opiumClaim!.loss;
      const paid = Math.min(loss, Math.max(0, countryEconomies[b].treasury));
      countryEconomies[b] = { ...countryEconomies[b], treasury: countryEconomies[b].treasury - paid };
      countryEconomies[a] = { ...countryEconomies[a], treasury: countryEconomies[a].treasury + paid };
      opiumClaim = { loss, paid };
    }
    if (terms.includes("recognition"))
      diplomaticState = adjustForeignRelation(recognizeTerritorialClaim(diplomaticState, a, b, d.targetStateId), b, a, 4, 5);
    if (terms.includes("haltSettlement"))
      diplomaticState = { ...diplomaticState, territorialSettlements: diplomaticState.territorialSettlements!
        .filter((project) => project.stateId !== d.settlementStateId) };
    const subjectType = terms.find(subjectGoal);
    if (subjectType && Object.values(ownerByStateId).includes(b)) {
      for (const [id, n] of Object.entries(nations))
        if (n.marketLeader === b || n.overlord === b) {
          nations[id] = { ...n, marketLeader: a, overlord: n.overlord === b ? a : n.overlord };
        }
      nations[b] = { ...nations[b], marketLeader: a, overlord: a, subjectType };
    }
    if (!Object.values(ownerByStateId).includes(b)) {
      for (const [id, n] of Object.entries(nations))
        if (id === b || n.marketLeader === b || n.overlord === b)
          nations[id] = { ...n, marketLeader: null, overlord: null, subjectType: null };
    }
    for (const ally of d.promises) {
      const reward = Math.min(50000, Math.max(0, countryEconomies[a].treasury));
      countryEconomies[a] = { ...countryEconomies[a], treasury: countryEconomies[a].treasury - reward };
      countryEconomies[ally] = {
        ...countryEconomies[ally],
        treasury: countryEconomies[ally].treasury + reward,
      };
      if (reward < 50000) nations[a] = { ...nations[a], prestige: nations[a].prestige - 10 };
      diplomaticState = adjustForeignRelation(diplomaticState, a, ally, reward < 50000 ? -12 : 6, reward < 50000 ? -15 : 6);
    }
  }
  const live = new Set(Object.values(ownerByStateId));
  const relations = removeDiplomaticTies(diplomaticState, ({ senior, partner }) =>
    !live.has(senior) || !live.has(partner) ||
    nations[senior].overlord === partner || nations[partner].overlord === senior,
  );
  return reconcileTerritorialPlans(reconcileTreaties({
    ...relations,
    ownerByStateId,
    countryEconomies,
    nations,
    societies,
    lastEconomy: null,
    borderDispute: {
      ...withoutPeaceOffer(d),
      ...(opiumClaim ? { opiumClaim } : {}),
      phase: "resolved",
      since: state.elapsedDays,
      outcome: victory ? "victory" : withdrawal ? "withdrawal" : "statusQuo",
    },
  }));
}

export function peaceTermsError(state: GameState, dispute: BorderDispute, terms: Goal[], commercial: boolean) {
  if (!peaceGoalsSchema.safeParse(terms).success || terms.some((goal) => !dispute.goals.includes(goal)))
    return "只能选择当前争端中互不重复的条款";
  if (terms.includes("recognition") && (terms.some(transfersLand) ||
      !unrecognizedClaim(state, dispute.claimantId, dispute.defenderId, dispute.targetStateId)))
    return "承认条款需要尚未获对方承认且将保留的宣称";
  if (terms.includes("haltSettlement") && settlementAt(state, dispute.settlementStateId!)?.countryId !== dispute.defenderId)
    return "领土项目已经变更";
  if (commercial && (terms.includes("annex") || (terms.includes("cession") &&
      Object.values(state.ownerByStateId).filter((owner) => owner === dispute.defenderId).length === 1)))
    return "双边通商协定需要双方在和约后保有领土";
  if (commercial && !treatyBetween(state, dispute.claimantId, dispute.defenderId, "commercial") &&
      [dispute.claimantId, dispute.defenderId].some((id) => influenceBudget(state, id).available < treatyInfluence.commercial))
    return "开放通商需要双方各有 1 点可用外交影响力";
}

export function warWillingness(state: GameState, d: BorderDispute, countryId: string) {
  const nation = state.nations[countryId];
  const sites = Object.entries(state.societies).filter(([id]) => state.ownerByStateId[id] === countryId).map(([, site]) => site);
  const legitimacy = governmentLegitimacy(nation, influence(sites, countryId, nation));
  const unrest = unrestOf(sites.flatMap((site) => site.pops));
  const risk = state.countryEconomies[countryId].fiscal?.week.risk;
  const budgetPressure = risk === "defaulted" ? 30 : risk === "restricted" ? 20 : risk === "warning" ? 8 : 0;
  const occupied = state.occupation !== undefined && state.ownerByStateId[state.occupation.stateId] === countryId;
  const fatigue = d.phase === "war" ? Math.min(30, (state.elapsedDays - d.since) / 7) : 0;
  const momentum = d.phase === "war" ? (d.progress - 50) * (countryId === d.claimantId ? 0.35 : -0.35) : 0;
  const losses = d.losses?.[countryId];
  const army = state.lastEconomy?.countries[countryId].military;
  const casualtyPressure = losses && army
    ? Math.min(25, 60 * (losses.dead + 0.4 * losses.injured) / Math.max(1, army.regulars + army.conscripts + losses.dead))
    : 0;
  return Math.round(Math.max(0, Math.min(100, 55 + momentum + (legitimacy - 50) * 0.3 +
    (nation.morale - 50) * 0.3 - unrest * 0.25 - budgetPressure - fatigue - casualtyPressure - (occupied ? 15 : 0))));
}

function acceptsPeace(state: GameState, d: BorderDispute, offer: PeaceOffer, countryId: string) {
  if (peaceTermsError(state, d, offer.goals, offer.commercial)) return false;
  const costs: Record<Goal, number> = {
    cession: 28, reparations: 12, puppet: 42, vassal: 36, protectorate: 28, annex: 100, recognition: 8, haltSettlement: 14,
    opiumCompensation: d.opiumClaim
      ? Math.min(45, 6 + 100 * d.opiumClaim.loss / Math.max(1, state.countryEconomies[d.defenderId].treasury)) : 0,
  };
  const concessions = offer.goals.reduce((sum, goal) => sum + costs[goal], 0);
  const willingness = warWillingness(state, d, countryId);
  if (countryId === d.defenderId) return concessions <= 95 - willingness;
  return offer.goals.includes(d.goals[0]) || concessions + (offer.commercial ? 8 : 0) >= willingness - 20;
}
export function applyBorderCommand(scenario: Scenario, state: GameState, cmd: BorderCommand): GameState {
  const id = cmd.countryId,
    n = state.nations[id],
    d = state.borderDispute;
  if (!state.playerCountryId || !n || !Object.values(state.ownerByStateId).includes(id))
    throw new GameRuleError("国家没有可用领土");
  const change = (patch: Partial<typeof n>) => ({
    ...state,
    nations: { ...state.nations, [id]: { ...n, ...patch } },
  });
  if (cmd.type === "endDiplomaticTie") {
    const tie = diplomaticTie(state, id, cmd.partnerId);
    if (!tie) throw new GameRuleError("无可解除的开局外交关系");
    return removeDiplomaticTies(state, (current) => current === tie);
  }
  if (cmd.type === "promoteGeneral") {
    if (n.generalRank >= 5 || state.countryEconomies[id].treasury < 80000)
      throw new GameRuleError("晋升需要 800 两，最高五级");
    const paid = state.countryEconomies[id];
    return {
      ...change({ generalRank: n.generalRank + 1 }),
      countryEconomies: { ...state.countryEconomies, [id]: { ...paid, treasury: paid.treasury - 80000 } },
    };
  }
  if (cmd.type === "leaveUnion") {
    if (!n.marketLeader || n.overlord) throw new GameRuleError("无法退出当前市场");
    return { ...change({ marketLeader: null }), lastEconomy: null };
  }
  if (cmd.type === "joinUnion") {
    const leader = state.nations[cmd.leaderId];
    if (
      !leader ||
      cmd.leaderId === id ||
      leader.marketLeader ||
      n.marketLeader ||
      Object.values(state.nations).some((v) => v.marketLeader === id) ||
      !Object.values(state.ownerByStateId).includes(cmd.leaderId) ||
      (d && d.phase !== "resolved" && participants(d).includes(id))
    )
      throw new GameRuleError("无法加入该关税同盟");
    return { ...change({ marketLeader: cmd.leaderId }), lastEconomy: null };
  }
  if (cmd.type === "challengeTerritorialSettlement") {
    const error = settlementChallengeError(scenario, state, id, cmd.stateId);
    if (error) throw new GameRuleError(error);
    return openDispute(state, id, settlementAt(state, cmd.stateId)!.anchorId, "haltSettlement", { settlementStateId: cmd.stateId });
  }
  if (cmd.type === "demandOpiumCompensation") {
    const error = opiumDemandError(scenario, state, id, cmd.stateId);
    if (error) throw new GameRuleError(error);
    const loss = recentOpiumLosses(state, id).get(cmd.stateId)!;
    const partner = state.ownerByStateId[cmd.stateId];
    const filing = { ...state, opiumLosses: state.opiumLosses!.filter((entry) =>
      entry.exporter !== id || entry.importer !== partner || entry.stateId !== cmd.stateId) };
    return openDispute(filing, id, cmd.stateId, "opiumCompensation", { opiumClaim: { loss } });
  }
  if (cmd.type === "declareInterest" || cmd.type === "demandBorder") {
    const target = cmd.targetStateId,
      defender = state.ownerByStateId[target];
    if (!canReach(scenario, state, id, target)) throw new GameRuleError("需要接壤或双方沿海的目标州");
    if (cmd.type === "declareInterest") {
      if (interested(scenario, state, id, target)) throw new GameRuleError("已经拥有利益");
      return change({ interests: [...n.interests, target] });
    }
    if (
      (d && d.phase !== "resolved") ||
      !interested(scenario, state, id, target) ||
      n.overlord ||
      !canDemandGoal(state, id, defender, cmd.goal, target)
    )
      throw new GameRuleError("无法提出这项外交要求");
    return openDispute(state, id, target, cmd.goal);
  }
  if (cmd.type === "joinContainment") {
    if (!d || !containmentCandidates(scenario, state, d).includes(id))
      throw new GameRuleError("当前未满足地区防御联合条件");
    const joined = adjustForeignRelation(adjustForeignRelation(state, id, d.claimantId, -10, -8), id, d.defenderId, 8, 5);
    return { ...joined, borderDispute: { ...d, defenders: [...d.defenders, id], containment: [...(d.containment ?? []), id] } };
  }
  if (!d || d.phase === "resolved" || !participants(d).includes(id)) throw new GameRuleError("没有本国参与的争端");
  const patch = (fields: Partial<BorderDispute>) => ({ ...state, borderDispute: { ...d, ...fields } });
  if (cmd.type === "proposePeace" || cmd.type === "acceptPeace" || cmd.type === "rejectPeace") {
    if ((d.phase !== "countdown" && d.phase !== "war") || (id !== d.claimantId && id !== d.defenderId))
      throw new GameRuleError("只有争端双方可在最后谈判或战争中协商");
    const offer = d.peaceOffer;
    if (cmd.type === "proposePeace") {
      if (offer) throw new GameRuleError("已有方案等待对方答复");
      const problem = peaceTermsError(state, d, cmd.goals, cmd.commercial);
      if (problem) throw new GameRuleError(problem);
      return patch({ lastPeaceOfferDay: state.elapsedDays, peaceOffer: {
        from: id, goals: [...cmd.goals], commercial: cmd.commercial, offeredDay: state.elapsedDays,
      } });
    }
    if (!offer || offer.from === id) throw new GameRuleError("没有待本国答复的和约方案");
    if (cmd.type === "rejectPeace") return { ...state, borderDispute: withoutPeaceOffer(d) };
    const problem = peaceTermsError(state, d, offer.goals, offer.commercial);
    if (problem) throw new GameRuleError(problem);
    const settled = treaty(state, { ...d, agreedPeace: { goals: offer.goals, commercial: offer.commercial } },
      offer.goals.length > 0, false, offer.goals);
    return offer.commercial ? signForeignTreaty(settled, d.claimantId, d.defenderId, "commercial") : settled;
  }
  if (cmd.type === "addGoal" || cmd.type === "sway") {
    if (id !== d.claimantId || d.phase !== "bargaining" || !d.maneuvers) throw new GameRuleError("没有可用博弈点");
    if (cmd.type === "addGoal") {
      if (!canAddGoal(state, d, cmd.goal)) throw new GameRuleError("无效目标");
      return {
        ...change({ infamy: n.infamy + demandInfamy(state, id, d.defenderId, d.targetStateId, cmd.goal) }),
        borderDispute: { ...d, maneuvers: d.maneuvers - 1, goals: [...d.goals, cmd.goal] },
      };
    }
    const error = swayError(scenario, state, d, cmd);
    if (error) throw new GameRuleError(error);
    const obligation = cmd.useObligation ? obligationBetween(state, id, cmd.allyId) : undefined;
    const updated = obligation ? fulfillObligation(state, obligation) : state;
    return { ...updated, borderDispute: { ...d,
      maneuvers: d.maneuvers - swayCost(n.infamy),
      allies: [...d.allies, cmd.allyId],
      promises: obligation ? d.promises : [...d.promises, cmd.allyId],
    } };
  }
  if (cmd.type === "backDown") {
    if (d.phase === "war" || (id !== d.claimantId && id !== d.defenderId))
      throw new GameRuleError("无法在此阶段让步");
    if (id === d.claimantId) return treaty(state, d, false, true);
    const [primary, ...extras] = d.goals;
    const concession = extras.length ? { ...d, goals: [primary], unacceptedGoals: extras } : d;
    return treaty(state, concession, true);
  }
  if (d.phase !== "war") throw new GameRuleError("尚未进入战争");
  if (cmd.type === "setFrontOrder") {
    const { objective, priority } = cmd;
    if (objective !== null && !frontObjectives(scenario, state, d, id).some((site) => site.id === objective))
      throw new GameRuleError("该战区当前无法到达");
    return patch({ frontOrders: { ...d.frontOrders, [id]: { objective, priority } } });
  }
  if (cmd.type === "signTreaty" || cmd.type === "armistice") {
    if ((id !== d.claimantId && id !== d.defenderId) || d.lastChange === null)
      throw new GameRuleError("尚无法签署和约");
    if (cmd.type === "signTreaty" && d.progress < scenario.borderDispute.cessionProgress)
      throw new GameRuleError("战线进度尚未达到割让条件");
    if (cmd.type === "armistice" && id !== d.claimantId)
      throw new GameRuleError("防守方可提出维持现状的和约，等待对方答复");
    return treaty(state, d, cmd.type === "signTreaty");
  }
  if (cmd.type === "mobilize") {
    if (d.mobilized.includes(id)) throw new GameRuleError("已经征兵");
    const route = planWar(scenario, state)!.routes[id];
    const origins = mobilizationOrigins(state, route);
    if (!origins.length) throw new GameRuleError("没有可征召的战区兵源");
    const nation = state.nations[id];
    const transportDelay = nation.knowledge["运输调度"] !== 100 && (route.overseas ||
      origins.every((siteId) => state.societies[siteId].infrastructure === 1 && state.societies[siteId].railway === 0));
    const governmentDelay = origins.some((siteId) => localGovernanceRule(state.societies[siteId], nation.laws).militaryShare < 0.8);
    const readyDay = state.elapsedDays + mobilizationBaseDays + (Number(transportDelay) + Number(governmentDelay)) * mobilizationDelayDays;
    return patch({
      mobilized: [...d.mobilized, id],
      mobilization: { ...d.mobilization, [id]: { orderedDay: state.elapsedDays, readyDay, origins } },
    });
  }
  if (cmd.type === "raid") {
    const target = navalMissionTargets(scenario, state, d, id, "blockade")[0];
    if (!target || fleetPower(state, id) === 0) throw new GameRuleError("没有可派遣的舰队或可达港口");
    return patch({ navalMissions: { ...d.navalMissions, [id]: { task: "blockade", portId: target.id } },
      raid: d.raid.filter((countryId) => countryId !== id) });
  }
  if (cmd.type === "setNavalMission") {
    const mission = cmd.mission;
    if (mission && (fleetPower(state, id) === 0 ||
        !navalMissionTargets(scenario, state, d, id, mission.task).some((site) => site.id === mission.portId)))
      throw new GameRuleError("没有可派遣的舰队或可达港口");
    const navalMissions = { ...d.navalMissions };
    if (mission) navalMissions[id] = mission;
    else delete navalMissions[id];
    return patch({ navalMissions, raid: d.raid.filter((countryId) => countryId !== id) });
  }
  return patch({
    advance: [...d.advance.filter((x) => x !== id), ...(cmd.type === "orderAdvance" ? [id] : [])],
    retreating: [...(d.retreating ?? []).filter((x) => x !== id), ...(cmd.type === "orderRetreat" ? [id] : [])],
  });
}
export function tickDiplomacy(scenario: Scenario, state: GameState,
  humanCountries: ReadonlySet<string | null> = new Set([state.playerCountryId]),
): GameState {
  state = expireTreatyOffers(state);
  let d = state.borderDispute;
  if (d?.peaceOffer) {
    const offer = d.peaceOffer;
    const respondent = offer.from === d.claimantId ? d.defenderId : d.claimantId;
    if (state.elapsedDays - offer.offeredDay >= peaceOfferDuration)
      state = { ...state, borderDispute: withoutPeaceOffer(d) };
    else if (state.elapsedDays > offer.offeredDay && !humanCountries.has(respondent))
      state = applyBorderCommand(scenario, state, {
        type: acceptsPeace(state, d, offer, respondent) ? "acceptPeace" : "rejectPeace", countryId: respondent,
      });
    d = state.borderDispute;
  }
  if (!d || d.phase === "war" || d.phase === "resolved") return state;
  const duration = {
    escalation: 7,
    bargaining: 14,
    countdown: landBorder(scenario, state, d.claimantId, d.targetStateId) ? 7 : 35,
  };
  if (state.elapsedDays - d.since < duration[d.phase]) return state;
  const phase = ({ escalation: "bargaining", bargaining: "countdown", countdown: "war" } as const)[d.phase];
  const next = { ...state, borderDispute: { ...withoutPeaceOffer(d), phase, since: state.elapsedDays } };
  if (phase !== "war") return next;
  const sides = new Set(participants(d));
  return removeDiplomaticTies(breakOpposedTreaties(next, d.claimantId), ({ senior, partner }) =>
    sides.has(senior) && sides.has(partner) && attacking(d, senior) !== attacking(d, partner),
  );
}
interface SupplyRoute {
  objective: string;
  priorityShare: number;
  recruitmentStates: Set<string>;
  connectedStates: Set<string>;
  draftOrigins: Set<string>;
  draftReady: boolean;
  deployedDrafts: Set<string>;
  grainTransport: number;
  mobilized: boolean;
  overseas: boolean;
  maritimeTerminals?: MaritimeTerminal[][];
}
export interface WarPlan {
  routes: Record<string, SupplyRoute>;
  recruitPercent: number;
  supplyPercent: number;
  grainPerRecruit: number;
  naval: ReturnType<typeof planNavalOperations>;
}
function mobilizationOrigins(state: GameState, route: SupplyRoute) {
  return [...route.recruitmentStates].filter((id) => state.occupation?.stateId !== id && state.societies[id].conscription > 0);
}
export function frontLine(scenario: Scenario, state: GameState, d: BorderDispute) {
  const site = scenario.states[d.targetStateId];
  if (d.progress < 50) return [site];
  const next = site.neighbors.filter((id) => state.ownerByStateId[id] === d.defenderId);
  return next.length ? next.map((id) => scenario.states[id]) : [site];
}
export function frontObjectives(scenario: Scenario, state: GameState, d: BorderDispute, countryId: string) {
  const sites = holdings(scenario, state, countryId);
  const departurePort = sites.some((site) => site.coastal && state.occupation?.stateId !== site.id);
  const target = scenario.states[d.targetStateId];
  return [...new Set([target, ...frontLine(scenario, state, d)])].filter((site) =>
    state.ownerByStateId[site.id] === countryId || sites.some((own) => own.neighbors.includes(site.id)) ||
    (site.coastal && departurePort));
}
export function planWar(scenario: Scenario, state: GameState): WarPlan | undefined {
  const d = state.borderDispute;
  if (d?.phase !== "war") return;
  const routes: Record<string, SupplyRoute> = {};
  const naval = planNavalOperations(scenario, state, d);
  const line = new Set(frontLine(scenario, state, d).map((site) => site.id));
  for (const id of participants(d)) {
    const order = d.frontOrders?.[id];
    const requested = order?.objective;
    const focus = requested && frontObjectives(scenario, state, d, id).some((site) => site.id === requested) ? requested : null;
    const objective = focus ?? (id === d.defenderId ? line.values().next().value! : d.targetStateId);
    const priorityShare = supplyPriorityDetails[order?.priority ?? "front"].share;
    const sites = holdings(scenario, state, id);
    const ports = sites.filter((site) => site.coastal && state.occupation?.stateId !== site.id)
      .map((site) => ({ stateId: site.id, capacity: portCapacity(site.grainTransport, state.societies[site.id]) }))
      .sort((left, right) => right.capacity - left.capacity);
    const defenseLine = focus ? new Set([focus]) : line;
    const fronts = sites.filter((s) => id === d.defenderId ? defenseLine.has(s.id) : s.neighbors.includes(objective));
    const starts = fronts.length > 0 ? fronts : ports.slice(0, 1).map((port) => scenario.states[port.stateId]);
    const recruitmentStates = new Set(starts.map((site) => site.id));
    function connected(seeds: Iterable<string>) {
      const reachable = new Set(seeds);
      for (const site of reachable)
        for (const next of scenario.states[site].neighbors)
          if (state.ownerByStateId[next] === id && state.occupation?.stateId !== next) reachable.add(next);
      return reachable;
    }
    const connectedStates = connected(recruitmentStates);
    // Supplies from a disconnected front must cross the sea. The home depot is the
    // most populous original state still held; an occupation never relocates that depot.
    const homeland =
      sites.filter((s) => s.ownerId === id).sort((a, b) => b.population - a.population)[0] ?? sites[0];
    const overseas = !fronts.length || !connectedStates.has(homeland.id);
    let grainTransport = starts.reduce(
      (n, s) => {
        const site = state.societies[s.id];
        const rail = state.occupation?.stateId === s.id ? 0 : s.neighbors.reduce((bonus, neighbor) => {
          if (state.ownerByStateId[neighbor] !== id || state.occupation?.stateId === neighbor) return bonus;
          return Math.max(bonus, connectedRailway(site.railway, state.societies[neighbor].railway));
        }, 0);
        const terminal = overseas && s.coastal && state.occupation?.stateId !== s.id ? site.port : 0;
        return n + Math.floor(s.grainTransport * (site.infrastructure + rail + terminal) * unrestEffects(site.stability).transport);
      },
      0,
    );
    if (state.nations[id].knowledge["运输调度"] === 100) grainTransport = Math.floor(grainTransport * 1.3);
    let maritimeTerminals: MaritimeTerminal[][] | undefined;
    if (overseas) {
      const frontPorts = ports.filter((port) => connectedStates.has(port.stateId));
      maritimeTerminals = [frontPorts];
      if (fronts.length > 0) {
        const home = connected(state.occupation?.stateId === homeland.id ? [] : [homeland.id]);
        const homePorts = ports.filter((port) => home.has(port.stateId));
        maritimeTerminals.unshift(homePorts);
        if (homePorts.length > 0 && frontPorts.length > 0) {
          for (const site of home) connectedStates.add(site);
        }
      }
      const portAccess = (port: MaritimeTerminal) => naval.portAccess.get(port.stateId) ?? 1;
      const safestAccess = Math.min(...maritimeTerminals.map((group) => Math.max(0, ...group.map(portAccess))));
      maritimeTerminals = maritimeTerminals.map((group) => group.map((port) => ({
        ...port, capacity: Math.floor(port.capacity * portAccess(port)),
      })).sort((a, b) => portAccess(b) - portAccess(a) || b.capacity - a.capacity));
      grainTransport = Math.min(
        grainTransport,
        effectiveConvoyCapacity(state.nations[id], Math.round(convoyCargoCapacity * safestAccess)),
        ...maritimeTerminals.map((group) => group.reduce((sum, port) => sum + port.capacity, 0)),
      );
    }
    const callUp = d.mobilization?.[id];
    const mobilized = d.mobilized.includes(id);
    const draftOrigins = new Set((callUp?.origins ?? (mobilized ? [...recruitmentStates] : []))
      .filter((siteId) => state.occupation?.stateId !== siteId));
    const draftReady = mobilized && (!callUp || callUp.readyDay <= state.elapsedDays);
    if (d.retreating?.includes(id)) {
      routes[id] = {
        objective, priorityShare, recruitmentStates: new Set(), connectedStates: new Set(),
        draftOrigins, draftReady, deployedDrafts: new Set(), grainTransport: 0, mobilized, overseas: false,
      };
    } else {
      const deployedDrafts = new Set(draftReady ? [...draftOrigins].filter((siteId) => connectedStates.has(siteId)) : []);
      routes[id] = { objective, priorityShare, recruitmentStates, connectedStates, draftOrigins, draftReady, deployedDrafts,
        grainTransport, mobilized, overseas, ...(maritimeTerminals ? { maritimeTerminals } : {}) };
    }
  }
  return { ...scenario.borderDispute, routes, naval };
}
export function advanceFront(scenario: Scenario, state: GameState, report: EconomyReport): GameState {
  const d = state.borderDispute;
  if (d?.phase !== "war") return state;
  const frontWidth = (target: string) =>
    ({ 山地: 180, 森林: 350, 平原: 650 } as const)[scenario.states[target].terrain ?? "平原"] * state.societies[target].infrastructure;
  const width = frontWidth(frontLine(scenario, state, d)[0].id);
  const plan = planWar(scenario, state)!;
  const randomFraction = (key: string) => ((Math.imul(state.rng ^ hash(key), 1664525) + 1013904223) >>> 0) / 2 ** 32;
  const deployed = (id: string) => {
    const route = plan.routes[id];
    const role = d.advance.includes(id) ? "attack" : "defense";
    const origins = [...new Set([...route.recruitmentStates, ...route.deployedDrafts])].map((siteId) => {
      const district = report.states[siteId];
      const roster = route.recruitmentStates.has(siteId) ? battalionsAt(state, siteId, district.regulars) : [];
      const conscripts = district.deployedConscripts!;
      const regulars = roster.reduce((sum, unit) => sum + unit.trained, 0);
      const effective = roster.reduce((sum, unit) =>
        sum + unit.trained * battalionDetails[unit.kind][role] * equipmentDetails[unit.equipment][role] / 10, conscripts) *
        opiumEffects(state.societies[siteId].opiumBurden).military;
      const mobile = roster.reduce((sum, unit) =>
        sum + (unit.kind === "cavalry" || unit.equipment === "mechanized" ? unit.trained : 0), 0);
      return { siteId, regulars, conscripts, effective, mobile };
    });
    const soldiers = origins.reduce((sum, x) => sum + x.regulars + x.conscripts, 0);
    const effective = origins.reduce((sum, x) => sum + x.effective, 0);
    const nation = state.nations[id], military = report.countries[id].military;
    const available = Math.min(soldiers, commandCapacity(nation), frontWidth(route.objective));
    const support = plan.naval.landing.get(id);
    const navalBonus = support?.portId === route.objective ? 0.35 * support.power / (1 + support.power) : 0;
    const landing = attacking(d, id) && !landBorder(scenario, state, id, route.objective) ? 0.65 + navalBonus : 1;
    const logistics = nation.knowledge["野战后勤"] === 100 ? 1.25 : 1;
    const random = 0.9 + randomFraction(id) * 0.2;
    const power = soldiers === 0 ? 0 :
      available * effective / soldiers * military.readiness * (nation.morale / 100) * landing * logistics * random;
    const mobility = soldiers === 0 ? 0 : origins.reduce((sum, x) => sum + x.mobile, 0) / soldiers;
    return { id, origins, soldiers, available, power, mobility, supply: military.supplyRatio! };
  };
  const left = [d.claimantId, ...d.allies],
    right = [d.defenderId, ...d.defenders];
  const side = (ids: string[]) => {
    const forces = ids.map(deployed);
    const committed = forces.reduce((sum, force) => sum + force.available, 0);
    const frontage = committed === 0 ? 0 : Math.min(1, width / committed);
    const mobility = committed === 0 ? 0 : forces.reduce((sum, force) => sum + force.mobility * force.available, 0) / committed;
    return { forces, committed, frontage, mobility, power: forces.reduce((sum, force) => sum + force.power, 0) * frontage };
  };
  const attackers = side(left), defenders = side(right);
  const diff = attackers.power - defenders.power;
  const offensive = d.advance.some((id) => left.includes(id) || right.includes(id));
  let delta = 0;
  if ((diff > 0 && left.some((id) => d.advance.includes(id))) || (diff < 0 && right.some((id) => d.advance.includes(id)))) {
    const mobility = diff > 0 ? attackers.mobility : defenders.mobility;
    delta = Math.sign(diff) * Math.max(1, Math.floor(Math.abs(diff) * (1 + 0.25 * mobility) / scenario.borderDispute.strengthPerPoint));
  }

  const contested = offensive && attackers.committed > 0 && defenders.committed > 0;
  const result = { ...state, societies: { ...state.societies }, stateEconomies: { ...state.stateEconomies } };
  const losses = { ...d.losses };
  for (const coalition of [attackers, defenders]) {
    const losing = coalition === attackers ? diff < 0 : diff > 0;
    for (const force of coalition.forces) {
      if (force.soldiers === 0) continue;
      const battleLoss = contested ? (losing ? 0.018 : 0.010) * coalition.frontage * force.available / force.soldiers : 0;
      const attrition = Math.max(0, (0.5 - force.supply) / 0.5) * 0.012;
      for (const origin of force.origins) {
        const take = (personnel: number, corps: string) => {
          const dead = Math.floor(personnel * (battleLoss * 0.30 + attrition * 0.15) + randomFraction(origin.siteId + corps + "dead"));
          const injured = Math.min(personnel - dead, Math.floor(
            personnel * (battleLoss * 0.70 + attrition * 0.85) + randomFraction(origin.siteId + corps + "injured")));
          return { dead, injured };
        };
        const regular = take(origin.regulars, "regular"), conscript = take(origin.conscripts, "conscript");
        const dead = regular.dead + conscript.dead, injured = regular.injured + conscript.injured;
        if (dead + injured === 0) continue;
        applyMilitaryLoss(result, origin.siteId, {
          regularDead: regular.dead, conscriptDead: conscript.dead,
          regularInjured: regular.injured, conscriptInjured: conscript.injured,
        });
        const prior = losses[force.id] ?? { dead: 0, injured: 0 };
        losses[force.id] = { dead: prior.dead + dead, injured: prior.injured + injured };
      }
    }
  }
  const progress = Math.max(0, Math.min(100, d.progress + delta));
  return syncOccupation(scenario, { ...result, borderDispute: { ...d, losses, progress, lastChange: progress - d.progress } });
}
export function aiDiplomacy(
  scenario: Scenario,
  state: GameState,
  humanCountries: ReadonlySet<string | null> = new Set([state.playerCountryId]),
): (BorderCommand | TerritorialClaimCommand)[] {
  const d = state.borderDispute;
  if (!d || d.phase === "resolved") {
    const exporters = new Set((state.opiumLosses ?? []).map((loss) => loss.exporter));
    for (const countryId of exporters) {
      if (humanCountries.has(countryId) || !Object.values(state.ownerByStateId).includes(countryId)) continue;
      for (const [stateId, loss] of recentOpiumLosses(state, countryId))
        if (loss >= 2 * minOpiumClaim && !opiumDemandError(scenario, state, countryId, stateId))
          return [{ type: "demandOpiumCompensation", countryId, stateId }];
    }
    // Limit AI plays to one at a time, with at least four opening weeks for the player.
    const { aiAggression } = ruleTuning(state.settings);
    const interval = Math.max(4, Math.round(8 / aiAggression)) * 7;
    if (state.elapsedDays < 28 || state.elapsedDays % interval !== 0) return [];
    for (const claim of state.territorialClaims ?? []) {
      if (!humanCountries.has(claim.claimantId) &&
          !settlementChallengeError(scenario, state, claim.claimantId, claim.stateId))
        return [{ type: "challengeTerritorialSettlement", countryId: claim.claimantId, stateId: claim.stateId }];
    }
    const sites = Object.values(scenario.states).filter((s) => Object.hasOwn(state.ownerByStateId, s.id));
    for (let offset = 0; offset < sites.length; offset++) {
      const site = sites[(state.rng + offset) % sites.length],
        owner = state.ownerByStateId[site.id];
      for (const nb of site.neighbors) {
        const id = state.ownerByStateId[nb];
        if (
          Object.hasOwn(state.ownerByStateId, nb) &&
          id !== owner &&
          !humanCountries.has(id) &&
          !state.nations[id].overlord &&
          state.nations[owner].overlord !== id &&
          !diplomaticTie(state, id, owner) &&
          !treatyBetween(state, id, owner, "defensive")
        ) {
          const claim = { type: "declareTerritorialClaim", countryId: id, stateId: site.id } as const;
          if ((state.rng + offset) % 8 === 0 && !state.territorialClaims?.some((entry) => entry.claimantId === id) &&
              !territorialClaimError(scenario, state, claim)) return [claim];
          const goal = unrecognizedClaim(state, id, owner, site.id) ? "recognition" : "reparations";
          return [{ type: "demandBorder", countryId: id, targetStateId: site.id, goal }];
        }
      }
    }
    return [];
  }
  const volunteer = containmentCandidates(scenario, state, d).find((id) => {
    if (humanCountries.has(id)) return false;
    const risk = state.countryEconomies[id].fiscal?.week.risk;
    if (risk === "restricted" || risk === "defaulted") return false;
    const standing = relationBetween(state, id, d.defenderId).standing;
    const tradeWithClaimant = treatyBetween(state, id, d.claimantId, "commercial");
    return standing >= -25 && (!tradeWithClaimant || state.nations[d.claimantId].infamy >= 75);
  });
  if (volunteer) return [{ type: "joinContainment", countryId: volunteer }];
  if (
    d.phase === "countdown" &&
    !d.peaceOffer &&
    !d.containment?.length &&
    !humanCountries.has(d.defenderId) &&
    holdings(scenario, state, d.claimantId).length > 2 * holdings(scenario, state, d.defenderId).length
  )
    return [{ type: "backDown", countryId: d.defenderId }];
  if (d.phase === "bargaining" && !humanCountries.has(d.claimantId)) {
    for (const { creditor, debtor } of state.foreignObligations ?? []) {
      if (creditor !== d.claimantId) continue;
      const call = { type: "sway", countryId: creditor, allyId: debtor, useObligation: true } as const;
      if (!swayError(scenario, state, d, call)) return [call];
    }
  }
  if (d.phase !== "war") return [];
  const plan = planWar(scenario, state)!;
  const orders: BorderCommand[] = [];
  for (const id of participants(d).filter((i) => !humanCountries.has(i))) {
    if (!d.mobilized.includes(id) && mobilizationOrigins(state, plan.routes[id]).length)
      orders.push({ type: "mobilize", countryId: id });
    const cautious = state.elapsedDays - d.since >= 28 && warWillingness(state, d, id) <= 25;
    if (cautious && d.advance.includes(id)) orders.push({ type: "orderDefend", countryId: id });
    if (!cautious && !d.advance.includes(id)) orders.push({ type: "orderAdvance", countryId: id });
    if (fleetPower(state, id) > 0 && !d.navalMissions?.[id] && !d.raid.includes(id)) {
      const escort = navalMissionTargets(scenario, state, d, id, "escort").find((site) => plan.naval.portAccess.has(site.id));
      const landing = !escort && plan.routes[id].overseas &&
        navalMissionTargets(scenario, state, d, id, "landing").find((site) => site.id === plan.routes[id].objective);
      const interdiction = !escort && !landing && navalMissionTargets(scenario, state, d, id, "raid")[0];
      const mission = escort ? { task: "escort" as const, portId: escort.id } :
        landing ? { task: "landing" as const, portId: landing.id } :
        interdiction ? { task: "raid" as const, portId: interdiction.id } : null;
      if (mission) orders.push({ type: "setNavalMission", countryId: id, mission });
    }
  }
  if (!humanCountries.has(d.claimantId) && d.progress >= scenario.borderDispute.cessionProgress)
    orders.push({ type: "signTreaty", countryId: d.claimantId });
  else if (!humanCountries.has(d.claimantId) && state.elapsedDays - d.since >= 84 && d.lastChange !== null &&
      !d.peaceOffer && (d.lastPeaceOfferDay === undefined || state.elapsedDays - d.lastPeaceOfferDay >= 28))
    orders.push({ type: "proposePeace", countryId: d.claimantId, goals: [], commercial: false });
  return orders;
}
