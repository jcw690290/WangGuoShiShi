import { GameRuleError } from "./rules.ts";
import { z } from "zod";
import type { Scenario } from "../scenario/scenario.ts";
import type { GameState } from "./engine.ts";
import type { EconomyReport } from "./economy.ts";

export const goals = ["cession", "reparations", "puppet", "vassal", "protectorate", "annex"] as const;
export type Goal = (typeof goals)[number];
export const goalNames = {
  cession: "割让争端州",
  reparations: "支付赔款",
  puppet: "成为傀儡国",
  vassal: "成为封臣",
  protectorate: "成为保护国",
  annex: "吞并附属国",
};
export function subjectGoal(g: Goal): g is "puppet" | "vassal" | "protectorate" {
  return g === "puppet" || g === "vassal" || g === "protectorate";
}
export function canDemandGoal(state: GameState, claimantId: string, defenderId: string, goal: Goal) {
  return (
    (goal !== "annex" || state.nations[defenderId].overlord === claimantId) &&
    (!subjectGoal(goal) || !state.nations[claimantId].marketLeader)
  );
}

export function canAddGoal(state: GameState, dispute: BorderDispute, goal: Goal) {
  return (
    !dispute.goals.includes(goal) &&
    (!subjectGoal(goal) || !dispute.goals.some(subjectGoal)) &&
    canDemandGoal(state, dispute.claimantId, dispute.defenderId, goal)
  );
}

