import type { Scenario } from "../scenario/scenario.ts";
import type { GameState } from "./engine.ts";
import { elapsedTicks } from "./time.ts";
import type { WarPlan } from "./diplomacy.ts";
import { byGood, byIndustrialGood, goods, industries, isGood, isIndustrialGood } from "./industry.ts";
import type { ByGood, Good } from "./industry.ts";
import { accepted, evolvePops, facilityTypes, approval, tributeRate } from "./society.ts";
import { getEconomicRules } from "./politics.ts";
import { ruleTuning } from "./settings.ts";
import { clearMarket, marketOf, nextPrice, targetPrice } from "./market.ts";
import type { MarketFill } from "./market.ts";
import { settleFiscal } from "./fiscal.ts";
import type { FiscalAccount } from "./fiscal.ts";
import { livingStandardTarget } from "./households.ts";
import { administrationWage, advanceIntegration, governanceOf, governanceRules,
  integrationStaffNeeded, integrationWeekShare } from "./governance.ts";
import { expectedTrade, settleTrade } from "./trade.ts";
import type { TradeDelivery } from "./trade.ts";
import { unrestEffects } from "./unrest.ts";
import { affordableIndustryWorkers, emptyIndustrialAccount, fundedRestock, initialIndustrialAccount,
  industrialPayroll, operateIndustry, trainedLabourCapacity, workingCapitalPerLevel, workingCapitalTarget } from "./industrial.ts";
import type { IndustrialAccount, IndustrialReport } from "./industrial.ts";

export { marketOf } from "./market.ts";

export const universityJobs = 100;
export const universityWage = 180;

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
  localQuotes?: ByGood<number>;
  industrial?: IndustrialAccount;
}
export function initialStateEconomy(site: Scenario["states"][string]): StateEconomy {
  const buildings = byGood((good) => site.buildings[good] ?? 0);
  const industrial = initialIndustrialAccount(buildings);
  return { population: site.population, buildings, ...(industrial ? { industrial } : {}) };
}
export interface Project {
  stateId: string;
  good: Building;
  weeksLeft: number;
}
export interface CountryEconomy {
  treasury: number;
  queue: Project[];
  referenceQuotes?: ByGood<number>;
  fiscal?: FiscalAccount;
}
export interface Market {
  demand: number;
  supply: number;
  price: number;
  traded?: number;
  targetPrice?: number;
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
  seaCargoUsed?: number;
  equipment: Record<"weapons" | "ammunition" | "uniforms", { demand: number; delivered: number }>;
  readiness: number;
}
export interface SiteReport {
  universityStaff?: number;
  administrationStaff?: number;
  freightWages?: number;
  industries: ByGood<IndustryReport>;
  populationChange?: number;
  foodFulfillment?: number;
  householdConsumption?: ByGood<number>;
  householdBasicOrders?: ByGood<number>;
  constructionGoods?: ByGood<number>;
  industrial?: IndustrialReport;
  consumptionIndex?: number;
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
  interestPaid?: number;
  universityWages?: number;
  administrationWages?: number;
  tradeTariff?: number;
  tradeSeaCargo?: number;
}
export interface EconomyReport {
  states: Record<string, SiteReport>;
  countries: Record<string, CountryReport>;
  trade?: TradeDelivery[];
}

