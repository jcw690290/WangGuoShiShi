import type { Scenario } from "../scenario/scenario.ts";
import type { GameState } from "./engine.ts";
import type { WarPlan } from "./diplomacy.ts";
import { byGood, goods, industries } from "./industry.ts";
import type { ByGood, Good } from "./industry.ts";
import { accepted, evolvePops, facilityTypes, approval, tributeRate } from "./society.ts";
import { getEconomicRules } from "./politics.ts";
import { ruleTuning } from "./settings.ts";
import { clearMarket } from "./market.ts";
import type { MarketFill } from "./market.ts";

export type Building = Good | (typeof facilityTypes)[number];
export const projects = {
  ...industries,
  infrastructure: { cost: 210000, weeks: 2 },
  university: { cost: 360000, weeks: 3 },
  construction: { cost: 300000, weeks: 3 },
  barracks: { cost: 180000, weeks: 2 },
  conscription: { cost: 120000, weeks: 2 },
  arsenal: { cost: 280000, weeks: 3 },
  ammunition: { cost: 220000, weeks: 3 },
};
export interface StateEconomy {
  population: number;
  buildings: ByGood<number>;
}
export interface Project {
  stateId: string;
  good: Building;
  weeksLeft: number;
}
export interface CountryEconomy {
  treasury: number;
  queue: Project[];
}
export interface Market {
  demand: number;
  supply: number;
  price: number;
  traded?: number;
}
interface IndustryReport {
  employed: number;
  output: number;
  wages: number;
  sold?: number;
  bought?: number;
}
export interface MilitarySupply {
  regulars: number;
  conscripts: number;
  grainDemand: number;
  grainDrawn: number;
  grainTransport: number;
  equipment: Record<"weapons" | "ammunition" | "uniforms", { demand: number; delivered: number }>;
  readiness: number;
}
export interface SiteReport {
  industries: ByGood<IndustryReport>;
  populationChange?: number;
  foodFulfillment?: number;
  conscripts: number;
  access: number;
  localPrices: ByGood<number>;
  dividends: number;
  investment: number;
  builders: number;
  armourers: number;
  regulars: number;
}
export interface CountryReport {
  market: ByGood<Market>;
  tax: number;
  wageTaxRate: number;
  wageTaxGain: number;
  clothOutputBonus: number;
  clothOutputGain: number;
  military: MilitarySupply;
  investment: number;
  capacity: number;
  tribute: number;
  upkeep: number;
}
export interface EconomyReport {
  states: Record<string, SiteReport>;
  countries: Record<string, CountryReport>;
}

export function weeklyBudgets(nations: GameState["nations"], report: EconomyReport) {
  const budgets = Object.fromEntries(Object.entries(report.countries).map(([id, country]) => [
    id, { tributeReceived: 0, balance: country.tax - country.upkeep - country.tribute },
  ]));
  for (const [id, nation] of Object.entries(nations)) {
    if (nation.overlord === null) continue;
    const paid = report.countries[id].tribute;
    budgets[nation.overlord].tributeReceived += paid;
    budgets[nation.overlord].balance += paid;
  }
  return budgets;
}
export const workForce = (population: number) => Math.floor(population * 0.4);
const fulfillment = (bought: number, demand: number) => demand ? bought / demand : 1;
const priceOf = (good: Good, supply: number, demand: number) =>
  Math.round(industries[good].basePrice * (1 + (0.75 * (demand - supply)) / Math.max(1, demand, supply)));
export const privateShareOf = (n: GameState["nations"][string]) =>
  n.laws.includes("自由放任") ? 0.75 : n.laws.includes("干预主义") ? 0.5 : 0.35;
export function marketOf(state: GameState, id: string) {
  return state.nations[id].marketLeader ?? id;
}
type WeeklySupply = ByGood<number> & { weapons: number; ammunition: number };

// Add this force's issues to the national report, returning its own fulfilment for combat.
function issueSupplies(
  military: MilitarySupply, stocks: Record<string, WeeklySupply>, sources: string[],
  regulars: number, fieldStrength: number, campaignGrain: number, transport: number, grainShare: number,
) {
  const demand = regulars + campaignGrain;
  const grain = sources.reduce((total, id) => total + stocks[id].grain, 0);
  const delivered = Math.min(demand, transport, Math.floor(grain * grainShare));
  military.grainDemand += demand;
  military.grainDrawn += delivered;
  military.grainTransport += Math.min(transport, grain);
  let readiness = demand ? delivered / demand : 1;
  let cumulative = 0, allocated = 0;
  for (const id of sources) {
    cumulative += stocks[id].grain;
    const share = grain ? Math.floor(delivered * cumulative / grain) : 0;
    stocks[id].grain -= share - allocated;
    allocated = share;
  }
  const needs = {
    weapons: Math.ceil(regulars / 20 + fieldStrength / 5),
    ammunition: Math.ceil(regulars / 10 + fieldStrength),
    uniforms: Math.ceil(regulars / 15 + fieldStrength / 8),
  };
  for (const kind of ["weapons", "ammunition", "uniforms"] as const) {
    const good = kind === "uniforms" ? "cloth" : kind;
    let issued = 0;
    const limit = Math.min(transport, needs[kind]);
    for (const id of sources) {
      const take = Math.min(limit - issued, stocks[id][good]);
      stocks[id][good] -= take;
      issued += take;
      if (issued === limit) break;
    }
    military.equipment[kind].demand += needs[kind];
    military.equipment[kind].delivered += issued;
    if (needs[kind]) readiness = Math.min(readiness, issued / needs[kind]);
  }
  return readiness;
}