export const disputeSchema = z.object({
  targetStateId: z.string(),
  claimantId: z.string(),
  defenderId: z.string(),
  phase: z.enum(["escalation", "bargaining", "countdown", "war", "resolved"]),
  since: z.int().nonnegative(),
  goals: z.array(z.enum(goals)).min(1),
  maneuvers: z.int().nonnegative(),
  allies: z.array(z.string()),
  promises: z.array(z.string()),
  defenders: z.array(z.string()),
  mobilized: z.array(z.string()),
  advance: z.array(z.string()),
  raid: z.array(z.string()),
  progress: z.int().min(0).max(100),
  lastChange: z.int().nullable(),
  outcome: z.enum(["victory", "withdrawal", "statusQuo"]).nullable(),
});
export type BorderDispute = z.infer<typeof disputeSchema>;
export type BorderCommand =
  | { type: "declareInterest"; countryId: string; targetStateId: string }
  | { type: "demandBorder"; countryId: string; targetStateId: string; goal: Goal }
  | { type: "addGoal"; countryId: string; goal: Goal }
  | { type: "sway"; countryId: string; allyId: string }
  | {
      type:
        | "backDown"
        | "mobilize"
        | "orderAdvance"
        | "orderDefend"
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
    (state.nations[state.ownerByStateId[target]].infamy > 100 ||
      landBorder(scenario, state, id, target) ||
      (site.coastal && (hasPort ?? holdings(scenario, state, id).some((s) => s.coastal))))
  );
}
export function interested(scenario: Scenario, state: GameState, id: string, target: string) {
  return (
    state.nations[state.ownerByStateId[target]].infamy > 100 ||
    landBorder(scenario, state, id, target) ||
    state.nations[id].interests.includes(target)
  );
}
export function participants(d: BorderDispute) {
  return [d.claimantId, ...d.allies, d.defenderId, ...d.defenders];
}
export function attacking(d: BorderDispute, id: string) {
  return id === d.claimantId || d.allies.includes(id);
}
function treaty(state: GameState, d: BorderDispute, victory: boolean, withdrawal = false): GameState {
  const ownerByStateId = { ...state.ownerByStateId },
    countryEconomies = { ...state.countryEconomies },
    nations = { ...state.nations };
  const a = d.claimantId,
    b = d.defenderId;
  if (victory) {
    if (d.goals.includes("annex") || d.goals.includes("cession")) {
      for (const id of Object.keys(ownerByStateId))
        if (ownerByStateId[id] === b && (id === d.targetStateId || d.goals.includes("annex")))
          ownerByStateId[id] = a;
      countryEconomies[b] = {
        ...countryEconomies[b],
        queue: countryEconomies[b].queue.filter((p) => ownerByStateId[p.stateId] === b),
      };
      nations[b] = {
        ...nations[b],
        privateQueue: nations[b].privateQueue.filter((p) => ownerByStateId[p.stateId] === b),
      };
    }
    if (d.goals.includes("reparations")) {
      const amount = Math.floor(Math.max(0, countryEconomies[b].treasury) * 0.15);
      countryEconomies[b] = { ...countryEconomies[b], treasury: countryEconomies[b].treasury - amount };
      countryEconomies[a] = { ...countryEconomies[a], treasury: countryEconomies[a].treasury + amount };
    }
    const subjectType = d.goals.find(subjectGoal);
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
    }
  }
  return {
    ...state,
    ownerByStateId,
    countryEconomies,
    nations,
    lastEconomy: null,
    borderDispute: {
      ...d,
      phase: "resolved",
      since: state.elapsedDays,
      outcome: victory ? "victory" : withdrawal ? "withdrawal" : "statusQuo",
    },
  };
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
      !canDemandGoal(state, id, defender, cmd.goal)
    )
      throw new GameRuleError("无法提出这项外交要求");
    const defenders = Object.keys(state.nations).filter(
      (x) =>
        x !== id &&
        x !== defender &&
        ((state.nations[x].overlord === defender && state.nations[x].subjectType !== "protectorate") ||
          x === state.nations[defender].overlord),
    );
    const allies = Object.keys(state.nations).filter(
      (x) =>
        x !== defender && state.nations[x].overlord === id && state.nations[x].subjectType !== "protectorate",
    );
    return {
      ...change({ infamy: n.infamy + (cmd.goal === "annex" ? 3 : 12) }),
      borderDispute: {
        phase: "escalation",
        claimantId: id,
        defenderId: defender,
        targetStateId: target,
        since: state.elapsedDays,
        goals: [cmd.goal],
        maneuvers: 2,
        allies,
        promises: [],
        defenders,
        mobilized: [],
        advance: [],
        raid: [],
        progress: 0,
        lastChange: null,
        outcome: null,
      },
    };
  }
  if (!d || d.phase === "resolved" || !participants(d).includes(id)) throw new GameRuleError("没有本国参与的争端");
  const patch = (fields: Partial<BorderDispute>) => ({ ...state, borderDispute: { ...d, ...fields } });
  if (cmd.type === "addGoal" || cmd.type === "sway") {
    if (id !== d.claimantId || d.phase !== "bargaining" || !d.maneuvers) throw new GameRuleError("没有可用博弈点");
    if (cmd.type === "addGoal") {
      if (!canAddGoal(state, d, cmd.goal)) throw new GameRuleError("无效目标");
      return {
        ...change({ infamy: n.infamy + (cmd.goal === "annex" ? 3 : 12) }),
        borderDispute: { ...d, maneuvers: d.maneuvers - 1, goals: [...d.goals, cmd.goal] },
      };
    }
    if (
      !state.nations[cmd.allyId] ||
      participants(d).includes(cmd.allyId) ||
      state.nations[cmd.allyId].overlord ||
      !interested(scenario, state, cmd.allyId, d.targetStateId)
    )
      throw new GameRuleError("第三国需要在目标地区拥有利益");
    return patch({
      maneuvers: d.maneuvers - 1,
      allies: [...d.allies, cmd.allyId],
      promises: [...d.promises, cmd.allyId],
    });
  }
  if (cmd.type === "backDown") {
    if (d.phase === "war" || (id !== d.claimantId && id !== d.defenderId))
      throw new GameRuleError("无法在此阶段让步");
    return treaty(state, d, id === d.defenderId, id === d.claimantId);
  }
  if (d.phase !== "war") throw new GameRuleError("尚未进入战争");
  if (cmd.type === "signTreaty" || cmd.type === "armistice") {
    if ((id !== d.claimantId && id !== d.defenderId) || d.lastChange === null)
      throw new GameRuleError("尚无法签署和约");
    if (cmd.type === "signTreaty" && d.progress < scenario.borderDispute.cessionProgress)
      throw new GameRuleError("战线进度尚未达到割让条件");
    return treaty(state, d, cmd.type === "signTreaty");
  }
  if (cmd.type === "mobilize") {
    if (d.mobilized.includes(id)) throw new GameRuleError("已经征兵");
    return patch({ mobilized: [...d.mobilized, id] });
  }
  if (cmd.type === "raid") {
    if (!holdings(scenario, state, id).some((s) => s.coastal) || d.raid.includes(id))
      throw new GameRuleError("没有可派遣的舰队");
    return patch({ raid: [...d.raid, id] });
  }
  return patch({
    advance: [...d.advance.filter((x) => x !== id), ...(cmd.type === "orderAdvance" ? [id] : [])],
  });
}
export function tickDiplomacy(scenario: Scenario, state: GameState): GameState {
  const d = state.borderDispute;
  if (!d || d.phase === "war" || d.phase === "resolved") return state;
  const duration = {
    escalation: 7,
    bargaining: 14,
    countdown: landBorder(scenario, state, d.claimantId, d.targetStateId) ? 7 : 35,
  };
  if (state.elapsedDays - d.since < duration[d.phase]) return state;
  const phase = ({ escalation: "bargaining", bargaining: "countdown", countdown: "war" } as const)[d.phase];
  return { ...state, borderDispute: { ...d, phase, since: state.elapsedDays } };
}
interface SupplyRoute {
  recruitmentStates: Set<string>;
  connectedStates: Set<string>;
  grainTransport: number;
  mobilized: boolean;
}
export interface WarPlan {
  routes: Record<string, SupplyRoute>;
  recruitPercent: number;
  supplyPercent: number;
  grainPerRecruit: number;
}
export function frontLine(scenario: Scenario, state: GameState, d: BorderDispute) {
  const site = scenario.states[d.targetStateId];
  if (d.progress < 50) return [site];
  const next = site.neighbors.filter((id) => state.ownerByStateId[id] === d.defenderId);
  return next.length ? next.map((id) => scenario.states[id]) : [site];
}
export function planWar(scenario: Scenario, state: GameState): WarPlan | undefined {
  const d = state.borderDispute;
  if (d?.phase !== "war") return;
  const routes: Record<string, SupplyRoute> = {};
  const line = new Set(frontLine(scenario, state, d).map((site) => site.id));
  for (const id of participants(d)) {
    const sites = holdings(scenario, state, id);
    const fronts = sites.filter((s) =>
      id === d.defenderId ? line.has(s.id) : s.neighbors.includes(d.targetStateId),
    );
    const starts = !fronts.length ? sites.filter((s) => s.coastal).slice(0, 1) : fronts;
    const recruitmentStates = new Set(starts.map((s) => s.id)),
      connectedStates = new Set(recruitmentStates);
    for (const site of connectedStates)
      for (const next of scenario.states[site].neighbors)
        if (state.ownerByStateId[next] === id) connectedStates.add(next);
    let grainTransport = starts.reduce(
      (n, s) => n + s.grainTransport * state.societies[s.id].infrastructure,
      0,
    );
    // Supplies from a disconnected front must cross the sea. The home depot is the
    // most populous original state still held; an occupation never relocates that depot.
    const homeland =
      sites.filter((s) => s.ownerId === id).sort((a, b) => b.population - a.population)[0] ?? sites[0];
    const overseas = !fronts.length || !connectedStates.has(homeland.id);
    if (overseas)
      grainTransport = Math.min(
        grainTransport,
        state.nations[id].convoys * (d.raid.some((x) => attacking(d, x) !== attacking(d, id)) ? 220 : 800),
      );
    if (state.nations[id].knowledge["运输调度"] === 100) grainTransport = Math.floor(grainTransport * 1.3);
    routes[id] = { recruitmentStates, connectedStates, grainTransport, mobilized: d.mobilized.includes(id) };
  }
  return { ...scenario.borderDispute, routes };
}
export function advanceFront(scenario: Scenario, state: GameState, report: EconomyReport): GameState {
  const d = state.borderDispute;
  if (d?.phase !== "war") return state;
  const target = frontLine(scenario, state, d)[0];
  const width =
    ({ 山地: 180, 森林: 350, 平原: 650 } as const)[target.terrain ?? "平原"] *
    state.societies[target.id].infrastructure;
  const plan = planWar(scenario, state)!;
  const strength = (ids: string[]) =>
    Math.min(
      width,
      ids.reduce((n, id) => {
        const m = report.countries[id].military,
          route = plan.routes[id];
        const soldiers = [...route.recruitmentStates].reduce(
          (s, v) => s + report.states[v].regulars + report.states[v].conscripts,
          0,
        );
        const landing = attacking(d, id) && !landBorder(scenario, state, id, d.targetStateId) ? 0.65 : 1;
        const logistics = state.nations[id].knowledge["野战后勤"] === 100 ? 1.25 : 1;
        return (
          n +
          Math.min(soldiers, 300 * state.nations[id].generalRank) *
            m.readiness *
            (state.nations[id].morale / 100) *
            landing *
            logistics
        );
      }, 0),
    );
  const left = [d.claimantId, ...d.allies],
    right = [d.defenderId, ...d.defenders];
  let delta = 0;
  if (d.advance.some((id) => left.includes(id) || right.includes(id))) {
    const diff = strength(left) - strength(right);
    if (
      (diff > 0 && left.some((id) => d.advance.includes(id))) ||
      (diff < 0 && right.some((id) => d.advance.includes(id)))
    ) {
      delta =
        Math.sign(diff) * Math.max(1, Math.floor(Math.abs(diff) / scenario.borderDispute.strengthPerPoint));
    }
  }
  const progress = Math.max(0, Math.min(100, d.progress + delta));
  return { ...state, borderDispute: { ...d, progress, lastChange: progress - d.progress } };
}
export function aiDiplomacy(
  scenario: Scenario,
  state: GameState,
  humanCountries: ReadonlySet<string | null> = new Set([state.playerCountryId]),
): BorderCommand[] {
  const d = state.borderDispute;
  if (!d || d.phase === "resolved") {
    // Limit AI plays to one at a time. Give the player a full opening month to make the first demand.
    if (state.elapsedDays % 56 !== 0) return [];
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
          state.nations[owner].overlord !== id
        )
          return [{ type: "demandBorder", countryId: id, targetStateId: site.id, goal: "reparations" }];
      }
    }
    return [];
  }
  if (
    d.phase === "countdown" &&
    !humanCountries.has(d.defenderId) &&
    holdings(scenario, state, d.claimantId).length > 2 * holdings(scenario, state, d.defenderId).length
  )
    return [{ type: "backDown", countryId: d.defenderId }];
  if (d.phase !== "war") return [];
  const orders: BorderCommand[] = [];
  for (const id of participants(d).filter((i) => !humanCountries.has(i))) {
    if (!d.mobilized.includes(id)) orders.push({ type: "mobilize", countryId: id });
    if (!d.advance.includes(id)) orders.push({ type: "orderAdvance", countryId: id });
  }
  if (!humanCountries.has(d.claimantId) && d.progress >= scenario.borderDispute.cessionProgress)
    orders.push({ type: "signTreaty", countryId: d.claimantId });
  else if (!humanCountries.has(d.claimantId) && state.elapsedDays - d.since >= 84 && d.lastChange !== null)
    orders.push({ type: "armistice", countryId: d.claimantId });
  return orders;
}
