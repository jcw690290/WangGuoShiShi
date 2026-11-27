import type { GameState } from "./engine.ts";
import type { Scenario } from "../scenario/scenario.ts";
import { civicPolicy, civicStanding } from "./civic-policy.ts";
import { attacking, participants } from "./diplomacy.ts";
import { effectiveConvoyCapacity } from "./fleet.ts";
import { baseOrdinaryWage, bondedRuralShare, workForce } from "./labor.ts";
import { marketOf } from "./market.ts";
import { livingStandardOf, mergePopCohorts } from "./society.ts";
import type { Pop } from "./society.ts";
import { portCapacity, seaVoyageCargoCost } from "./transport.ts";

export interface PopulationMove {
  from: string;
  to: string;
  people: number;
}

export function settleMigration(scenario: Scenario, state: GameState, frontline: ReadonlySet<string>): PopulationMove[] {
  const { lastEconomy, ownerByStateId, societies, stateEconomies, nations } = state;
  if (!lastEconomy) return [];
  const entries = Object.entries(ownerByStateId);
  const markets = new Map<string, string[]>();
  const prospects = new Map<string, { access: number; score: number }>();
  for (const [id, owner] of entries) {
    const market = marketOf(state, owner);
    if (!markets.has(market)) markets.set(market, []);
    markets.get(market)!.push(id);
    const report = lastEconomy.states[id], site = societies[id], population = stateEconomies[id].population;
    const industries = Object.values(report.industries);
    const jobs = industries.reduce((sum, good) => sum + good.employed,
      (report.subsistence?.employed ?? 0) + report.regulars + report.conscripts + report.builders);
    const income = industries.reduce((sum, good) => sum + good.wages,
      (report.subsistence?.householdIncome ?? 0) + (report.construction?.public.wages ?? 0));
    const workforce = report.workforce ?? workForce(population, site.laborParticipation);
    const employment = Math.min(1, jobs / Math.max(1, workforce));
    const incomePerPerson = Math.min(2, income / (population * baseOrdinaryWage));
    const hazard = state.occupation?.stateId === id ? 3 : frontline.has(id) ? 1.5 : 0;
    const score = 3 * employment + 3 * incomePerPerson + livingStandardOf(site.pops) / 6 -
      (site.stability?.unrest ?? 0) / 30 - hazard;
    prospects.set(id, { score, access: report.access });
  }
  const rights = Object.fromEntries(Object.entries(nations).map(([id, nation]) => [id, civicPolicy(nation.laws)]));
  const war = state.borderDispute?.phase === "war" ? state.borderDispute : undefined;
  const belligerents = new Set(war ? participants(war) : []);
  const spareCargo = (id: string) => {
    const { military, tradeSeaCargo } = lastEconomy.countries[id];
    return Math.max(0, effectiveConvoyCapacity(nations[id]) - (military.seaCargoUsed ?? 0) - (tradeSeaCargo ?? 0));
  };
  const transit = (from: string, to: string) => {
    const origin = scenario.states[from], destination = scenario.states[to];
    const sender = ownerByStateId[from], receiver = ownerByStateId[to];
    if (war && belligerents.has(sender) && belligerents.has(receiver) &&
        attacking(war, sender) !== attacking(war, receiver)) return 0;
    const access = Math.min(prospects.get(from)!.access, prospects.get(to)!.access);
    if (origin.neighbors.includes(to)) return access;
    if (!origin.coastal || !destination.coastal || state.occupation?.stateId === from) return 0;
    const distance = seaVoyageCargoCost(origin.label, destination.label);
    if (distance > 2) return 0;
    const cargo = Math.min(
      spareCargo(sender), spareCargo(receiver),
      portCapacity(origin.grainTransport, societies[from]), portCapacity(destination.grainTransport, societies[to]),
    );
    return access * Math.min(1, cargo / (200 * distance));
  };

  const pending: (PopulationMove & { pop: Pop; source: Pop; basicBudget: number; discretionaryBudget: number })[] = [];
  for (const [from, owner] of entries) {
    const origin = stateEconomies[from];
    const targets = markets.get(marketOf(state, owner))!.flatMap((to) => {
      if (from === to || state.occupation?.stateId === to) return [];
      const passage = transit(from, to);
      return passage > 0 ? [{ to, passage, country: ownerByStateId[to] }] : [];
    });
    if (!targets.length) continue;
    for (const pop of societies[from].pops) {
      if (!pop.people || (pop.occupation !== "农民" && pop.occupation !== "劳工" && pop.occupation !== "工程师")) continue;
      const standing = civicStanding(pop, owner, societies[from], rights[owner]);
      let destination: typeof targets[number] | undefined, attraction = 0;
      for (const target of targets) {
        const abroad = target.country !== owner;
        if (abroad && pop.occupation !== "工程师") continue;
        const destinationStanding = civicStanding(pop, target.country, societies[target.to], rights[target.country]);
        if (destinationStanding < standing || (abroad && destinationStanding <= standing)) continue;
        const difference = prospects.get(target.to)!.score - prospects.get(from)!.score +
          3 * (destinationStanding - standing);
        const pull = Math.min(1, Math.max(0, difference - 0.25) / 4) * target.passage;
        if (pull > attraction) {
          destination = target;
          attraction = pull;
        }
      }
      if (!destination) continue;
      const available = pop.occupation === "农民" ? pop.people * (1 - bondedRuralShare(nations[owner].laws)) : pop.people;
      const rate = destination.country === owner ? 0.003 : 0.01;
      const people = Math.floor(available * rate * attraction);
      if (people === 0) continue;
      pending.push({
        from, to: destination.to, people, pop: { ...pop, people }, source: pop,
        basicBudget: Math.floor(origin.basicBudget * people / origin.population),
        discretionaryBudget: Math.floor((origin.discretionaryBudget ?? 0) * people / origin.population),
      });
    }
  }

  for (const move of pending) {
    move.source.people -= move.people;
    const origin = stateEconomies[move.from];
    origin.population -= move.people;
    origin.basicBudget -= move.basicBudget;
    if (move.discretionaryBudget > 0) origin.discretionaryBudget! -= move.discretionaryBudget;
  }
  const flows = new Map<string, PopulationMove>();
  for (const { from, to, pop, people, basicBudget, discretionaryBudget } of pending) {
    const destination = stateEconomies[to];
    destination.population += people;
    destination.basicBudget += basicBudget;
    if (discretionaryBudget > 0) destination.discretionaryBudget = (destination.discretionaryBudget ?? 0) + discretionaryBudget;
    const cohorts = societies[to].pops;
    const matching = (other: Pop) => other.culture === pop.culture && other.religion === pop.religion;
    const index = cohorts.findIndex((other) => other.occupation === pop.occupation && matching(other));
    if (index >= 0) cohorts[index] = mergePopCohorts(cohorts[index], pop, people);
    else cohorts.push(pop);
    if (pop.occupation === "农民" && !cohorts.some((other) => other.occupation === "劳工" && matching(other)))
      cohorts.push({ ...pop, occupation: "劳工", people: 0 });
    if (pop.occupation !== "工程师" && !cohorts.some((other) => other.occupation === "工程师" && matching(other)))
      cohorts.push({ ...pop, occupation: "工程师", people: 0 });
    const key = JSON.stringify([from, to]);
    const flow = flows.get(key);
    if (flow) flow.people += people;
    else flows.set(key, { from, to, people });
  }
  return [...flows.values()];
}