export function weeklyBudgets(nations: GameState["nations"], report: EconomyReport) {
  const budgets = Object.fromEntries(Object.entries(report.countries).map(([id, country]) => [
    id, { tributeReceived: 0, balance: country.tax - country.upkeep - country.tribute - (country.interestPaid ?? 0) },
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
const basketBaseValue = goods.reduce((total, good) =>
  total + industries[good].demandPerPerson * industries[good].basePrice, 0,
);
export const privateShareOf = (n: GameState["nations"][string]) =>
  n.laws.includes("自由放任") ? 0.75 : n.laws.includes("干预主义") ? 0.5 : 0.20;
type WeeklySupply = ByGood<number> & { weapons: number; ammunition: number };

// Add this force's issues to the national report, returning its own fulfilment for combat.
function issueSupplies(
  military: MilitarySupply, stocks: Record<string, WeeklySupply>, sources: string[],
  regulars: number, fieldStrength: number, campaignGrain: number, transport: number, grainShare: number, overseas = false,
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
  let seaCargo = delivered;
  for (const kind of ["weapons", "ammunition", "uniforms"] as const) {
    const good = kind === "uniforms" ? "cloth" : kind;
    let issued = 0;
    const limit = Math.min(overseas ? transport - seaCargo : transport, needs[kind]);
    for (const id of sources) {
      const take = Math.min(limit - issued, stocks[id][good]);
      stocks[id][good] -= take;
      issued += take;
      if (issued === limit) break;
    }
    military.equipment[kind].demand += needs[kind];
    military.equipment[kind].delivered += issued;
    seaCargo += issued;
    if (needs[kind]) readiness = Math.min(readiness, issued / needs[kind]);
  }
  if (overseas) military.seaCargoUsed = seaCargo;
  return readiness;
}

export function projectEconomy(state: GameState, war?: WarPlan): EconomyReport {
  return projectSettlement(state, war).report;
}

function projectSettlement(state: GameState, war?: WarPlan, activeSites = state.societies, closingTick?: number) {
  const report: EconomyReport = { states: {}, countries: {} };
  const markets: Record<string, ByGood<Market>> = {};
  const holdings: Record<string, string[]> = {};
  const marketSites: Record<string, string[]> = {};
  const supplies: Record<string, WeeklySupply> = {},
    demands: Record<string, ByGood<number>> = {},
    householdOrders: Record<string, ByGood<number>> = {},
    constructionOrders: Record<string, ByGood<number>> = {};
  const productionStocks = new Map<string, { remaining: IndustrialAccount["stocks"]; skilledWages: number }>();
  const industrialClosing: Record<string, IndustrialAccount> = {};
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
      universityWages: 0,
      administrationWages: 0,
      tradeTariff: 0,
      tradeSeaCargo: 0,
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
    const effects = unrestEffects(site.stability);
    const militaryShare = governanceRules[governanceOf(site).mode].militaryShare;
    const regulars = Math.floor(Math.min(site.barracks * 100, local.population * 0.03) * militaryShare);
    const builders =
      state.countryEconomies[owner].queue.some((project) => project.stateId !== state.occupation?.stateId) ||
      nation.privateQueue.some((project) => project.stateId !== state.occupation?.stateId)
        ? Math.min(site.construction * 50, Math.floor(local.population * 0.01))
        : 0;
    const armourers = Math.min((site.arsenal + site.ammunition) * 30, Math.floor(local.population * 0.03));
    const engineers = site.pops
      .filter((p) => p.occupation === "工程师")
      .reduce((sum, p) => sum + p.people * (accepted(p, owner, nation) ? 1 : 0.65), 0);
    const labour = workForce(local.population) - builders - regulars - armourers;
    const universityStaff = Math.min(labour, workForce(engineers), activeSites[id].university * universityJobs);
    const integration = activeSites[id].governance?.integration;
    const administrationShare = integration && !front && state.occupation?.stateId !== id
      ? (closingTick === undefined ? 1 : integrationWeekShare(integration.startedAtTick, closingTick)) : 0;
    const administrators = administrationShare > 0
      ? Math.min(labour - universityStaff, workForce(engineers) - universityStaff,
        integrationStaffNeeded(local.population, state.settings.difficulty))
      : 0;
    const administrationDue = Math.floor(administrators * administrationShare * administrationWage);
    let workers = labour - universityStaff - administrators,
      conscripts = 0;
    const account = local.industrial;
    let payrollBudget = account?.capital ?? 0;
    const remaining = account ? { ...account.stocks } : byIndustrialGood(() => 0);
    const restock = byIndustrialGood(() => 0);
    let technicians = workForce(engineers) - universityStaff - administrators;
    let skilledWages = 0;
    const access = Math.min(
      1,
      (site.infrastructure * 11000) /
        (local.population + 2000 * (local.buildings.cloth + local.buildings.grain) +
          250 * (local.buildings.wood + local.buildings.iron + local.buildings.coal + local.buildings.tools + local.buildings.paper)),
    ) * effects.transport;
    const activity = byGood((g) => {
      const spec = industries[g];
      const industrial = isIndustrialGood(g);
      const jobs = Math.min(
        workers,
        local.buildings[g] * spec.jobs,
        g === "cloth" ? Math.floor(Math.max(0, engineers - universityStaff / 0.4) * 12) : Infinity,
        industrial ? trainedLabourCapacity(g, technicians) : Infinity,
        industrial ? affordableIndustryWorkers(g, payrollBudget) : Infinity,
      );
      const drafted =
        front && route!.mobilized
          ? Math.min(
              Math.max(0, Math.floor(site.conscription * 500 * militaryShare) - conscripts),
              Math.floor((jobs * war!.recruitPercent) / 100),
            )
          : 0;
      conscripts += drafted;
      const civilianJobs = jobs - drafted;
      const employed = industrial ? operateIndustry(g, civilianJobs, remaining, restock) : civilianJobs;
      workers -= employed + drafted;
      const payroll = industrial ? industrialPayroll(g, employed) : null;
      if (payroll) {
        payrollBudget -= payroll.total;
        technicians -= payroll.skilled;
        skilledWages += payroll.skilledWages;
      }
      const base = Math.floor((employed * spec.output * effects.output) / spec.jobs);
      const output = g === "cloth" ? Math.floor((base * (100 + c.clothOutputBonus)) / 100) : base;
      if (g === "cloth") c.clothOutputGain += output - base;
      return { employed, output, wages: payroll?.total ?? 0 };
    });
    c.military.regulars += regulars;
    c.military.conscripts += conscripts;
    c.universityWages! += universityStaff * universityWage;
    c.administrationWages! += administrationDue;
    c.upkeep += regulars * 12 + armourers * 8 + universityStaff * universityWage + administrationDue;
    const staffed = effects.output * armourers / Math.max(1, 30 * (site.arsenal + site.ammunition));
    supplies[id] = {
      ...byGood((g) => activity[g].output),
      weapons: Math.floor(170 * site.arsenal * staffed),
      ammunition: Math.floor(600 * site.ammunition * staffed),
    };
    const household = byGood((g) => Math.round(local.population * industries[g].demandPerPerson));
    const construction = byGood((g) => g === "grain" ? builders : g === "cloth" ? Math.ceil(builders / 2) : 0);
    const funded = account ? fundedRestock(payrollBudget, remaining, restock) : byIndustrialGood(() => 0);
    if (account) productionStocks.set(id, { remaining, skilledWages });
    householdOrders[id] = household;
    constructionOrders[id] = construction;
    demands[id] = byGood((g) => household[g] + construction[g] + (isIndustrialGood(g) ? funded[g] : 0));
    report.states[id] = {
      industries: activity,
      householdBasicOrders: household,
      regulars,
      universityStaff,
      administrationStaff: administrationDue / administrationWage,
      builders,
      armourers,
      conscripts,
      access,
      localPrices: byGood(() => 0),
      dividends: 0,
      investment: 0,
    };
  }
  const militaryCargo = new Map<string, number>();
  const blockadedPorts = new Set<string>();
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
        deployed, fieldStrength, fieldStrength * war!.grainPerRecruit, route.grainTransport, war!.supplyPercent / 100, route.overseas,
      );
      if (route.overseas) militaryCargo.set(owner, m.seaCargoUsed!);
      if (route.raided) for (const stateId of route.recruitmentStates) blockadedPorts.add(stateId);
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
  const referenceQuotes: Record<string, ByGood<number>> = {};
  const localQuotes: Record<string, ByGood<number>> = {};
  const expected = expectedTrade(state);
  for (const [marketId, market] of Object.entries(markets)) {
    const sites = marketSites[marketId];
    const flow = expected.markets.get(marketId);
    referenceQuotes[marketId] = byGood((g) => {
      const good = market[g];
      const base = industries[g].basePrice;
      const target = targetPrice(base, good.supply + (flow?.[g].incoming ?? 0), good.demand + (flow?.[g].outgoing ?? 0));
      const quote = nextPrice(state.countryEconomies[marketId].referenceQuotes?.[g] ?? base, target);
      good.targetPrice = Math.round(target);
      good.price = Math.round(quote);
      const clearing = clearMarket(sites.map((id) => ({
        supply: supplies[id][g], demand: demands[id][g], access: g === "services" ? 0 : report.states[id].access,
      })));
      good.traded = clearing.traded;
      sites.forEach((id, index) => { fills[g][id] = clearing.fills[index]; });
      return quote;
    });
  }
  for (const [id, site] of Object.entries(report.states)) {
    const market = markets[marketOf(state, state.ownerByStateId[id])];
    const flow = expected.sites.get(id);
    localQuotes[id] = byGood((g) => {
      const base = industries[g].basePrice;
      const target = targetPrice(base, supplies[id][g] + (flow?.[g].incoming ?? 0), demands[id][g] + (flow?.[g].outgoing ?? 0));
      return nextPrice(state.stateEconomies[id].localQuotes?.[g] ?? base, target);
    });
    site.localPrices = byGood((g) => {
      const marketShare = g === "services" ? 0 : site.access;
      return Math.round(marketShare * market[g].price + (1 - marketShare) * Math.round(localQuotes[id][g]));
    });
  }
  const trade = state.tradeRoutes?.length
    ? settleTrade(state, supplies, demands, report.states, fills, militaryCargo, blockadedPorts)
    : undefined;
  if (trade) {
    report.trade = trade.deliveries;
    for (const [id, cargo] of trade.seaCargo) report.countries[id].tradeSeaCargo = cargo;
  }
  for (const [owner, ids] of Object.entries(holdings)) {
    const c = report.countries[owner],
      nation = state.nations[owner];
    c.market = markets[marketOf(state, owner)];
    const rate =
      (nation.laws.includes("自由放任") ? 0.40 : nation.laws.includes("干预主义") ? 0.25 : 0.10) +
      (approval(nation, "地主") >= 10 || approval(nation, "实业家") >= 10 ? 0.05 : 0);
    let taxableWages = 0,
      taxableDividends = 0,
      capacity = 0;
    for (const id of ids) {
      const s = report.states[id],
        site = state.societies[id];
      const effects = unrestEffects(site.stability);
      const taxShare = id === state.occupation?.stateId ? 0 :
        effects.collection * governanceRules[governanceOf(site).mode].centralTax / 100;
      const transfer = trade?.transfers.get(id);
      const household = householdOrders[id];
      const construction = constructionOrders[id];
      const account = state.stateEconomies[id].industrial;
      let industrialIncome = 0, industrialSales = 0;
      const fillsByUse = byGood((g) => {
        const m = c.market[g],
          production = s.industries[g],
          { local: localTrade, poolBought, poolSold } = fills[g][id];
        const localPrice = Math.round(localQuotes[id][g]);
        production.sold = localTrade + poolSold + (transfer?.sent[g] ?? 0);
        production.bought = localTrade + poolBought + (transfer?.received[g] ?? 0);
        const revenue = localTrade * localPrice + poolSold * m.price + (transfer?.producerPayment[g] ?? 0);
        if (isIndustrialGood(g)) {
          industrialSales += revenue;
          industrialIncome += revenue - production.wages;
        } else {
          const occupation = g === "grain" ? "农民" : "劳工";
          const workers = site.pops.filter((p) => p.occupation === occupation);
          const paidShare = workers.reduce((n, p) => n + p.people * (accepted(p, owner, nation) ? 1 : 0.65), 0) /
            Math.max(1, workers.reduce((n, p) => n + p.people, 0));
          production.wages = Math.round(revenue * 0.45 * paidShare);
          const profit = Math.floor((revenue - production.wages) * 0.25);
          const contribution = Math.floor(profit * rate);
          s.investment += contribution;
          s.dividends += profit - contribution;
        }
        taxableWages += production.wages * taxShare;
        const demand = demands[id][g];
        const residentGoods = demand ? Math.floor(production.bought * household[g] / demand) : 0;
        const civilianGoods = demand ? Math.floor(production.bought * (household[g] + construction[g]) / demand) : 0;
        const inputGoods = production.bought - civilianGoods;
        const materialCost = inputGoods > 0
          ? Math.floor((localTrade * localPrice + poolBought * m.price + (transfer?.received[g] ?? 0) * s.localPrices[g]) *
            inputGoods / production.bought)
          : 0;
        return {
          residentGoods,
          constructionGoods: civilianGoods - residentGoods,
          constructionFulfillment: fulfillment(civilianGoods - residentGoods, construction[g]),
          inputGoods,
          materialCost,
        };
      });
      if (account) {
        const { remaining, skilledWages } = productionStocks.get(id)!;
        const bought = byIndustrialGood((g) => fillsByUse[g].inputGoods);
        const inputCost = goods.reduce((sum, g) => sum + fillsByUse[g].materialCost, 0);
        const available = account.capital + industrialIncome - inputCost;
        if (available < 0) throw new Error("工商业采购超过已落实的周转资金");
        const capital = Math.min(available, workingCapitalTarget(state.stateEconomies[id].buildings));
        const surplus = available - capital;
        const contribution = Math.floor(surplus * rate);
        s.investment += contribution;
        s.dividends += surplus - contribution;
        const stocks = byIndustrialGood((g) => remaining[g] + bought[g]);
        industrialClosing[id] = { capital, stocks };
        s.industrial = { ...industrialClosing[id], bought, used: byIndustrialGood((g) => account.stocks[g] - remaining[g]),
          spent: inputCost, sales: industrialSales, distributed: surplus, skilledWages };
      }
      if (transfer) {
        const reinvested = Math.floor(transfer.profit * rate);
        s.investment += reinvested;
        s.dividends += transfer.profit - reinvested;
        s.freightWages = transfer.freight;
        taxableWages += transfer.freight * taxShare;
        c.tradeTariff! += transfer.tariff;
      }
      s.householdConsumption = byGood((g) => fillsByUse[g].residentGoods);
      s.constructionGoods = byGood((g) => fillsByUse[g].constructionGoods);
      s.foodFulfillment = fulfillment(s.householdConsumption.grain, household.grain);
      const acquiredValue = goods.reduce((sum, g) => sum + fillsByUse[g].residentGoods * industries[g].basePrice, 0);
      s.consumptionIndex = acquiredValue / (state.stateEconomies[id].population * basketBaseValue);
      c.investment += s.investment;
      taxableDividends += s.dividends * taxShare;
      // Each staffed department buys a weekly grain/cloth basket; shortages constrain the work done.
      capacity +=
        (s.builders / 50) * effects.output *
        (0.25 + 0.75 * Math.min(fillsByUse.cloth.constructionFulfillment, fillsByUse.grain.constructionFulfillment));
    }
    c.capacity = Math.floor(capacity * 100) / 100;
    const wageTax = Math.floor((taxableWages * c.wageTaxRate) / 100);
    c.tax = wageTax + Math.floor(taxableDividends * 0.05) + c.tradeTariff!;
    c.wageTaxGain = wageTax - Math.floor(taxableWages * 0.1);
    if (nation.subjectType) c.tribute = Math.floor(c.tax * tributeRate[nation.subjectType]);
  }
  return { report, referenceQuotes, localQuotes, industrialClosing };
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
  if (state.occupation?.stateId === stateId) return "该州处于军事占领中";
  const country = state.countryEconomies[countryId],
    nation = state.nations[countryId];
  const fiscalRisk = country.fiscal?.week.risk;
  if (!privateBuild && (fiscalRisk === "restricted" || fiscalRisk === "defaulted"))
    return "公共支出不足，暂缓批准新工程";
  if (isGood(good)) {
    const queued = [...country.queue, ...nation.privateQueue].filter(
      (p) => p.good === good && p.stateId === stateId,
    ).length;
    if (state.stateEconomies[stateId].buildings[good] + queued >= (scenario.states[stateId].capacity[good] ?? 0))
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

export function chooseUniversity(scenario: Scenario, state: GameState, countryId: string) {
  if (state.countryEconomies[countryId].queue.length || state.elapsedDays % 28 !== 0 ||
      state.nations[countryId].research === null ||
      state.countryEconomies[countryId].treasury < projects.university.cost + 26 * universityJobs * universityWage) return;
  const owned = Object.keys(state.stateEconomies).filter((id) => state.ownerByStateId[id] === countryId);
  const population = owned.reduce((sum, id) => sum + state.stateEconomies[id].population, 0);
  const campuses = owned.reduce((sum, id) => sum + state.societies[id].university, 0);
  const target = Math.min(10, Math.max(1, Math.floor(population / 100_000)));
  if (campuses >= target) return;
  const site = owned.filter((id) => state.societies[id].university === 0)
    .sort((a, b) => state.stateEconomies[b].population - state.stateEconomies[a].population)[0];
  if (site && !constructionError(scenario, state, countryId, site, "university"))
    return { stateId: site, good: "university" as const };
}

export function settleEconomy(state: GameState, war?: WarPlan, fractionOfYear = 7 / 365): GameState & { lastEconomy: EconomyReport } {
  const closingTick = elapsedTicks(state);
  const before = projectSettlement(state, war, state.societies, closingTick).report;
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
      for (let index = 0; points > 0 && index < queue.length;) {
        const job = queue[index];
        if (job.stateId === state.occupation?.stateId) {
          index++;
          continue;
        }
        const cost = Math.min(points, job.weeksLeft);
        points -= cost;
        job.weeksLeft = Math.round((job.weeksLeft - cost) * 1e6) / 1e6;
        if (job.weeksLeft > 0) break;
        const { stateId, good } = job;
        if (isGood(good)) {
          const local = stateEconomies[stateId];
          const industrial = isIndustrialGood(good) ? local.industrial ?? emptyIndustrialAccount() : local.industrial;
          stateEconomies[stateId] = {
            ...local,
            buildings: { ...local.buildings, [good]: local.buildings[good] + 1 },
            ...(industrial && isIndustrialGood(good) ? { industrial: {
              ...industrial, capital: industrial.capital + workingCapitalPerLevel(good),
            } } : {}),
          };
        } else societies[stateId] = { ...societies[stateId], [good]: societies[stateId][good] + 1 };
        queue.splice(index, 1);
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
  const { report: production, referenceQuotes, localQuotes, industrialClosing } = projectSettlement(
    { ...state, stateEconomies, societies }, war, state.societies, closingTick,
  );
  const budgets = weeklyBudgets(nations, production);
  const campusFunding: Record<string, number> = {};
  const administrationFunding: Record<string, number> = {};
  for (const [id, c] of Object.entries(production.countries)) {
    const country = countryEconomies[id];
    const closing = settleFiscal({
      day: state.elapsedDays, treasury: country.treasury, fiscal: country.fiscal,
      tax: c.tax, receipts: budgets[id].balance + c.upkeep, upkeep: c.upkeep,
      fractionOfYear, difficulty: state.settings.difficulty,
    });
    const { week } = closing.fiscal;
    const educationDue = c.universityWages!;
    const administrationDue = c.administrationWages!;
    const civilianDue = educationDue + administrationDue;
    const militaryDue = c.upkeep - civilianDue;
    const educationPaid = c.upkeep > 0 ? Math.floor(week.upkeepPaid * educationDue / c.upkeep) : 0;
    const civilianPaid = c.upkeep > 0 ? Math.floor(week.upkeepPaid * civilianDue / c.upkeep) : 0;
    const administrationPaid = civilianPaid - educationPaid;
    c.universityWages = educationPaid;
    c.administrationWages = administrationPaid;
    campusFunding[id] = educationDue > 0 ? educationPaid / educationDue : 0;
    administrationFunding[id] = administrationDue > 0 ? administrationPaid / administrationDue : 0;
    if (militaryDue > 0) c.military.readiness *= Math.min(1, (week.upkeepPaid - civilianPaid) / militaryDue);
    c.upkeep = week.upkeepPaid;
    c.interestPaid = week.interestPaid;
    countryEconomies[id] = {
      ...country,
      ...closing,
      referenceQuotes: referenceQuotes[marketOf(state, id)],
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
  for (const [id, s] of Object.entries(production.states)) {
    const owner = state.ownerByStateId[id];
    s.universityStaff! *= campusFunding[owner];
    s.administrationStaff! *= administrationFunding[owner];
    stateEconomies[id] = { ...stateEconomies[id], localQuotes: localQuotes[id],
      ...(Object.hasOwn(industrialClosing, id) ? { industrial: industrialClosing[id] } : {}) };
    const site = societies[id];
    const governance = site.governance;
    if (governance?.integration) {
      societies[id] = { ...site, governance: advanceIntegration(
        governance, s.administrationStaff!, integrationStaffNeeded(stateEconomies[id].population, state.settings.difficulty),
        s.access * (1 - (site.stability?.unrest ?? 0) / 250), fractionOfYear,
      ) };
    }
    societies[id] = evolvePops(societies[id], owner, nations[owner], {
      grainPrice: s.localPrices.grain,
      grainWages: s.industries.grain.wages,
      laborWages: goods.reduce((sum, good) => sum + (good === "grain" ? 0 : s.industries[good].wages), s.freightWages ?? 0)
        - (s.industrial?.skilledWages ?? 0),
      specialistWages: s.universityStaff! * universityWage + s.administrationStaff! * administrationWage + (s.industrial?.skilledWages ?? 0),
      dividends: s.dividends,
      textileJobs: s.industries.cloth.employed,
      standardTarget: livingStandardTarget(s.consumptionIndex!, s.foodFulfillment!),
    }, tuning);
  }
  return { ...state, stateEconomies, countryEconomies, societies, nations, lastEconomy: production };
}