export function projectEconomy(state: GameState, war?: WarPlan): EconomyReport {
  const report: EconomyReport = { states: {}, countries: {} };
  const markets: Record<string, ByGood<Market>> = {};
  const holdings: Record<string, string[]> = {};
  const marketSites: Record<string, string[]> = {};
  const supplies: Record<string, WeeklySupply> = {},
    demands: Record<string, ByGood<number>> = {};
  for (const [id, nation] of Object.entries(state.nations)) {
    const market = byGood(() => ({ demand: 0, supply: 0, price: 0 }));
    markets[id] = market;
    marketSites[id] = [];
    holdings[id] = [];
    report.countries[id] = {
      market,
      ...getEconomicRules(nation),
      tax: 0,
      wageTaxGain: 0,
      clothOutputGain: 0,
      investment: 0,
      capacity: 0,
      tribute: 0,
      upkeep: 0,
      military: {
        regulars: 0,
        conscripts: 0,
        grainDemand: 0,
        grainDrawn: 0,
        grainTransport: 0,
        equipment: {
          weapons: { demand: 0, delivered: 0 },
          ammunition: { demand: 0, delivered: 0 },
          uniforms: { demand: 0, delivered: 0 },
        },
        readiness: 1,
      },
    };
  }
  for (const [id, local] of Object.entries(state.stateEconomies)) {
    const owner = state.ownerByStateId[id],
      nation = state.nations[owner],
      site = state.societies[id],
      c = report.countries[owner];
    holdings[owner].push(id);
    const route = war?.routes[owner],
      front = route?.recruitmentStates.has(id);
    const regulars = Math.min(site.barracks * 100, Math.floor(local.population * 0.03));
    const builders =
      state.countryEconomies[owner].queue.length || nation.privateQueue.length
        ? Math.min(site.construction * 50, Math.floor(local.population * 0.01))
        : 0;
    const armourers = Math.min((site.arsenal + site.ammunition) * 30, Math.floor(local.population * 0.03));
    let workers = workForce(local.population) - builders - regulars - armourers,
      conscripts = 0;
    const access = Math.min(
      1,
      (site.infrastructure * 11000) /
        (local.population + 2000 * (local.buildings.cloth + local.buildings.grain)),
    );
    const activity = byGood((g) => {
      const spec = industries[g];
      const engineers = site.pops
        .filter((p) => p.occupation === "工程师")
        .reduce((sum, p) => sum + p.people * (accepted(p, owner, nation) ? 1 : 0.65), 0);
      const jobs = Math.min(
        workers,
        local.buildings[g] * spec.jobs,
        g === "cloth" ? Math.floor(engineers * 12) : Infinity,
      );
      const drafted =
        front && route!.mobilized
          ? Math.min(
              Math.max(0, site.conscription * 500 - conscripts),
              Math.floor((jobs * war!.recruitPercent) / 100),
            )
          : 0;
      conscripts += drafted;
      workers -= jobs;
      const employed = jobs - drafted,
        base = Math.floor((employed * spec.output) / spec.jobs);
      const output = g === "cloth" ? Math.floor((base * (100 + c.clothOutputBonus)) / 100) : base;
      if (g === "cloth") c.clothOutputGain += output - base;
      return { employed, output, wages: 0 };
    });
    c.military.regulars += regulars;
    c.military.conscripts += conscripts;
    c.upkeep += regulars * 12 + armourers * 8;
    const staffed = armourers / Math.max(1, 30 * (site.arsenal + site.ammunition));
    supplies[id] = {
      ...byGood((g) => activity[g].output),
      weapons: Math.floor(170 * site.arsenal * staffed),
      ammunition: Math.floor(600 * site.ammunition * staffed),
    };
    demands[id] = byGood(
      (g) =>
        Math.round(local.population * industries[g].demandPerPerson) +
        (g === "cloth" ? Math.ceil(builders / 2) : builders),
    );
    report.states[id] = {
      industries: activity,
      regulars,
      builders,
      armourers,
      conscripts,
      access,
      localPrices: byGood(() => 0),
      dividends: 0,
      investment: 0,
    };
  }
  for (const [owner, ids] of Object.entries(holdings)) {
    const c = report.countries[owner],
      route = war?.routes[owner];
    const marketId = marketOf(state, owner),
      m = c.military,
      pool = markets[marketId];
    if (route) {
      const rear = ids.filter((id) => !route.recruitmentStates.has(id));
      const rearRegulars = rear.reduce((sum, id) => sum + report.states[id].regulars, 0);
      const deployed = m.regulars - rearRegulars;
      const fieldStrength = deployed + m.conscripts;
      m.readiness = issueSupplies(
        m, supplies, ids.filter((id) => route.connectedStates.has(id)),
        deployed, fieldStrength, fieldStrength * war!.grainPerRecruit, route.grainTransport, war!.supplyPercent / 100,
      );
      // Rear garrisons draw from the remaining domestic output, outside the front's transport limit.
      if (rearRegulars > 0) issueSupplies(m, supplies, rear, rearRegulars, 0, 0, Infinity, 1);
    } else {
      m.readiness = issueSupplies(m, supplies, ids, m.regulars, 0, 0, Infinity, 1);
    }
    for (const id of ids) {
      marketSites[marketId].push(id);
      for (const g of goods) {
        pool[g].supply += supplies[id][g];
        pool[g].demand += demands[id][g];
      }
    }
  }
  const fills = byGood((): Record<string, MarketFill> => ({}));
  for (const [marketId, market] of Object.entries(markets)) {
    const sites = marketSites[marketId];
    for (const g of goods) {
      const good = market[g];
      good.price = priceOf(g, good.supply, good.demand);
      const clearing = clearMarket(sites.map((id) => ({
        supply: supplies[id][g], demand: demands[id][g], access: report.states[id].access,
      })));
      good.traded = clearing.traded;
      sites.forEach((id, index) => { fills[g][id] = clearing.fills[index]; });
    }
  }
  for (const [owner, ids] of Object.entries(holdings)) {
    const c = report.countries[owner],
      nation = state.nations[owner];
    c.market = markets[marketOf(state, owner)];
    const rate =
      (nation.laws.includes("自由放任") ? 0.48 : nation.laws.includes("干预主义") ? 0.32 : 0.2) +
      (approval(nation, "地主") >= 10 || approval(nation, "实业家") >= 10 ? 0.05 : 0);
    let wages = 0,
      capacity = 0;
    for (const id of ids) {
      const s = report.states[id],
        site = state.societies[id];
      const fulfilled = byGood((g) => {
        const m = c.market[g],
          production = s.industries[g],
          { local: localTrade, poolBought, poolSold } = fills[g][id];
        const localPrice = priceOf(g, supplies[id][g], demands[id][g]);
        const price = Math.round(s.access * m.price + (1 - s.access) * localPrice);
        s.localPrices[g] = price;
        production.sold = localTrade + poolSold;
        production.bought = localTrade + poolBought;
        const revenue = localTrade * localPrice + poolSold * m.price;
        const occupation = g === "grain" ? "农民" : "劳工";
        const workers = site.pops.filter((p) => p.occupation === occupation);
        const paidShare =
          workers.reduce((n, p) => n + p.people * (accepted(p, owner, nation) ? 1 : 0.65), 0) /
          Math.max(
            1,
            workers.reduce((n, p) => n + p.people, 0),
          );
        production.wages = Math.round(revenue * 0.45 * paidShare);
        wages += production.wages;
        const profit = Math.floor((revenue - production.wages) * 0.25);
        const contribution = Math.floor(profit * rate);
        s.investment += contribution;
        s.dividends += profit - contribution;
        return fulfillment(production.bought, demands[id][g]);
      });
      s.foodFulfillment = fulfilled.grain;
      c.investment += s.investment;
      // Each staffed department buys a weekly grain/cloth basket; shortages constrain the work done.
      capacity +=
        (s.builders / 50) *
        (0.25 + 0.75 * Math.min(fulfilled.cloth, fulfilled.grain));
    }
    c.capacity = Math.floor(capacity * 100) / 100;
    c.tax =
      Math.floor((wages * c.wageTaxRate) / 100) +
      Math.floor(ids.reduce((n, id) => n + report.states[id].dividends, 0) * 0.05);
    c.wageTaxGain = Math.floor((wages * c.wageTaxRate) / 100) - Math.floor(wages * 0.1);
    if (nation.subjectType) c.tribute = Math.floor(c.tax * tributeRate[nation.subjectType]);
  }
  return report;
}
export function constructionError(
  scenario: Scenario,
  state: GameState,
  countryId: string,
  stateId: string,
  good: Building,
  privateBuild = false,
) {
  if (state.playerCountryId === null) return "请先选择国家";
  if (state.ownerByStateId[stateId] !== countryId || !Object.hasOwn(state.stateEconomies, stateId))
    return "只能在本国州内建设";
  const country = state.countryEconomies[countryId],
    nation = state.nations[countryId];
  if (good === "grain" || good === "cloth") {
    const queued = [...country.queue, ...nation.privateQueue].filter(
      (p) => p.good === good && p.stateId === stateId,
    ).length;
    if (state.stateEconomies[stateId].buildings[good] + queued >= scenario.states[stateId].capacity[good])
      return "州内容量已满";
  } else if (privateBuild) return "私人资金限用于生产建筑";
  if ((privateBuild ? nation.investment : country.treasury) < projects[good].cost) return "资金不足";
}
export function chooseConstruction(
  scenario: Scenario,
  state: GameState,
  countryId: string,
  market: ByGood<Market>,
  privateBuild = false,
) {
  if ((privateBuild ? state.nations[countryId].privateQueue : state.countryEconomies[countryId].queue).length)
    return;
  const shortages = goods
    .filter((g) => market[g].demand > market[g].supply)
    .sort((a, b) => fulfillment(market[a].supply, market[a].demand) - fulfillment(market[b].supply, market[b].demand));
  for (const good of shortages)
    for (const id of Object.keys(state.stateEconomies)) {
      if (
        state.ownerByStateId[id] === countryId &&
        !constructionError(scenario, state, countryId, id, good, privateBuild)
      )
        return { stateId: id, good };
    }
}
export function settleEconomy(state: GameState, war?: WarPlan): GameState & { lastEconomy: EconomyReport } {
  const before = projectEconomy(state, war);
  const tuning = ruleTuning(state.settings);
  const stateEconomies = { ...state.stateEconomies },
    societies = { ...state.societies },
    countryEconomies = { ...state.countryEconomies },
    nations = { ...state.nations };
  for (const [id, nation] of Object.entries(nations)) {
    const publicQueue = countryEconomies[id].queue.map((p) => ({ ...p })),
      privateQueue = nation.privateQueue.map((p) => ({ ...p }));
    const capacity = before.countries[id].capacity,
      privateShare = privateShareOf(nation);
    function work(queue: Project[], points: number) {
      while (points > 0 && queue.length) {
        const job = queue[0],
          cost = Math.min(points, job.weeksLeft);
        points -= cost;
        job.weeksLeft = Math.round((job.weeksLeft - cost) * 1e6) / 1e6;
        if (job.weeksLeft > 0) break;
        const { stateId, good } = job;
        if (good === "grain" || good === "cloth") {
          const local = stateEconomies[stateId];
          stateEconomies[stateId] = {
            ...local,
            buildings: { ...local.buildings, [good]: local.buildings[good] + 1 },
          };
        } else societies[stateId] = { ...societies[stateId], [good]: societies[stateId][good] + 1 };
        queue.shift();
      }
      return points;
    }
    const spare = work(privateQueue, capacity * privateShare);
    const rest = work(publicQueue, capacity * (1 - privateShare) + spare);
    work(privateQueue, rest);
    countryEconomies[id] = { ...countryEconomies[id], queue: publicQueue };
    nations[id] = { ...nation, privateQueue };
  }
  // Orders worked this week pay for their labour and inputs even when the last job finishes.
  const production = projectEconomy({ ...state, stateEconomies, societies }, war);
  for (const [id, s] of Object.entries(production.states)) {
    const owner = state.ownerByStateId[id];
    societies[id] = evolvePops(
      societies[id],
      owner,
      nations[owner],
      s.localPrices.grain,
      s.industries.grain.wages,
      s.industries.cloth.wages,
      s.dividends,
      s.industries.cloth.employed,
      tuning,
    );
  }
  const budgets = weeklyBudgets(nations, production);
  for (const [id, c] of Object.entries(production.countries)) {
    countryEconomies[id] = {
      ...countryEconomies[id],
      treasury: countryEconomies[id].treasury + budgets[id].balance,
    };
    const morale = war?.routes[id]
      ? Math.min(
          100,
          Math.max(0, nations[id].morale + 12 * c.military.readiness - 18 * (1 - c.military.readiness)),
        )
      : Math.min(100, nations[id].morale + 8);
    nations[id] = { ...nations[id], morale, investment: nations[id].investment + c.investment };
    c.capacity = before.countries[id].capacity;
  }
  return { ...state, stateEconomies, countryEconomies, societies, nations, lastEconomy: production };
}
