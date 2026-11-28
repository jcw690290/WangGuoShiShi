import type { Scenario } from "../scenario/scenario.ts";
import type { GameState } from "./engine.ts";
import { elapsedTicks, TICKS_PER_WEEK } from "./time.ts";
import type { WarPlan } from "./diplomacy.ts";
import { byGood, byIndustrialGood, byProductiveBuilding, commercialLevels, goods, industries, isGood, isIndustrialGood,
  isLocalGood, isProductiveBuilding, legacyCommercialCost, outputGood, productiveBuildings, productiveDefinitions } from "./industry.ts";
import type { ByGood, ByProductiveBuilding, Good, IndustrialGood, ProductiveBuilding } from "./industry.ts";
import { assignClerkHouseholds, assignMilitaryHouseholds, evolvePops, facilityNames, projectTypes, approval,
  governmentLegitimacy, influence, tributeRate } from "./society.ts";
import type { Nation, SiteSocial } from "./society.ts";
import { getEconomicRules } from "./politics.ts";
import { ruleTuning } from "./settings.ts";
import { clearMarket, marketOf, nextPrice, targetPrice } from "./market.ts";
import type { MarketFill } from "./market.ts";
import { availablePrepaymentCredit, settleFiscal } from "./fiscal.ts";
import type { FiscalAccount } from "./fiscal.ts";
import { allocateHouseholdIncome, basicEquivalentSupply, byExtraGood, extrasOrders, fundBasicBasket, isExtraGood,
  livingStandardTarget, openingBasicBudget, planBasicBasket, substitutedBasketCost } from "./households.ts";
import type { BasicPurchases, ExtrasReport, SubstituteOrders } from "./households.ts";
import { administrationWage, advanceIntegration, integrationStaffNeeded,
  integrationWeekShare, localGovernanceRule } from "./governance.ts";
import { expectedTrade, illicitOpiumEligible, settleTrade, tradeRouteBlock, tradeRouteKey } from "./trade.ts";
import type { TradeDelivery } from "./trade.ts";
import { unrestEffects } from "./unrest.ts";
import { affordableIndustryWorkers, electricityUse, electricIndustries, electricRetrofits, emptyIndustrialAccount,
  fundedRestock, initialIndustrialAccount, industrialPayroll, industrialRetrofits, industryMethodAt, isIndustrialRetrofit, materialWorkers, operateIndustry,
  productionTierAt, serviceClerks, serviceClerkWage,
  trainedLabourCapacity, workingCapitalPerLevel, workingCapitalTarget } from "./industrial.ts";
import type { IndustrialAccount, IndustrialReport, IndustrySubsidyReport } from "./industrial.ts";
import { deliverOffice, officeNeed, officeStaffCapacity, planOffice } from "./administration.ts";
import type { OfficeReport } from "./administration.ts";
import { byInstitution, byInstitutionGood, deliverInstitution, deliverInstitutionOrders,
  deliverWelfareRelief, institutionGoods, institutionLawLimit, institutionNames, institutionOperation, institutions, isInstitutionGood,
  planInstitution, planWelfareRelief } from "./institutions.ts";
import type { Institution, InstitutionReport, WelfareRelief } from "./institutions.ts";
import { harvestGood, isCrop, rentRateOf, reservedCropland, subsistenceHarvest } from "./subsistence.ts";
import type { SubsistenceReport } from "./subsistence.ts";
import { activeConstruction, affordableCrew, allocateConstructionPoints, constructionDuty, constructionJobs,
  constructionMaterials, constructionSectors, constructionWage, constructionSpending,
  crewMaterials, deliverConstruction, emptyConstructionReport, materialOrder,
  planConstructionMaintenance, reserveCrew, shareCrew } from "./construction.ts";
import type { ConstructionMaintenance, ConstructionReport, ConstructionSector, ConstructionStock } from "./construction.ts";
import { portCapacity, railCapacityPerLevel } from "./transport.ts";
import { byFleetGood, closeFleet, fleetGoods, fleetMaintenance, fleetSpending, isFleetGood,
  rubberPerMotor, shipGoodsPerConvoy, shipGoodsPerMotor } from "./fleet.ts";
import type { FleetGood, FleetReport } from "./fleet.ts";
import { bondedRuralWorkers, laborProtection, recruitableMilitaryWorkers, ruralPopulation, workForce } from "./labor.ts";
import { exciseOn, settleIncomeTax, taxPolicy } from "./taxation.ts";
import type { HouseholdIncome, TaxSystem } from "./taxation.ts";
import { civicPolicy, civicStanding } from "./civic-policy.ts";
import { allocateIndustrialSurplus, economicLaw, economicOwnershipRules, emptyOwnershipAmounts, openingOwnership,
  ownedLevels, ownershipKinds, projectOwnership } from "./ownership.ts";
import type { IndustryOwnership, Ownership, OwnershipAmounts } from "./ownership.ts";
import { battalionsAt, draftCenterQuota, equipmentNeeds, garrisonHeadcount, inTraining, refitOrder, trainingDays, trainNewBarracks } from "./military.ts";
import type { Battalion, BattalionOrder } from "./military.ts";
import { activeReplacements, fitWorkforce, injuredPersonnel } from "./military-health.ts";
import { closeNavy, navyMaintenance, warshipMaterials } from "./navy.ts";
import type { NavyReport } from "./navy.ts";
import { advanceOpiumBurden, opiumCommerceAllowed, opiumLaw, planOpium, recordOpiumLosses } from "./opium.ts";
import type { OpiumReport, OpiumSmuggling } from "./opium.ts";
import { isProductionProject, productionProject, productionProjectDefinitions, productionTierNames } from "./production-methods.ts";
import type { ProductionTier } from "./production-methods.ts";
import { industrialWage, productionHiringLimit } from "./private-labor.ts";
import type { IndustryLabor } from "./private-labor.ts";
import { militarySalary, officerSalary, publicSalary } from "./public-pay.ts";
import { accumulatePopulationServices } from "./population-services.ts";
import { investmentAccount, treasuryAccount, weeklyFinance } from "./finance-journal.ts";

export { marketOf } from "./market.ts";

export const universityJobs = 100;
export const universityWage = 180;

export type Building = (typeof projectTypes)[number];
export const projects = {
  ...productiveDefinitions,
  ...productionProjectDefinitions,
  infrastructure: { cost: 210000, weeks: 2 },
  railway: { cost: 300000, weeks: 5 },
  port: { cost: 330000, weeks: 6 },
  electrifyTools: { cost: 190000, weeks: 4 },
  electrifySteel: { cost: 190000, weeks: 4 },
  improveGrain: { cost: 130000, weeks: 3 },
  mechanizeTools: { cost: 210000, weeks: 4 },
  alloySteel: { cost: 300000, weeks: 5 },
  administrativeArchive: { cost: 160000, weeks: 4 },
  university: { cost: 360000, weeks: 3 },
  bureaucracy: { cost: 180000, weeks: 4 },
  construction: { cost: 300000, weeks: 3 },
  barracks: { cost: 180000, weeks: 2 },
  conscription: { cost: 120000, weeks: 2 },
};

export function projectName(good: Building) {
  if (isProductiveBuilding(good)) return productiveDefinitions[good].name;
  if (!isProductionProject(good)) return facilityNames[good];
  const upgrade = productionProjectDefinitions[good];
  return `${productiveDefinitions[upgrade.good].name} · ${productionTierNames[upgrade.tier]}工序改造`;
}

export function productionUpgradeFor(good: Building) {
  return isProductionProject(good) ? productionProjectDefinitions[good] : isIndustrialRetrofit(good) ? industrialRetrofits[good] : undefined;
}
export interface StateEconomy {
  population: number;
  buildings: ByProductiveBuilding<number>;
  localQuotes?: ByGood<number>;
  industrial?: IndustrialAccount;
  cropland?: number;
  commercialRecipes?: true;
  inheritedArmamentCapacity?: Partial<ArmamentOrders>;
  constructionStock?: ConstructionStock;
  basicBudget: number;
  discretionaryBudget?: number;
  localTreasury?: number;
  ownership?: IndustryOwnership;
  industryLabor?: IndustryLabor;
}
export function initialStateEconomy(site: Scenario["states"][string]): StateEconomy {
  const buildings = byProductiveBuilding((good) => site.buildings[good] ?? 0);
  const industrial = initialIndustrialAccount(buildings);
  return { population: site.population, buildings, commercialRecipes: true, basicBudget: openingBasicBudget(site.population),
    ...(industrial ? { industrial } : {}),
    ...(site.cropland === undefined ? {} : { cropland: site.cropland }) };
}
export interface Project {
  stateId: string;
  good: Building;
  weeksLeft: number;
  levels?: number;
  ownership?: Ownership;
  startedAtTick?: number;
  cancelledAtTick?: number;
}
export function projectPoints(good: Building) {
  if (good === "railway") return 250;
  if (good === "port") return 300;
  if (isProductiveBuilding(good)) {
    if (isCrop(good)) return 100;
    if (good === "wood" || good === "iron" || good === "coal" || good === "oil") return 150;
    return 200;
  }
  return good === "barracks" || good === "conscription" ? 100 : 180;
}
export function remainingProjectPoints(project: Project) {
  return project.weeksLeft * projectPoints(project.good) / projects[project.good].weeks;
}
export function projectDeposit(good: Building) {
  return isProductiveBuilding(good) ? workingCapitalPerLevel(good) : 0;
}
export function projectOpeningCapital(project: Project) {
  if (!activeConstruction(project)) return 0;
  const { good, levels } = project;
  const capital = projectDeposit(good) * (levels ?? 1);
  return levels && isGood(good) && !isIndustrialGood(good) ? Math.min(capital, legacyCommercialCost[good]) : capital;
}
export function unusedPrepaidConstruction(project: Project) {
  if (!activeConstruction(project)) return 0;
  const { good, levels, weeksLeft } = project;
  const { cost, weeks } = projects[good];
  const deposit = levels && isGood(good) && !isIndustrialGood(good) ? legacyCommercialCost[good] : cost;
  return Math.floor(Math.max(0, deposit - projectOpeningCapital(project)) * weeksLeft / weeks);
}
export interface CountryEconomy {
  treasury: number;
  queue: Project[];
  referenceQuotes?: ByGood<number>;
  fiscal?: FiscalAccount;
  industrySubsidies?: Record<string, number>;
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
  unsold?: number;
  unfilled?: number;
  buyers?: { households: number; construction: number; industry: number; publicServices: number };
  method?: ProductionTier;
  electric?: true;
}
export interface MilitarySupply {
  regulars: number;
  trainedRegulars?: number;
  conscripts: number;
  trainedConscripts?: number;
  deployedConscripts?: number;
  injuredTroops?: number;
  grainDemand: number;
  grainDrawn: number;
  grainTransport: number;
  seaCargoUsed?: number;
  seaCargoRequired?: number;
  fieldPersonnel?: number;
  procurement?: { grain: number; cloth: number; arms?: number; ammo?: number; oil?: number; rubber?: number };
  equipment: Record<"weapons" | "ammunition" | "uniforms", EquipmentIssue> & Partial<Record<"fuel" | "spares", EquipmentIssue>>;
  readiness: number;
  supplyRatio?: number;
  payroll?: { due: number; paid?: number };
}
type EquipmentIssue = { demand: number; delivered: number };
export interface SiteReport {
  industrialWage?: number;
  militaryWages?: { enlisted: number; officers: number };
  draftWorkforce?: number;
  workforce?: number;
  universityStaff?: number;
  administrationStaff?: number;
  freightWages?: number;
  portTradeCargo?: number;
  portMilitaryCargo?: number;
  power?: { requested: number; delivered: number; spending: number };
  industries: ByGood<IndustryReport>;
  cashCrops?: IndustryReport;
  populationChange?: number;
  foodFulfillment?: number;
  householdConsumption?: ByGood<number>;
  householdBasicPurchases?: BasicPurchases;
  householdBasicOrders?: ByGood<number>;
  opium?: OpiumReport;
  householdSubstituteOrders?: SubstituteOrders;
  subsistence?: SubsistenceReport;
  householdExtras?: ExtrasReport;
  constructionGoods?: ByGood<number>;
  construction?: ConstructionReport;
  constructionMaintenance?: ConstructionMaintenance;
  industrial?: IndustrialReport;
  industrySubsidy?: IndustrySubsidyReport;
  office?: OfficeReport;
  localFiscal?: { balance: number; retainedTax: number; publicSpending: number };
  healthcare?: InstitutionReport;
  policing?: InstitutionReport;
  welfare?: InstitutionReport;
  education?: InstitutionReport;
  welfareRelief?: WelfareRelief;
  consumptionIndex?: number;
  conscripts: number;
  deployedConscripts?: number;
  access: number;
  localPrices: ByGood<number>;
  dividends: number;
  ownershipIncome?: OwnershipAmounts;
  investment: number;
  builders: number;
  regulars: number;
}
export interface CountryReport {
  market: ByGood<Market>;
  tax: number;
  wageTaxRate: number;
  wageTaxGain: number;
  taxReceipts?: { system: TaxSystem; band: Nation["taxBand"]; income: number; excise: number };
  clothOutputBonus: number;
  clothOutputGain: number;
  military: MilitarySupply;
  investment: number;
  capacity: number;
  construction?: ConstructionReport;
  constructionMaintenance?: ConstructionMaintenance;
  tribute: number;
  upkeep: number;
  publicIndustryIncome?: number;
  industrySubsidiesPaid?: number;
  interestPaid?: number;
  universityWages?: number;
  administrationWages?: number;
  officeUpkeep?: number;
  healthcareUpkeep?: number;
  policingUpkeep?: number;
  welfareUpkeep?: number;
  educationUpkeep?: number;
  tradeTariff?: number;
  tradeSeaCargo?: number;
  fleet?: FleetReport;
  navy?: NavyReport;
}
export interface EconomyReport {
  states: Record<string, SiteReport>;
  countries: Record<string, CountryReport>;
  trade?: TradeDelivery[];
  opiumSmuggling?: OpiumSmuggling[];
}

export function weeklyBudgets(nations: GameState["nations"], report: EconomyReport) {
  const budgets = Object.fromEntries(Object.entries(report.countries).map(([id, country]) => [
    id, { tributeReceived: 0, balance: country.tax + (country.publicIndustryIncome ?? 0) -
      country.upkeep - country.tribute - (country.interestPaid ?? 0) - (country.industrySubsidiesPaid ?? 0) },
  ]));
  for (const [id, nation] of Object.entries(nations)) {
    if (nation.overlord === null) continue;
    const paid = report.countries[id].tribute;
    budgets[nation.overlord].tributeReceived += paid;
    budgets[nation.overlord].balance += paid;
  }
  return budgets;
}
export { workForce } from "./labor.ts";
const fulfillment = (bought: number, demand: number) => demand ? bought / demand : 1;

function privateHouseholdIncome(site: SiteReport, earnings: OwnershipAmounts): HouseholdIncome {
  const specialist = site.industrial?.skilledWages ?? 0;
  const clerical = serviceClerks(site.industries.services.employed) * serviceClerkWage;
  const wages = goods.reduce((sum, good) => sum + site.industries[good].wages, site.freightWages ?? 0);
  return {
    农民: site.subsistence?.householdIncome ?? 0,
    劳工: wages - specialist - clerical + site.construction!.private.wages + earnings.COOP,
    工程师: specialist,
    文职: clerical,
    资本家: earnings.PRIVATE,
    贵族: earnings.LAND + (site.subsistence?.landRent ?? 0),
  };
}
const basketBaseValue = goods.reduce((total, good) =>
  total + industries[good].demandPerPerson * industries[good].basePrice, 0,
);
function orderQuoteCeilings(local: StateEconomy, market: CountryEconomy) {
  return byGood((good) => {
    const base = industries[good].basePrice;
    const previous = Math.max(local.localQuotes?.[good] ?? base, market.referenceQuotes?.[good] ?? base);
    return Math.round(nextPrice(previous, base * 1.75));
  });
}

export const privateShareOf = (n: GameState["nations"][string]) =>
  economicOwnershipRules(n.laws).privateConstruction;
const equipmentGoods = { weapons: "arms", ammunition: "ammo", uniforms: "cloth", fuel: "oil", spares: "rubber" } as const;
const equipmentTypes = Object.keys(equipmentGoods) as (keyof typeof equipmentGoods)[];
const armamentGoods = ["arms", "ammo"] as const;
type ArmamentOrders = Record<(typeof armamentGoods)[number], number>;
type MilitaryGoods = Required<NonNullable<MilitarySupply["procurement"]>>;
interface SupplyContract {
  cash: number;
  prices: MilitaryGoods;
  spending: MilitaryGoods;
  proceeds: Map<string, ByGood<number>>;
}

function payMilitaryGoods(contract: SupplyContract, district: string, good: keyof MilitaryGoods, units: number) {
  if (units === 0) return;
  const price = units * contract.prices[good];
  contract.cash -= price;
  contract.spending[good] += price;
  const proceeds = contract.proceeds.get(district) ?? byGood(() => 0);
  proceeds[good] += price;
  contract.proceeds.set(district, proceeds);
}

function buyMilitaryGoods(
  contract: SupplyContract, stocks: Record<string, ByGood<number>>, sources: string[], good: keyof MilitaryGoods, limit: number,
) {
  let issued = 0;
  for (const id of sources) {
    const take = Math.min(limit - issued, stocks[id][good]);
    stocks[id][good] -= take;
    payMilitaryGoods(contract, id, good, take);
    issued += take;
    if (issued === limit) break;
  }
  return issued;
}

export function militaryProcurementCost(spending: MilitarySupply["procurement"]) {
  return spending === undefined ? 0 : spending.grain + spending.cloth + (spending.arms ?? 0) + (spending.ammo ?? 0) +
    (spending.oil ?? 0) + (spending.rubber ?? 0);
}

function availableEngineers(site: SiteSocial, owner: string, nation: GameState["nations"][string]) {
  const policy = civicPolicy(nation.laws);
  return site.pops.filter((p) => p.occupation === "工程师" || p.occupation === "文职")
    .reduce((sum, p) => sum + p.people * (0.65 + 0.35 * civicStanding(p, owner, site, policy)), 0);
}

function militarySources(ids: string[], route: WarPlan["routes"][string]) {
  const rear = ids.filter((id) => !route.recruitmentStates.has(id));
  const front = ids.filter((id) => route.connectedStates.has(id));
  return { front, rear };
}

function draftDutyTicks(route: WarPlan["routes"][string] | undefined, closingTick: number | undefined) {
  if (route?.mobilizedAtTick === undefined || closingTick === undefined) return TICKS_PER_WEEK;
  return Math.max(0, Math.min(TICKS_PER_WEEK, closingTick - route.mobilizedAtTick));
}

function planArmamentOrders(state: GameState, holdings: Record<string, string[]>, rosters: Record<string, Battalion[]>,
  wages: Record<string, number>, war?: WarPlan, closingTick?: number) {
  const orders: Record<string, ArmamentOrders> = Object.fromEntries(
    Object.keys(state.stateEconomies).map((id) => [id, { arms: 0, ammo: 0 }]),
  );
  function assign(owner: string, sources: string[], needs: ReturnType<typeof equipmentNeeds>) {
    const nation = state.nations[owner];
    for (const good of armamentGoods) {
      let remaining = good === "arms" ? needs.weapons : needs.ammunition;
      // Reach staffed, stocked suppliers first. Orders placed beyond that output fund restocking.
      for (const id of sources) {
        if (remaining === 0) break;
        const local = state.stateEconomies[id];
        if (local.buildings[good] === 0) continue;
        const account = local.industrial!;
        const site = state.societies[id];
        const spec = industryMethodAt(good, site);
        const trained = Math.max(0, workForce(availableEngineers(site, owner, nation), site.laborParticipation) - site.university * universityJobs);
        const capacity = local.buildings[good] * spec.jobs;
        const hiring = local.industryLabor ? productionHiringLimit(capacity, spec.skill[0], local.industryLabor.staffing[good]) : capacity;
        const possible = Math.min(hiring, trainedLabourCapacity(good, trained, spec),
          affordableIndustryWorkers(good, account.capital, spec, industries.electricity.basePrice, wages[id]));
        const employed = materialWorkers(good, possible, account.stocks, spec);
        const available = Math.floor(employed * spec.output * unrestEffects(site.stability).output / spec.jobs);
        const assigned = Math.min(Math.max(0, available - orders[id][good]), remaining);
        orders[id][good] += assigned;
        remaining -= assigned;
      }
      for (const id of sources) {
        if (remaining === 0) break;
        const capacity = state.stateEconomies[id].buildings[good] * industryMethodAt(good, state.societies[id]).output;
        const assigned = Math.min(capacity - orders[id][good], remaining);
        orders[id][good] += assigned;
        remaining -= assigned;
      }
    }
  }
  for (const [owner, ids] of Object.entries(holdings)) {
    const { treasury, fiscal } = state.countryEconomies[owner];
    const laws = state.nations[owner].laws;
    if (Math.max(0, treasury) + availablePrepaymentCredit(fiscal, treasury) === 0) continue;
    const route = war?.routes[owner];
    if (route) {
      const { front, rear } = militarySources(ids, route);
      let fieldReserves = 0, homeReserves = 0;
      if (route.mobilized) for (const id of route.draftOrigins) {
        const site = state.societies[id];
        const eligible = Math.max(0, fitWorkforce(site, state.stateEconomies[id].population, state.elapsedDays) -
          bondedRuralWorkers(ruralPopulation(site.pops), site.laborParticipation, laws));
        const quota = Math.min(Math.floor(eligible * war!.recruitPercent / 100), draftCenterQuota(site, laws));
        const training = activeReplacements(site, state.elapsedDays).reduce((sum, group) => sum + group.conscripts, 0);
        const front = route.deployedDrafts.has(id) ? Math.max(0, quota - training) : 0;
        fieldReserves += front;
        homeReserves += quota - front;
      }
      const deployed = ids.filter((id) => route.recruitmentStates.has(id)).flatMap((id) => rosters[id]);
      const duty = draftDutyTicks(route, closingTick);
      assign(owner, front, equipmentNeeds(deployed, Math.round(fieldReserves * duty / TICKS_PER_WEEK), true));
      assign(owner, rear, equipmentNeeds(rear.flatMap((id) => rosters[id]), 0, false));
      assign(owner, ids.filter((id) => id !== state.occupation?.stateId),
        equipmentNeeds([], Math.round(homeReserves * duty / TICKS_PER_WEEK), false));
    } else {
      assign(owner, ids, equipmentNeeds(ids.flatMap((id) => rosters[id]), 0, false));
    }
    const suppliers = ids.filter((id) => id !== state.occupation?.stateId);
    for (const id of suppliers)
      for (const unit of rosters[id]) {
        if (unit.pendingEquipment) assign(owner, suppliers, refitOrder(unit));
      }
  }
  return orders;
}

// Add this force's issues to the national report, returning its own fulfilment for combat.
function issueSupplies(
  military: MilitarySupply, contract: SupplyContract, stocks: Record<string, ByGood<number>>, sources: string[],
  demand: number, needs: ReturnType<typeof equipmentNeeds>, transport: number, grainShare: number,
  overseas = false, equipmentShare = 1,
) {
  const grain = sources.reduce((total, id) => total + stocks[id].grain, 0);
  const delivered = Math.min(demand, transport, Math.floor(grain * grainShare), Math.floor(contract.cash / contract.prices.grain));
  military.grainDemand += demand;
  military.grainDrawn += delivered;
  military.grainTransport += Math.min(transport, grain);
  let readiness = demand ? delivered / demand : 1;
  let cumulative = 0, allocated = 0;
  for (const id of sources) {
    cumulative += stocks[id].grain;
    const share = grain ? Math.floor(delivered * cumulative / grain) : 0;
    stocks[id].grain -= share - allocated;
    payMilitaryGoods(contract, id, "grain", share - allocated);
    allocated = share;
  }
  let seaCargo = delivered;
  for (const kind of equipmentTypes) {
    const good = equipmentGoods[kind];
    const available = sources.reduce((sum, id) => sum + stocks[id][good], 0);
    const limit = Math.min(overseas ? transport - seaCargo : transport, needs[kind], Math.floor(available * equipmentShare),
      Math.floor(contract.cash / contract.prices[good]));
    const issued = buyMilitaryGoods(contract, stocks, sources, good, limit);
    military.equipment[kind]!.demand += needs[kind];
    military.equipment[kind]!.delivered += issued;
    seaCargo += issued;
    if (needs[kind]) readiness = Math.min(readiness, issued / needs[kind]);
  }
  if (overseas) {
    military.seaCargoUsed = seaCargo;
    military.seaCargoRequired = equipmentTypes.reduce((sum, kind) => sum + needs[kind], demand);
  }
  return readiness;
}

function fleetPlans(state: GameState, holdings: Record<string, string[]>, scenario?: Scenario) {
  return Object.fromEntries(Object.entries(holdings).map(([owner, ids]) => {
    const { fleet, convoys, navy } = state.nations[owner];
    const ports = ids.filter((id) => state.occupation?.stateId !== id && (scenario
      ? scenario.states[id].coastal : state.stateEconomies[id].buildings.shipGoods > 0 || state.societies[id].port > 0));
    const order = fleet.order;
    const scheduledPort = order && ids.includes(order.stateId) && state.occupation?.stateId !== order.stateId ? order.stateId :
      fleet.motorizationPort && ids.includes(fleet.motorizationPort) && state.occupation?.stateId !== fleet.motorizationPort
        ? fleet.motorizationPort : null;
    const navalPort = navy.order && ids.includes(navy.order.stateId) && state.occupation?.stateId !== navy.order.stateId
      ? navy.order.stateId : null;
    const navyFirst = navalPort !== null && Math.floor(state.elapsedDays / 7) % 2 === 1;
    const port = (navyFirst ? navalPort : scheduledPort ?? navalPort) ??
      ports.sort((a, b) => state.stateEconomies[b].buildings.shipGoods - state.stateEconomies[a].buildings.shipGoods ||
        state.societies[b].port - state.societies[a].port || state.stateEconomies[b].population - state.stateEconomies[a].population)[0] ?? null;
    const risk = state.countryEconomies[owner].fiscal?.week.risk;
    const places = port !== null && risk !== "restricted" && risk !== "defaulted" ? 1 + state.societies[port].port : 0;
    const navalOrders = navy.order && navalPort !== null && port === navalPort ? navy.order.remaining : 0;
    const reserved = navyFirst ? Math.min(navalOrders, places) : 0;
    const berths = order && port === order.stateId ? Math.min(order.remaining, places - reserved) : 0;
    const refits = port !== null && port === fleet.motorizationPort
      ? Math.min(convoys - fleet.motorized, places - reserved - berths) : 0;
    const navalBerths = Math.min(navalOrders, places - berths - refits);
    const need = fleetMaintenance(convoys);
    const buffer = fleet.stores <= need * 2 ? need * 8 : need;
    const fuelDemand = fleet.motorized + refits;
    const merchantDemand = port === null ? 0 : Math.max(0, buffer + berths * shipGoodsPerConvoy + refits * shipGoodsPerMotor - fleet.stores);
    const engaged = state.borderDispute?.phase === "war" && state.borderDispute.navalMissions?.[owner] !== undefined;
    const navalUpkeep = navyMaintenance(navy) * (engaged ? 2 : 1);
    const navalMaintenance = port === null ? 0 : Math.max(0, navalUpkeep - navy.stores);
    const hullMaterials = navy.order ? warshipMaterials[navy.order.model] : 0;
    const navalDemand = port === null ? 0 : Math.max(0, navalUpkeep + navalBerths * hullMaterials - navy.stores);
    const requested = {
      shipGoods: merchantDemand + navalDemand,
      oil: port === null || fleet.oil >= fuelDemand ? 0 : Math.max(0, fuelDemand * 4 - fleet.oil),
      rubber: Math.max(0, refits * rubberPerMotor - fleet.rubber),
    };
    return [owner, { port, berths, refits, navalBerths, navalUpkeep, navalMaintenance, merchantDemand, requested, ordered: byFleetGood(() => 0),
      delivered: byFleetGood(() => 0), spending: byFleetGood(() => 0) }];
  }));
}

function fleetIndustryOrders(state: GameState, plans: ReturnType<typeof fleetPlans>, good: FleetGood,
  armyFuelDemand: Record<string, { oil: number; rubber: number }>, wages: Record<string, number>) {
  const demand = new Map<string, number>();
  const offers = new Map<string, number>();
  for (const [owner, plan] of Object.entries(plans)) {
    const market = marketOf(state, owner);
    const funded = Math.min(plan.requested[good], Math.floor(Math.max(0, state.countryEconomies[owner].treasury) /
      industries[good].basePrice));
    offers.set(owner, funded);
    const land = good === "shipGoods" ? 0 : armyFuelDemand[owner][good];
    const homeOrder = Math.min(funded + land, Math.floor(Math.max(0, state.countryEconomies[owner].treasury) /
      industries[good].basePrice));
    demand.set(market, (demand.get(market) ?? 0) + homeOrder);
  }
  const imports = new Map<string, number>();
  for (const route of state.tradeRoutes ?? []) {
    if (route.good !== good || route.paused || state.ownerByStateId[route.from] !== route.exporter ||
        plans[route.importer].port !== route.to) continue;
    const requested = Math.min(route.limit, offers.get(route.importer)!);
    imports.set(route.from, (imports.get(route.from) ?? 0) + requested);
  }
  const orders = new Map<string, number>();
  const suppliers = Object.entries(state.stateEconomies).flatMap(([id, local]) => {
    if (local.buildings[good] === 0) return [];
    const industry = industryMethodAt(good, state.societies[id]), account = local.industrial!;
    const capacity = local.buildings[good] * industry.jobs;
    const hiring = local.industryLabor ? productionHiringLimit(capacity, industry.skill[0], local.industryLabor.staffing[good]) : capacity;
    const ready = Math.floor(materialWorkers(good, Math.min(hiring,
      affordableIndustryWorkers(good, account.capital, industry, industries.electricity.basePrice, wages[id])), account.stocks, industry) *
      industry.output / industry.jobs);
    return [{ id, market: marketOf(state, state.ownerByStateId[id]), ready, limit: local.buildings[good] * industry.output }];
  });
  for (const stage of ["ready", "limit"] as const) {
    for (const { id, market, ready, limit } of suppliers) {
      const ordered = orders.get(id) ?? 0;
      const available = (stage === "ready" ? ready : limit) - ordered;
      const needed = demand.get(market) ?? 0;
      const assigned = Math.min(needed, available);
      demand.set(market, needed - assigned);
      orders.set(id, ordered + assigned);
    }
  }
  for (const { id, limit } of suppliers) {
    orders.set(id, Math.min(limit, orders.get(id)! + (imports.get(id) ?? 0)));
  }
  return orders;
}

export function projectEconomy(state: GameState, war?: WarPlan, scenario?: Scenario): EconomyReport {
  return projectSettlement(state, war, undefined, scenario).report;
}

function projectSettlement(state: GameState, war?: WarPlan, closingTick?: number, scenario?: Scenario) {
  const report: EconomyReport = { states: {}, countries: {} };
  const taxPolicies = Object.fromEntries(Object.entries(state.nations).map(([id, nation]) => [id, taxPolicy(nation)]));
  const netHouseholdIncome: Record<string, HouseholdIncome> = {};
  const taxBurden: Record<string, number> = {};
  const markets: Record<string, ByGood<Market>> = {};
  const holdings: Record<string, string[]> = {};
  const marketSites: Record<string, string[]> = {};
  const supplies: Record<string, ByGood<number>> = {},
    demands: Record<string, ByGood<number>> = {},
    householdOrders: Record<string, ByGood<number>> = {},
    constructionOrders: Record<string, ByGood<number>> = {};
  const constructionCrews: Record<string, Record<ConstructionSector, number>> = {};
  const maintenancePlans: Record<string, ReturnType<typeof planConstructionMaintenance>> = {};
  const constructionClosing: Record<string, ConstructionStock> = {};
  const constructionNeeds: Record<string, Record<ConstructionSector, number>> = {};
  const constructionSchedules: Record<string, {
    public: ReturnType<typeof constructionDuty>;
    private: ReturnType<typeof constructionDuty>;
    openTicks: number;
  }> = {};
  const privateConstructionCash: Record<string, number> = {};
  const productionStocks = new Map<string, {
    remaining: IndustrialAccount["stocks"]; restock: IndustrialAccount["stocks"];
    plannedWorkers: ByProductiveBuilding<number>; skilledWages: number;
  }>();
  const householdPlans = new Map<string, {
    basicBudget: number; discretionaryBudget: number; extra: ExtrasReport["orders"];
  }>();
  const officePlans = new Map<string, ReturnType<typeof planOffice>>();
  const institutionPlans = new Map<string, Record<Institution, ReturnType<typeof planInstitution> & { localReserved: number }>>();
  const opiumPlans = new Map<string, ReturnType<typeof planOpium> & { localReserved: number }>();
  const welfareReliefPlans = new Map<string, ReturnType<typeof planWelfareRelief> & { localReserved: number }>();
  const cashToCommit = Object.fromEntries(Object.entries(state.countryEconomies)
    .map(([id, account]) => [id, Math.max(0, account.treasury)]));
  const industrialClosing: Record<string, IndustrialAccount> = {};
  for (const [id, nation] of Object.entries(state.nations)) {
    const market = byGood(() => ({ demand: 0, supply: 0, price: 0 }));
    markets[id] = market;
    marketSites[id] = [];
    holdings[id] = [];
    const canWork = (project: Project) => project.stateId !== state.occupation?.stateId &&
      (project.good !== "opium" || opiumCommerceAllowed(nation.laws));
    const government = constructionDuty(state.countryEconomies[id].queue, closingTick, canWork, remainingProjectPoints);
    const investment = constructionDuty(nation.privateQueue, closingTick, canWork, remainingProjectPoints);
    constructionSchedules[id] = { public: government, private: investment,
      openTicks: new Set([...government.ticks, ...investment.ticks]).size };
    constructionNeeds[id] = { public: government.requestedWorkers, private: investment.requestedWorkers };
    privateConstructionCash[id] = nation.investment;
    report.countries[id] = {
      market,
      ...getEconomicRules(nation),
      tax: 0,
      wageTaxGain: 0,
      taxReceipts: { system: taxPolicies[id].system, band: nation.taxBand, income: 0, excise: 0 },
      clothOutputGain: 0,
      investment: 0,
      capacity: 0,
      construction: emptyConstructionReport(),
      constructionMaintenance: { workers: 0, wages: 0, tools: 0, materials: 0,
        ...(nation.publicPay === "standard" ? {} : { wageRate: publicSalary(constructionWage, nation.publicPay) }) },
      tribute: 0,
      upkeep: 0,
      publicIndustryIncome: 0,
      industrySubsidiesPaid: 0,
      universityWages: 0,
      administrationWages: 0,
      officeUpkeep: 0,
      healthcareUpkeep: 0,
      policingUpkeep: 0,
      welfareUpkeep: 0,
      educationUpkeep: 0,
      tradeTariff: 0,
      tradeSeaCargo: 0,
      military: {
        regulars: 0,
        trainedRegulars: 0,
        conscripts: 0,
        trainedConscripts: 0,
        deployedConscripts: 0,
        injuredTroops: 0,
        grainDemand: 0,
        grainDrawn: 0,
        grainTransport: 0,
        equipment: {
          weapons: { demand: 0, delivered: 0 },
          ammunition: { demand: 0, delivered: 0 },
          uniforms: { demand: 0, delivered: 0 },
          fuel: { demand: 0, delivered: 0 },
          spares: { demand: 0, delivered: 0 },
        },
        readiness: 1,
        payroll: { due: 0 },
      },
    };
  }
  for (const id of Object.keys(state.stateEconomies)) holdings[state.ownerByStateId[id]].push(id);
  const opiumMarkets = new Set<string>();
  const illicitDestinations = new Set<string>();
  for (const [id, local] of Object.entries(state.stateEconomies)) {
    const owner = state.ownerByStateId[id];
    if (local.buildings.opium > 0 && opiumCommerceAllowed(state.nations[owner].laws)) opiumMarkets.add(marketOf(state, owner));
  }
  for (const route of state.tradeRoutes ?? []) {
    if (route.good !== "opium") continue;
    if (!tradeRouteBlock(state, route)) opiumMarkets.add(marketOf(state, route.importer));
    if (illicitOpiumEligible(state, route)) illicitDestinations.add(route.to);
  }
  const garrisons = Object.fromEntries(Object.keys(state.stateEconomies).map((id) => [id, garrisonHeadcount(state, id)]));
  const wages = Object.fromEntries(Object.entries(state.stateEconomies).map(([id, local]) => {
    const site = state.societies[id], laws = state.nations[state.ownerByStateId[id]].laws;
    const available = fitWorkforce(site, local.population, state.elapsedDays) - garrisons[id] -
      bondedRuralWorkers(ruralPopulation(site.pops), site.laborParticipation, laws);
    return [id, industrialWage(laborProtection(laws).ordinaryWage, available, local.industrial?.capital ?? 0, local.industryLabor)];
  }));
  const rosters = Object.fromEntries(Object.keys(garrisons).map((id) => [id, battalionsAt(state, id, garrisons[id])]));
  const armamentOrders = planArmamentOrders(state, holdings, rosters, wages, war, closingTick);
  const fleets = fleetPlans(state, holdings, scenario);
  const armyFuelDemand = Object.fromEntries(Object.entries(holdings).map(([owner, ids]) => {
    const route = war?.routes[owner];
    const demand = { oil: 0, rubber: 0 };
    for (const id of ids) {
      const upkeep = equipmentNeeds(rosters[id], 0, route?.recruitmentStates.has(id) === true);
      demand.oil += upkeep.fuel;
      demand.rubber += upkeep.spares;
      if (state.occupation?.stateId === id) continue;
      for (const unit of rosters[id]) {
        if (!unit.pendingEquipment) continue;
        const refit = refitOrder(unit);
        demand.oil += refit.fuel;
        demand.rubber += refit.spares;
      }
    }
    return [owner, demand];
  }));
  const fleetProduction = byFleetGood((good) => fleetIndustryOrders(state, fleets, good, armyFuelDemand, wages));
  for (const [id, local] of Object.entries(state.stateEconomies)) {
    const owner = state.ownerByStateId[id],
      nation = state.nations[owner],
      site = state.societies[id],
      c = report.countries[owner];
    const route = war?.routes[owner],
      front = route?.recruitmentStates.has(id);
    const effects = unrestEffects(site.stability);
    const { integrationCost } = localGovernanceRule(site, nation.laws);
    const regulars = garrisons[id];
    const draftRate = route?.mobilized && route.draftOrigins.has(id) ? war!.recruitPercent : 0;
    const draftTicks = draftDutyTicks(route, closingTick);
    const draftDuty = draftTicks / TICKS_PER_WEEK;
    const injured = injuredPersonnel(site);
    const injuredTroops = injured.regulars + injured.conscripts;
    const draftQuota = Math.min(draftCenterQuota(site, nation.laws),
      Math.max(0, recruitableMilitaryWorkers(site, nation.laws) - regulars - injuredTroops));
    const engineers = availableEngineers(site, owner, nation);
    const participation = site.laborParticipation;
    const ruralPeople = ruralPopulation(site.pops);
    const workforce = fitWorkforce(site, local.population, state.elapsedDays);
    const boundToLand = Math.min(workforce, bondedRuralWorkers(ruralPeople, participation, nation.laws));
    const labour = workforce - regulars - boundToLand;
    const specialists = workForce(engineers, participation);
    const universityStaff = Math.min(labour, specialists, site.university * universityJobs);
    const unassignedAfterUniversity = Math.min(labour - universityStaff, specialists - universityStaff);
    const ordinaryWage = wages[id];
    const constructionPay = publicSalary(constructionWage, nation.publicPay);
    const teachingPay = publicSalary(universityWage, nation.publicPay);
    const administrationPay = publicSalary(administrationWage, nation.publicPay);
    const offices = state.occupation?.stateId === id ? 0 : site.bureaucracy;
    const operations = byInstitution((kind) => institutionOperation(local.population, site[kind],
      institutionLawLimit(nation.laws, kind), site.institutionDuty?.[kind], closingTick));
    const institutionLevels = institutions.reduce((sum, kind) => sum + operations[kind].equivalentLevel, 0);
    const office = planOffice(officeNeed(local.population, site, state.settings.difficulty, nation.laws, institutionLevels),
      offices, unassignedAfterUniversity, cashToCommit[owner], site.administrativeArchive === 1, administrationPay);
    officePlans.set(id, office);
    cashToCommit[owner] -= office.reserved;
    const integration = site.governance?.integration;
    const administrationShare = integration && !front && state.occupation?.stateId !== id
      ? (closingTick === undefined ? 1 : integrationWeekShare(integration.startedAtTick, closingTick)) : 0;
    const administrators = administrationShare > 0
      ? Math.min(unassignedAfterUniversity - office.staff,
        integrationStaffNeeded(local.population, state.settings.difficulty, integrationCost))
      : 0;
    const administrationDue = Math.floor(administrators * administrationShare * administrationPay);
    const ceilings = orderQuoteCeilings(local, state.countryEconomies[marketOf(state, owner)]);
    let institutionStaff = 0;
    let localCash = local.localTreasury ?? 0;
    function reserveService(cost: number) {
      const localReserved = Math.min(localCash, cost);
      localCash -= localReserved;
      cashToCommit[owner] -= cost - localReserved;
      return localReserved;
    }
    const institutionCapacity = state.occupation?.stateId === id ? 0 : unassignedAfterUniversity - office.staff - administrators;
    const services = byInstitution((kind) => {
      const plan = planInstitution(kind, operations[kind], institutionCapacity - institutionStaff,
        cashToCommit[owner] + localCash, ceilings, nation.publicPay);
      institutionStaff += plan.staff;
      return { ...plan, localReserved: reserveService(plan.reserved) };
    });
    institutionPlans.set(id, services);
    if (operations.welfare.equivalentLevel > 0) {
      const relief = planWelfareRelief(site.pops, services.welfare, cashToCommit[owner] + localCash);
      welfareReliefPlans.set(id, { ...relief, localReserved: reserveService(relief.reserved) });
    }
    const lawfulOpium = opiumLaw(nation.laws);
    const opium = planOpium(local.population, site.opiumBurden ?? 0, opiumMarkets.has(marketOf(state, owner)), lawfulOpium,
      services.healthcare.staff, local.basicBudget, cashToCommit[owner] + localCash, ceilings.opium, illicitDestinations.has(id));
    opiumPlans.set(id, { ...opium, localReserved: reserveService(opium.medicalReserve) });
    let workers = labour - universityStaff - administrators - office.staff - institutionStaff,
      conscripts = 0;
    const jobs = state.occupation?.stateId === id ? 0 : Math.min(workers, site.construction * constructionJobs);
    const need = constructionNeeds[owner];
    const duty = constructionSchedules[owner];
    const availableCrew = (ticks: number) => Math.floor(jobs * ticks / TICKS_PER_WEEK);
    const stock = local.constructionStock ?? { public: crewMaterials(0), private: crewMaterials(0) };
    const crews = shareCrew(availableCrew(duty.openTicks), privateShareOf(nation),
      affordableCrew(Math.min(availableCrew(duty.public.ticks.length), need.public),
        cashToCommit[owner], ceilings, stock.public, constructionPay),
      affordableCrew(Math.min(availableCrew(duty.private.ticks.length), need.private),
        privateConstructionCash[owner], ceilings, stock.private));
    constructionCrews[id] = crews;
    cashToCommit[owner] -= reserveCrew(crews.public, ceilings, stock.public, constructionPay);
    privateConstructionCash[owner] -= reserveCrew(crews.private, ceilings, stock.private);
    for (const sector of constructionSectors) need[sector] -= crews[sector];
    const builders = crews.public + crews.private;
    const standby = planConstructionMaintenance(jobs - builders, cashToCommit[owner], ceilings.tools, constructionPay);
    maintenancePlans[id] = standby;
    cashToCommit[owner] -= standby.reserved;
    workers -= builders + standby.workers;
    const fleet = fleets[owner];
    if (fleet.port === id) for (const good of fleetGoods) {
      const ordered = Math.min(fleet.requested[good], Math.floor(cashToCommit[owner] / ceilings[good]));
      fleet.ordered[good] = ordered;
      cashToCommit[owner] -= ordered * ceilings[good];
    }
    const account = local.industrial;
    let payrollBudget = account?.capital ?? 0;
    const remaining = account ? { ...account.stocks } : byIndustrialGood(() => 0);
    const restock = byIndustrialGood(() => 0);
    const plannedWorkers = byProductiveBuilding(() => 0);
    let technicians = specialists - universityStaff - administrators - office.staff - institutionStaff;
    let skilledWages = 0;
    const retrofitting = new Set<ProductiveBuilding>();
    for (const job of state.countryEconomies[owner].queue) {
      if (!activeConstruction(job) || job.stateId !== id || job.weeksLeft >= projects[job.good].weeks) continue;
      const upgrade = productionUpgradeFor(job.good);
      if (upgrade) retrofitting.add(upgrade.good);
    }
    const methods = byProductiveBuilding((good) => industryMethodAt(good, site));
    const powerDemand = productiveBuildings.reduce((sum, good) => sum +
      (retrofitting.has(good) ? 0 : local.buildings[good] * methods[good].power), 0);
    let powerLeft = 0, powerRequested = 0, powerUsed = 0;
    const access = Math.min(
      1,
      ((site.infrastructure + site.railway * railCapacityPerLevel) * 11000) /
        (local.population + 2000 * (local.buildings.cloth / commercialLevels.cloth + local.buildings.grain / commercialLevels.grain) +
          250 * (local.buildings.wood + local.buildings.iron + local.buildings.coal + local.buildings.tools + local.buildings.paper)),
    ) * effects.transport;
    function produce(g: ProductiveBuilding): IndustryReport {
      if (g === "opium" && lawfulOpium === "鸦片禁令") return { employed: 0, output: 0, wages: 0 };
      if (retrofitting.has(g)) return { employed: 0, output: 0, wages: 0 };
      const spec = methods[g];
      const method = productionTierAt(g, site);
      const electric = spec.power > 0;
      const ordered = g === "arms" || g === "ammo" ? armamentOrders[id][g] :
        isFleetGood(g) ? fleetProduction[g].get(id) ?? 0 : g === "electricity" ? powerDemand : Infinity;
      const civilianTarget = Math.ceil(ordered * spec.jobs / (spec.output * effects.output));
      const orderedJobs = civilianTarget === 0 ? 0 : Math.min(civilianTarget + Math.ceil((draftQuota - conscripts) * draftDuty),
        Math.ceil(civilianTarget * 100 / (100 - draftRate * draftDuty)));
      const capacity = local.buildings[g] * spec.jobs;
      const hiring = local.industryLabor ? productionHiringLimit(capacity, spec.skill[0], local.industryLabor.staffing[g]) : capacity;
      const jobs = Math.min(
        workers,
        hiring,
        orderedJobs,
        trainedLabourCapacity(g, technicians, spec),
        affordableIndustryWorkers(g, payrollBudget, spec, ceilings.electricity, ordinaryWage),
      );
      const drafted = Math.min(draftQuota - conscripts, Math.floor(jobs * draftRate / 100));
      const service = Math.floor((conscripts + drafted) * draftTicks / TICKS_PER_WEEK) -
        Math.floor(conscripts * draftTicks / TICKS_PER_WEEK);
      conscripts += drafted;
      const civilianJobs = jobs - service;
      plannedWorkers[g] = civilianJobs;
      const powerLimit = electric ? Math.floor(powerLeft * spec.jobs / spec.power) : civilianJobs;
      if (electric) powerRequested += electricityUse(spec, materialWorkers(g, civilianJobs, remaining, spec));
      const employed = operateIndustry(g, civilianJobs, remaining, restock, spec, powerLimit);
      const electricity = electricityUse(spec, employed);
      powerLeft -= electricity;
      powerUsed += electricity;
      workers -= employed + service;
      const payroll = industrialPayroll(g, employed, spec, ordinaryWage);
      payrollBudget -= payroll.total + electricity * ceilings.electricity;
      technicians -= payroll.skilled;
      skilledWages += payroll.skilledWages;
      const base = Math.floor((employed * spec.output * effects.output) / spec.jobs);
      const output = g === "cloth" ? Math.floor((base * (100 + c.clothOutputBonus)) / 100) : base;
      if (g === "cloth") c.clothOutputGain += output - base;
      return { employed, output, wages: payroll.total, ...(method === "base" ? {} : { method }),
        ...(electric ? { electric: true } : {}) };
    }
    const electricity = produce("electricity");
    powerLeft = electricity.output;
    const suppliesFirst = { grain: produce("grain"), cloth: produce("cloth"),
      arms: produce("arms"), ammo: produce("ammo"), shipGoods: produce("shipGoods"), electricity };
    const activity = byGood((g) => Object.hasOwn(suppliesFirst, g) ? suppliesFirst[g as keyof typeof suppliesFirst] : produce(g));
    const cashCrops = local.buildings.cashCrops > 0 ? produce("cashCrops") : undefined;
    if (cashCrops) {
      const luxury = activity.luxury;
      activity.luxury = { ...luxury, employed: luxury.employed + cashCrops.employed,
        output: luxury.output + cashCrops.output, wages: luxury.wages + cashCrops.wages };
    }
    c.military.regulars += regulars;
    c.military.trainedRegulars! += rosters[id].reduce((sum, unit) => sum + unit.trained, 0);
    c.military.injuredTroops! += injuredTroops;
    c.military.conscripts += conscripts;
    const trainingConscripts = activeReplacements(site, state.elapsedDays).reduce((sum, group) => sum + group.conscripts, 0);
    const trainedConscripts = route?.draftReady ? Math.max(0, conscripts - trainingConscripts) : 0;
    const deployedConscripts = route?.deployedDrafts.has(id) ? trainedConscripts : 0;
    c.military.trainedConscripts! += trainedConscripts;
    c.military.deployedConscripts! += deployedConscripts;
    c.universityWages! += universityStaff * teachingPay;
    c.administrationWages! += administrationDue;
    const militaryDue = militarySalary(regulars, conscripts, injuredTroops, nation.publicPay, draftTicks);
    c.military.payroll!.due += militaryDue;
    c.upkeep += militaryDue + universityStaff * teachingPay + administrationDue + office.wages;
    supplies[id] = byGood((g) => activity[g].output);
    const essentialNeeds = byGood((g) => Math.round(local.population * industries[g].demandPerPerson));
    const subsistence = local.cropland === undefined ? undefined : subsistenceHarvest(
      local.cropland, local.buildings, ruralPeople, workers + boundToLand, workForce(ruralPeople, participation),
      effects.output, rentRateOf(nation),
    );
    const marketNeeds = subsistence ? { ...essentialNeeds,
      grain: essentialNeeds.grain - subsistence.retained.grain,
      wood: essentialNeeds.wood - subsistence.retained.wood,
    } : essentialNeeds;
    const publicMaterials = materialOrder(crews.public, stock.public), privateMaterials = materialOrder(crews.private, stock.private);
    publicMaterials.tools += standby.tools;
    const construction = byGood((g) => g === "wood" || g === "tools" || g === "iron" ?
      publicMaterials[g] + privateMaterials[g] : 0);
    const funded = account ? fundedRestock(payrollBudget, remaining, restock) : byIndustrialGood(() => 0);
    const expectedSupply = subsistence ? { ...supplies[id],
      grain: supplies[id].grain + subsistence.produced.grain - subsistence.retained.grain,
      wood: supplies[id].wood + subsistence.produced.wood - subsistence.retained.wood,
    } : supplies[id];
    const basic = planBasicBasket(marketNeeds, expectedSupply,
      local.localQuotes ?? byGood((g) => industries[g].basePrice), funded.coal);
    const { orders: household, basicBudget, discretionaryBudget } =
      fundBasicBasket(basic, ceilings, local.basicBudget - opium.householdReserve, local.discretionaryBudget ?? 0);
    const extra = extrasOrders(local.population, discretionaryBudget, (good) => exciseOn(taxPolicies[owner], good));
    if (account) productionStocks.set(id, { remaining, restock, plannedWorkers, skilledWages });
    householdOrders[id] = household;
    householdPlans.set(id, { basicBudget, discretionaryBudget, extra });
    constructionOrders[id] = construction;
    demands[id] = byGood((g) => household[g] + (isExtraGood(g) ? extra[g] : 0) + construction[g] +
      (g === "opium" ? opium.medical + opium.nonMedical : 0) +
      (isIndustrialGood(g) ? funded[g] : 0) +
      (isInstitutionGood(g) ? institutions.reduce((units, kind) => units + services[kind].orders[g], 0) : 0) +
      (g === "paper" ? office.paperDemand : g === "services" ? office.serviceDemand :
        isFleetGood(g) && fleet.port === id ? fleet.ordered[g] : g === "electricity" ? powerUsed : 0));
    report.states[id] = {
      industries: activity,
      ...(cashCrops ? { cashCrops } : {}),
      industrialWage: ordinaryWage,
      ...(conscripts > 0 && draftTicks < TICKS_PER_WEEK ?
        { draftWorkforce: Math.floor(conscripts * draftTicks / TICKS_PER_WEEK) } : {}),
      workforce,
      ...(powerDemand > 0 || local.buildings.electricity > 0 ?
        { power: { requested: powerRequested, delivered: powerUsed, spending: 0 } } : {}),
      householdBasicOrders: essentialNeeds,
      householdSubstituteOrders: { food: household.food, coal: household.coal },
      ...(subsistence ? { subsistence } : {}),
      regulars,
      universityStaff,
      administrationStaff: administrationDue / administrationPay,
      builders,
      conscripts,
      deployedConscripts,
      access,
      localPrices: byGood(() => 0),
      dividends: 0,
      investment: 0,
    };
  }
  const militaryCargo = new Map<string, number>();
  const militaryPortUse = new Map<string, number>();
  const militaryReceipts = new Map<string, ByGood<number>>();
  const completedRefits: Record<string, BattalionOrder[]> = {};
  for (const [owner, ids] of Object.entries(holdings)) {
    const c = report.countries[owner],
      route = war?.routes[owner];
    const marketId = marketOf(state, owner),
      m = c.military,
      pool = markets[marketId];
    const priorPrices = state.countryEconomies[marketId].referenceQuotes;
    const { fiscal, treasury } = state.countryEconomies[owner];
    const contract: SupplyContract = {
      cash: cashToCommit[owner] + availablePrepaymentCredit(fiscal, treasury),
      prices: {
        grain: Math.round(priorPrices?.grain ?? industries.grain.basePrice),
        cloth: Math.round(priorPrices?.cloth ?? industries.cloth.basePrice),
        arms: Math.round(priorPrices?.arms ?? industries.arms.basePrice),
        ammo: Math.round(priorPrices?.ammo ?? industries.ammo.basePrice),
        oil: Math.round(priorPrices?.oil ?? industries.oil.basePrice),
        rubber: Math.round(priorPrices?.rubber ?? industries.rubber.basePrice),
      },
      spending: { grain: 0, cloth: 0, arms: 0, ammo: 0, oil: 0, rubber: 0 }, proceeds: militaryReceipts,
    };
    if (route) {
      const { front, rear } = militarySources(ids, route);
      const rearRegulars = rear.reduce((sum, id) => sum + report.states[id].regulars, 0);
      const deployed = m.regulars - rearRegulars;
      const draftTicks = draftDutyTicks(route, closingTick);
      const fieldReserves = Math.round(m.deployedConscripts! * draftTicks / TICKS_PER_WEEK);
      const fieldStrength = deployed + fieldReserves;
      m.fieldPersonnel = deployed + m.deployedConscripts!;
      const homeReserves = Math.round((m.conscripts - m.deployedConscripts!) * draftTicks / TICKS_PER_WEEK);
      const deployedRoster = ids.filter((id) => route.recruitmentStates.has(id)).flatMap((id) => rosters[id]);
      m.readiness = issueSupplies(
        m, contract, supplies, front,
        deployed + fieldStrength * war!.grainPerRecruit, equipmentNeeds(deployedRoster, fieldReserves, true),
        route.grainTransport, war!.supplyPercent / 100 * route.priorityShare, route.overseas, route.priorityShare,
      );
      if (route.overseas) {
        const cargo = m.seaCargoUsed!;
        militaryCargo.set(owner, cargo);
        for (const terminals of route.maritimeTerminals ?? []) {
          let remaining = cargo;
          for (const { stateId, capacity } of terminals) {
            if (remaining === 0) break;
            const handled = Math.min(remaining, capacity);
            militaryPortUse.set(stateId, handled);
            report.states[stateId].portMilitaryCargo = handled;
            remaining -= handled;
          }
        }
      }
      // Rear garrisons draw from the remaining domestic output, outside the front's transport limit.
      if (rearRegulars > 0)
        issueSupplies(m, contract, supplies, rear, rearRegulars, equipmentNeeds(rear.flatMap((id) => rosters[id]), 0, false), Infinity, 1);
      if (homeReserves > 0)
        issueSupplies(m, contract, supplies, ids.filter((id) => id !== state.occupation?.stateId),
          homeReserves, equipmentNeeds([], homeReserves, false), Infinity, 1);
    } else {
      m.readiness = issueSupplies(m, contract, supplies, ids, m.regulars, equipmentNeeds(ids.flatMap((id) => rosters[id]), 0, false), Infinity, 1);
    }
    const suppliers = ids.filter((id) => id !== state.occupation?.stateId);
    for (const id of suppliers) {
      if (!rosters[id].some((unit) => unit.pendingEquipment)) continue;
      const readyDay = state.elapsedDays + trainingDays(state.nations[owner]);
      const shipped = new Map<number, BattalionOrder>();
      for (const unit of rosters[id]) {
        if (!unit.pendingEquipment || unit.trained !== unit.personnel) continue;
        const refit = refitOrder(unit);
        const cost = equipmentTypes.reduce((sum, kind) => sum + refit[kind] * contract.prices[equipmentGoods[kind]], 0);
        if (cost > contract.cash || equipmentTypes.some((kind) => refit[kind] >
          suppliers.reduce((sum, district) => sum + supplies[district][equipmentGoods[kind]], 0))) continue;
        for (const kind of equipmentTypes) buyMilitaryGoods(contract, supplies, suppliers, equipmentGoods[kind], refit[kind]);
        shipped.set(unit.slot, { slot: unit.slot, kind: unit.kind, equipment: unit.pendingEquipment, readyDay });
      }
      if (shipped.size > 0) completedRefits[id] = state.societies[id].battalionOrders!.map((order) => shipped.get(order.slot) ?? order);
    }
    m.procurement = contract.spending;
    m.supplyRatio = m.readiness;
    c.upkeep += militaryProcurementCost(contract.spending);
    for (const id of ids) {
      const subsistence = report.states[id].subsistence;
      if (subsistence) {
        supplies[id].grain += subsistence.produced.grain - subsistence.retained.grain;
        supplies[id].wood += subsistence.produced.wood - subsistence.retained.wood;
      }
      marketSites[marketId].push(id);
      for (const g of goods) {
        pool[g].supply += supplies[id][g];
        pool[g].demand += g === "electricity" ? report.states[id].power?.requested ?? 0 : demands[id][g];
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
        supply: supplies[id][g], demand: demands[id][g], access: isLocalGood(g) ? 0 : report.states[id].access,
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
      const requested = g === "electricity" ? site.power?.requested ?? 0 : demands[id][g];
      const target = targetPrice(base, supplies[id][g] + (flow?.[g].incoming ?? 0), requested + (flow?.[g].outgoing ?? 0));
      return nextPrice(state.stateEconomies[id].localQuotes?.[g] ?? base, target);
    });
    site.localPrices = byGood((g) => {
      const marketShare = isLocalGood(g) ? 0 : site.access;
      return Math.round(marketShare * market[g].price + (1 - marketShare) * Math.round(localQuotes[id][g]));
    });
  }
  const illicitOrders = new Map<string, { quantity: number; budget: number }>();
  for (const [id, plan] of opiumPlans)
    if (plan.illicit > 0) illicitOrders.set(id, { quantity: plan.illicit, budget: plan.householdReserve });
  const trade = state.tradeRoutes?.length
    ? settleTrade(state, supplies, demands, report.states, fills, militaryCargo, militaryPortUse, war?.naval, illicitOrders)
    : undefined;
  if (trade) {
    report.trade = trade.deliveries;
    if (trade.smuggling.length > 0) report.opiumSmuggling = trade.smuggling;
    for (const [id, cargo] of trade.seaCargo) report.countries[id].tradeSeaCargo = cargo;
    for (const [id, cargo] of trade.portFreight) report.states[id].portTradeCargo = cargo;
  }
  for (const [owner, ids] of Object.entries(holdings)) {
    const c = report.countries[owner],
      nation = state.nations[owner];
    c.market = markets[marketOf(state, owner)];
    const rate =
      economicOwnershipRules(nation.laws).privateReinvestment +
      (approval(nation, "地主") >= 10 || approval(nation, "实业家") >= 10 ? 0.05 : 0);
    const policy = taxPolicies[owner];
    const receipts = c.taxReceipts!;
    let capacity = 0;
    for (const id of ids) {
      const s = report.states[id],
        site = state.societies[id];
      const effects = unrestEffects(site.stability);
      const { centralTax } = localGovernanceRule(site, nation.laws);
      const transfer = trade?.transfers.get(id);
      const household = householdOrders[id];
      const { extra, basicBudget, discretionaryBudget } = householdPlans.get(id)!;
      const construction = constructionOrders[id];
      const office = officePlans.get(id)!;
      const services = institutionPlans.get(id)!;
      const opium = opiumPlans.get(id)!;
      const local = state.stateEconomies[id];
      const account = local.industrial;
      const subsistence = s.subsistence;
      const militarySales = militaryReceipts.get(id);
      const illicitSale = trade?.illicitExports.get(id);
      const margins = byProductiveBuilding(() => 0);
      let industrialIncome = 0, industrialSales = 0;
      const fillsByUse = byGood((g) => {
        const m = c.market[g],
          production = s.industries[g],
          { local: localTrade, poolBought, poolSold } = fills[g][id];
        const localPrice = Math.round(localQuotes[id][g]);
        const sold = localTrade + poolSold + (transfer?.sent[g] ?? 0);
        production.sold = sold;
        production.bought = localTrade + poolBought + (transfer?.received[g] ?? 0);
        const unsold = supplies[id][g] - sold - (g === "opium" ? illicitSale?.attempted ?? 0 : 0);
        const unfilled = demands[id][g] - production.bought;
        if (unsold > 0) production.unsold = unsold;
        if (unfilled > 0) production.unfilled = unfilled;
        let revenue = localTrade * localPrice + poolSold * m.price + (transfer?.producerPayment[g] ?? 0);
        if (sold > 0 && subsistence && harvestGood(g)) {
          const ruralSold = Math.floor(sold * (subsistence.produced[g] - subsistence.retained[g]) / supplies[id][g]);
          const ruralRevenue = Math.floor(revenue * ruralSold / sold);
          const rent = Math.floor(ruralRevenue * subsistence.rentRate / 100);
          subsistence.sold[g] = ruralSold;
          subsistence.landRent += rent;
          subsistence.householdIncome += ruralRevenue - rent;
          production.sold -= ruralSold;
          revenue -= ruralRevenue;
        }
        revenue += militarySales?.[g] ?? 0;
        if (g === "opium" && illicitSale) {
          production.sold += illicitSale.delivered;
          revenue += illicitSale.receipts;
        }
        const margin = revenue - production.wages;
        margins[g] = margin;
        if (g === "luxury" && s.cashCrops) {
          const cropShare = production.output > 0 ? s.cashCrops.output / production.output : 0;
          s.cashCrops.sold = Math.floor(sold * cropShare);
          const cropRevenue = sold > 0 ? Math.floor(revenue * s.cashCrops.sold / sold) : 0;
          margins.cashCrops = cropRevenue - s.cashCrops.wages;
          margins.luxury -= margins.cashCrops;
        }
        industrialSales += revenue;
        industrialIncome += margin;
        const demand = demands[id][g];
        const officeOrder = g === "paper" ? office.paperDemand : g === "services" ? office.serviceDemand : 0;
        const residentOrder = household[g] + (isExtraGood(g) ? extra[g] : 0) + (g === "opium" ? opium.nonMedical : 0);
        const residentGoods = demand ? Math.floor(production.bought * residentOrder / demand) : 0;
        const basicGoods = Math.min(residentGoods, household[g]);
        const civilianGoods = demand ? Math.floor(production.bought * (residentOrder + construction[g]) / demand) : 0;
        const fleet = fleets[owner];
        const institutionOrders = byInstitution((kind) => isInstitutionGood(g) ? services[kind].orders[g] : 0);
        const fleetOrder = isFleetGood(g) && fleet.port === id ? fleet.ordered[g] : 0;
        const publicOrder = institutions.reduce((units, kind) => units + institutionOrders[kind],
          officeOrder + fleetOrder + (g === "opium" ? opium.medical : 0));
        const privateGoods = publicOrder > 0 ? Math.floor(production.bought * (demand - publicOrder) / demand) : production.bought;
        const inputGoods = privateGoods - civilianGoods;
        const payment = localTrade * localPrice + poolBought * m.price + (transfer?.received[g] ?? 0) * s.localPrices[g];
        const paidByPrivate = production.bought > 0 ? Math.floor(payment * privateGoods / production.bought) : 0;
        const paidByHouseholdsAndConstruction = production.bought > 0
          ? Math.floor(payment * civilianGoods / production.bought) : 0;
        const residentCost = production.bought > 0 ? Math.floor(payment * residentGoods / production.bought) : 0;
        const basicCost = production.bought > 0 ? Math.floor(payment * basicGoods / production.bought) : 0;
        const civilianCost = production.bought > 0 ? Math.floor(payment * civilianGoods / production.bought) : 0;
        const publicGoods = production.bought - privateGoods;
        if (production.bought > 0) production.buyers = {
          households: residentGoods, construction: civilianGoods - residentGoods,
          industry: inputGoods, publicServices: publicGoods,
        };
        const publicCost = payment - paidByPrivate;
        const publicFill = deliverInstitutionOrders(institutionOrders, publicOrder, publicGoods, publicCost);
        return {
          residentGoods,
          residentCost,
          extraGoods: residentGoods - basicGoods,
          basicCost,
          extraCost: residentCost - basicCost,
          constructionGoods: civilianGoods - residentGoods,
          constructionCost: civilianCost - residentCost,
          inputGoods,
          materialCost: paidByPrivate - paidByHouseholdsAndConstruction,
          publicGoods: publicFill.remainingGoods,
          publicCost: publicFill.remainingCost,
          institutions: publicFill.delivered,
        };
      });
      const officeCost = fillsByUse.paper.publicCost + fillsByUse.services.publicCost;
      s.office = deliverOffice(office, fillsByUse.paper.publicGoods, fillsByUse.services.publicGoods, officeCost);
      const collection = id === state.occupation?.stateId ? 0 : effects.collection * (0.75 + 0.25 * s.office.coverage);
      c.upkeep += officeCost;
      c.officeUpkeep! += s.office.wages + officeCost;
      let publicSpending = 0;
      function chargeService(paid: number, localReserved: number) {
        const localPaid = Math.min(paid, localReserved);
        publicSpending += localPaid;
        return paid - localPaid;
      }
      for (const kind of institutions) {
        const plan = services[kind];
        if (plan.equivalentLevel === 0) continue;
        const spending = institutionGoods.reduce((sum, good) => sum + fillsByUse[good].institutions[kind].paid, 0);
        const delivered = byInstitutionGood((good) => fillsByUse[good].institutions[kind].received);
        s[kind] = deliverInstitution(plan, delivered, spending, s.office.coverage);
        const paid = chargeService(plan.wages + spending, plan.localReserved);
        c[`${kind}Upkeep`]! += paid;
        c.upkeep += paid;
      }
      if (s.welfare) {
        const plan = welfareReliefPlans.get(id)!;
        const relief = deliverWelfareRelief(plan, s.welfare.coverage);
        s.welfareRelief = relief;
        const paid = chargeService(relief.paid.农民 + relief.paid.劳工, plan.localReserved);
        c.welfareUpkeep! += paid;
        c.upkeep += paid;
      }
      if (opium.medical > 0 || opium.nonMedical > 0 || opium.illicit > 0 || site.opiumBurden) {
        const { publicGoods, publicCost, residentGoods, residentCost } = fillsByUse.opium;
        const illicit = trade?.illicitImports.get(id);
        s.opium = {
          recoverySupport: 0.45 * (s.education?.coverage ?? 0) + 0.35 * (s.welfare?.coverage ?? 0) + 0.20 * (s.healthcare?.coverage ?? 0),
          medical: { ordered: opium.medical, delivered: publicGoods, spending: publicCost },
          nonMedical: { ordered: opium.nonMedical + opium.illicit, consumed: residentGoods + (illicit?.delivered ?? 0),
            spending: residentCost + (illicit?.spending ?? 0), budget: opium.householdReserve },
          ...(illicit ? { illicit } : {}),
        };
        const paid = chargeService(publicCost, opium.localReserved);
        c.healthcareUpkeep! += paid;
        c.upkeep += paid;
      }
      if (s.power) s.power.spending = fillsByUse.electricity.materialCost;
      const fleet = fleets[owner];
      if (fleet.port === id) for (const good of fleetGoods) {
        fleet.delivered[good] = fillsByUse[good].publicGoods;
        fleet.spending[good] = fillsByUse[good].publicCost;
        c.upkeep += fleet.spending[good];
      }
      let earnings = emptyOwnershipAmounts();
      if (account) {
        const { remaining, restock, plannedWorkers, skilledWages } = productionStocks.get(id)!;
        const bought = byIndustrialGood((g) => g === "electricity" ? 0 : fillsByUse[g].inputGoods);
        const inputCost = goods.reduce((sum, g) => sum + fillsByUse[g].materialCost, 0);
        const available = account.capital + industrialIncome - inputCost;
        if (available < 0) throw new Error("工商业采购超过已落实的周转资金");
        const methods = byProductiveBuilding((good) => industryMethodAt(good, site));
        const targetCapital = workingCapitalTarget(local.buildings, methods, wages[id]);
        const capital = Math.min(available, targetCapital);
        const surplus = available - capital;
        const subsidyLimit = state.countryEconomies[owner].industrySubsidies?.[id];
        if (subsidyLimit && state.occupation?.stateId !== id)
          s.industrySubsidy = { limit: subsidyLimit, shortfall: targetCapital - capital, paid: 0 };
        if (surplus > 0) {
          const totalPower = s.power?.delivered ?? 0;
          const paidPerPower = totalPower > 0 ? fillsByUse.electricity.materialCost / totalPower : 0;
          const paidPerRequestedInput = byIndustrialGood((material) =>
            restock[material] > 0 ? fillsByUse[material].materialCost / restock[material] : 0);
          for (const good of productiveBuildings) {
            const method = methods[good];
            for (const [material, need] of Object.entries(method.recipe)) {
              const units = Math.ceil(plannedWorkers[good] * need / method.jobs);
              margins[good] -= paidPerRequestedInput[material as IndustrialGood] * units;
            }
            const { employed } = productiveBuildingActivity(s, good);
            margins[good] -= paidPerPower * electricityUse(method, employed);
          }
          earnings = allocateIndustrialSurplus(surplus, margins, local.buildings, local.ownership);
        }
        const stocks = byIndustrialGood((g) => remaining[g] + bought[g]);
        industrialClosing[id] = { capital, stocks };
        s.industrial = { ...industrialClosing[id], bought, used: byIndustrialGood((g) => account.stocks[g] - remaining[g]),
          spent: inputCost, sales: industrialSales, distributed: surplus, skilledWages };
      }
      if (transfer) {
        earnings.PRIVATE += transfer.profit;
        s.freightWages = transfer.freight;
        c.tradeTariff! += transfer.tariff;
      }
      for (const kind of ownershipKinds) {
        const reinvestment = Math.floor(earnings[kind] * (kind === "PUBLIC" ? 0 : kind === "COOP" ? 0.15 : rate));
        earnings[kind] -= reinvestment;
        s.investment += reinvestment;
      }
      s.ownershipIncome = earnings;
      s.dividends = earnings.PRIVATE + earnings.LAND + earnings.COOP;
      c.publicIndustryIncome! += earnings.PUBLIC;
      const consumption = byGood((g) => g === "opium" ? 0 :
        fillsByUse[g].residentGoods + (subsistence && harvestGood(g) ? subsistence.retained[g] : 0));
      s.householdConsumption = consumption;
      const delivered = byExtraGood((g) => fillsByUse[g].extraGoods);
      const extraBills = Object.values(byExtraGood((good) => {
        const price = fillsByUse[good].extraCost;
        return { price, tax: Math.floor(price * exciseOn(policy, good) * collection) };
      }));
      const excise = extraBills.reduce((sum, bill) => sum + bill.tax, 0);
      const extraSpending = excise + extraBills.reduce((sum, bill) => sum + bill.price, 0);
      const centralExcise = Math.floor(excise * centralTax / 100);
      receipts.excise += centralExcise;
      const basicSpending = goods.reduce((sum, g) => sum + fillsByUse[g].basicCost, 0);
      if (basicSpending > basicBudget) throw new Error("基本消费超过已落实的家庭资金");
      s.householdBasicPurchases = { budget: basicBudget, spending: basicSpending };
      if (extraSpending > discretionaryBudget) throw new Error("可选消费超过已落实的家庭资金");
      s.householdExtras = { budget: discretionaryBudget, orders: extra, delivered, spending: extraSpending };
      const crews = constructionCrews[id];
      const { workers: standbyWorkers, wages: standbyWages } = maintenancePlans[id];
      const constructionPay = publicSalary(constructionWage, nation.publicPay);
      const maintenance = { workers: standbyWorkers, wages: standbyWages, tools: 0, materials: 0,
        ...(constructionPay === constructionWage ? {} : { wageRate: constructionPay }) };
      const stock = local.constructionStock ?? { public: crewMaterials(0), private: crewMaterials(0) };
      const publicOrder = materialOrder(crews.public, stock.public), privateOrder = materialOrder(crews.private, stock.private);
      const publicDelivered = crewMaterials(0), privateDelivered = crewMaterials(0);
      let publicMaterials = 0, privateMaterials = 0;
      for (const good of constructionMaterials) {
        const { constructionGoods: units, constructionCost: amount } = fillsByUse[good];
        const ordered = publicOrder[good] + privateOrder[good];
        const activeUnits = Math.min(units, ordered);
        if (good === "tools") {
          maintenance.tools = units - activeUnits;
          maintenance.materials = units ? Math.floor(amount * maintenance.tools / units) : 0;
        }
        const activeCost = amount - (good === "tools" ? maintenance.materials : 0);
        publicDelivered[good] = ordered ? Math.round(activeUnits * publicOrder[good] / ordered) : 0;
        privateDelivered[good] = activeUnits - publicDelivered[good];
        const paidPublic = activeUnits ? Math.floor(activeCost * publicDelivered[good] / activeUnits) : 0;
        publicMaterials += paidPublic;
        privateMaterials += activeCost - paidPublic;
      }
      const publicWork = deliverConstruction(crews.public, stock.public, publicDelivered, publicMaterials, effects.output, constructionPay);
      const privateWork = deliverConstruction(crews.private, stock.private, privateDelivered, privateMaterials, effects.output);
      s.construction = { public: publicWork.bill, private: privateWork.bill };
      s.constructionMaintenance = maintenance;
      const totalMaintenance = c.constructionMaintenance!;
      totalMaintenance.workers += maintenance.workers;
      totalMaintenance.wages += maintenance.wages;
      totalMaintenance.tools += maintenance.tools;
      totalMaintenance.materials += maintenance.materials;
      if (constructionMaterials.some((good) => publicWork.remaining[good] > 0 || privateWork.remaining[good] > 0)) {
        constructionClosing[id] = { public: publicWork.remaining, private: privateWork.remaining };
      }
      s.constructionGoods = byGood((good) => good === "wood" || good === "tools" || good === "iron" ?
        publicWork.used[good] + privateWork.used[good] : 0);
      for (const sector of constructionSectors) {
        const total = c.construction![sector], bill = s.construction[sector];
        total.wages += bill.wages;
        total.materials += bill.materials;
        total.points += bill.points;
      }
      c.upkeep += constructionSpending(s.construction.public) + constructionSpending(maintenance);
      const essentials = basicEquivalentSupply(s.householdConsumption, delivered);
      s.foodFulfillment = fulfillment(essentials.grain, s.householdBasicOrders!.grain);
      const acquiredValue = goods.reduce((sum, g) => sum + consumption[g] * industries[g].basePrice, 0);
      s.consumptionIndex = acquiredValue / (state.stateEconomies[id].population * basketBaseValue);
      c.investment += s.investment;
      const gross = privateHouseholdIncome(s, earnings);
      gross.文职 += s.office.wages;
      const paidTax = settleIncomeTax(gross, policy, collection);
      const incomeTax = Object.values(paidTax).reduce((sum, value) => sum + value, 0);
      const householdGross = Object.values(gross).reduce((sum, value) => sum + value, 0);
      taxBurden[id] = (incomeTax + excise) / Math.max(1, householdGross);
      const centralIncomeTax = Math.floor(incomeTax * centralTax / 100);
      receipts.income += centralIncomeTax;
      const retainedTax = incomeTax - centralIncomeTax + excise - centralExcise;
      const localTreasury = local.localTreasury ?? 0;
      if (centralTax < 100 || localTreasury > 0) s.localFiscal = {
        balance: localTreasury + retainedTax - publicSpending, retainedTax, publicSpending,
      };
      netHouseholdIncome[id] = {
        农民: gross.农民 - paidTax.农民, 劳工: gross.劳工 - paidTax.劳工, 工程师: gross.工程师 - paidTax.工程师,
        文职: gross.文职 - paidTax.文职,
        资本家: gross.资本家 - paidTax.资本家, 贵族: gross.贵族 - paidTax.贵族,
      };
      if (policy.system === "工资税改革") c.wageTaxGain += Math.floor(Math.max(0,
        paidTax.劳工 + paidTax.工程师 + paidTax.文职 -
        Math.floor((gross.劳工 + gross.工程师 + gross.文职) * 0.1 * collection * policy.multiplier)) * centralTax / 100);
      capacity += s.construction.public.points + s.construction.private.points;
    }
    c.capacity = Math.floor(capacity * 100) / 100;
    c.tax = receipts.income + receipts.excise + c.tradeTariff!;
    if (nation.subjectType) c.tribute = Math.floor(c.tax * tributeRate[nation.subjectType]);
  }
  const fleetClosing = Object.fromEntries(Object.entries(fleets).map(([owner, plan]) => {
    const { convoys, fleet, navy } = state.nations[owner];
    const navalMaterials = (amount: number) => amount - Math.min(plan.merchantDemand, Math.max(0, amount - plan.navalMaintenance));
    const navalOrdered = navalMaterials(plan.ordered.shipGoods);
    const navalDelivered = navalMaterials(plan.delivered.shipGoods);
    const navalSpending = plan.delivered.shipGoods > 0 ? Math.floor(plan.spending.shipGoods * navalDelivered / plan.delivered.shipGoods) : 0;
    const naval = closeNavy(navy, navalDelivered, plan.port, plan.navalBerths, plan.navalUpkeep);
    const { maintenanceDue, maintained, commissioned, converted, ...closing } =
      closeFleet(convoys, fleet, { ...plan.delivered, shipGoods: plan.delivered.shipGoods - navalDelivered },
        plan.port, plan.berths, plan.refits);
    const cargo = (good: FleetGood) => ({ ordered: plan.ordered[good], delivered: plan.delivered[good], spending: plan.spending[good] });
    report.countries[owner].fleet = { port: plan.port, ordered: plan.ordered.shipGoods - navalOrdered,
      delivered: plan.delivered.shipGoods - navalDelivered, spending: plan.spending.shipGoods - navalSpending,
      maintenanceDue, maintained, commissioned,
      ...(fleet.motorizationPort || fleet.motorized > 0 ? { motorization: {
        converted, fueled: closing.fleet.fueled, oil: cargo("oil"), rubber: cargo("rubber"),
      } } : {}) };
    report.countries[owner].navy = {
      port: plan.port, warships: naval.navy.warships, condition: naval.navy.condition,
      ordered: navalOrdered, delivered: navalDelivered, spending: navalSpending,
      maintenanceDue: naval.maintenanceDue, maintained: naval.maintained, commissioned: naval.commissioned,
    };
    return [owner, { ...closing, navy: naval.navy }];
  }));
  return { report, referenceQuotes, localQuotes, industrialClosing, constructionClosing, constructionSchedules,
    fleetClosing, netHouseholdIncome, taxBurden, completedRefits };
}
export function buildingCapacity(site: Scenario["states"][string], local: StateEconomy, good: ProductiveBuilding) {
  if (good === "cashCrops") return Math.floor((local.cropland ?? 0) / productiveDefinitions.cashCrops.jobs);
  const inherited = good === "arms" || good === "ammo" ? local.inheritedArmamentCapacity?.[good] : undefined;
  return Math.max(inherited ?? 0, site.capacity[good] ?? 0);
}

const idleProduction = { employed: 0, output: 0, wages: 0 };
export function productiveBuildingActivity(site: SiteReport, building: ProductiveBuilding): IndustryReport {
  const { cashCrops } = site;
  if (building === "cashCrops") return cashCrops ?? idleProduction;
  const report = site.industries[building];
  if (building !== "luxury" || !cashCrops) return report;
  const { employed, output, wages, method, electric } = report;
  return { employed: employed - cashCrops.employed, output: output - cashCrops.output,
    wages: wages - cashCrops.wages, method, electric };
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
  if (good === "railway" && nation.knowledge["铁路"] !== 100) return "需要掌握铁路技术";
  if (good === "electricity" && nation.knowledge["电气化"] !== 100) return "需要掌握电气化技术";
  const upgrade = productionUpgradeFor(good);
  if (upgrade) {
    const { good: industry, technology, tier } = upgrade;
    if (technology && nation.knowledge[technology] !== 100) return `需要掌握${technology}技术`;
    if (state.stateEconomies[stateId].buildings[industry] === 0) return "需要已经投产的产业设施";
    if (productionTierAt(industry, state.societies[stateId]) === tier) return "该产业已采用这项工序";
    if (country.queue.some((p) => activeConstruction(p) && p.stateId === stateId && productionUpgradeFor(p.good)?.good === industry))
      return "该产业已安排工序改造";
    if (tier === "advanced" && industry !== "electricity" && state.stateEconomies[stateId].buildings.electricity === 0)
      return "先进工序需要州内发电设施";
  }
  if (good === "administrativeArchive") {
    if (nation.knowledge["官僚改良"] !== 100) return "需要掌握官僚改良技术";
    if (!state.societies[stateId].bureaucracy) return "需要已有行政办事处";
    if (state.societies[stateId].administrativeArchive || country.queue.some((p) =>
      activeConstruction(p) && p.stateId === stateId && p.good === good))
      return "该州已经安排行政档案室改造";
  }
  if (good === "port" && !scenario.states[stateId].coastal) return "只能在沿海州建设港口";
  if (good === "shipGoods" && !scenario.states[stateId].coastal) return "只能在沿海州建设造船厂";
  if (good === "oil" && nation.knowledge["内燃机"] !== 100) return "需要掌握内燃机技术";
  if (good === "opium" && !opiumCommerceAllowed(nation.laws)) return "现行鸦片禁令禁止建设";
  const fiscalRisk = country.fiscal?.week.risk;
  if (!privateBuild && (fiscalRisk === "restricted" || fiscalRisk === "defaulted"))
    return "公共支出不足，暂缓批准新工程";
  if (isProductiveBuilding(good)) {
    if (privateBuild && economicLaw(nation.laws) === "国家主导" && openingOwnership(good) === "PUBLIC")
      return "国家主导制度下该产业由政府建设";
    const local = state.stateEconomies[stateId];
    const queue = [...country.queue, ...nation.privateQueue].filter((p) => activeConstruction(p) && p.stateId === stateId);
    const queued = queue.reduce((count, project) => count + (project.good === good ? project.levels ?? 1 : 0), 0);
    if (local.buildings[good] + queued >= buildingCapacity(scenario.states[stateId], local, good))
      return "州内容量已满";
    if (local.cropland !== undefined && isCrop(good) &&
        reservedCropland(local.buildings, queue) + productiveDefinitions[good].jobs > local.cropland) return "可用耕地不足";
  } else if (privateBuild) return "私人资金限用于生产建筑";
  const ceilings = orderQuoteCeilings(state.stateEconomies[stateId], state.countryEconomies[marketOf(state, countryId)]);
  const stock = state.stateEconomies[stateId].constructionStock?.[privateBuild ? "private" : "public"] ?? crewMaterials(0);
  const wage = privateBuild ? constructionWage : publicSalary(constructionWage, nation.publicPay);
  if ((privateBuild ? nation.investment : country.treasury) < projectDeposit(good) + reserveCrew(1, ceilings, stock, wage)) return "资金不足";
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
  const shortages = productiveBuildings
    .filter((building) => market[outputGood(building)].demand > market[outputGood(building)].supply)
    .sort((a, b) => {
      const left = outputGood(a), right = outputGood(b);
      if (left === right) return projectDeposit(a) - projectDeposit(b);
      return fulfillment(market[left].supply, market[left].demand) - fulfillment(market[right].supply, market[right].demand);
    });
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

export function chooseRailway(scenario: Scenario, state: GameState, countryId: string, report: EconomyReport) {
  const country = state.countryEconomies[countryId];
  if (country.queue.length || state.elapsedDays % 28 !== 0 || country.treasury < projects.railway.cost ||
      state.nations[countryId].knowledge["铁路"] !== 100) return;
  const owned = Object.keys(state.stateEconomies).filter((id) => state.ownerByStateId[id] === countryId);
  const candidates = owned.flatMap((id) => {
    if (state.societies[id].railway > 0 || constructionError(scenario, state, countryId, id, "railway")) return [];
    const neighbors = scenario.states[id].neighbors.filter((neighbor) =>
      state.ownerByStateId[neighbor] === countryId && state.occupation?.stateId !== neighbor);
    if (neighbors.length === 0) return [];
    const connected = neighbors.some((neighbor) => state.societies[neighbor].railway > 0);
    const access = report.states[id].access;
    return access < 0.85 || connected ? [{ id, connected, access }] : [];
  }).sort((left, right) => Number(right.connected) - Number(left.connected) || left.access - right.access);
  if (candidates.length > 0) return { stateId: candidates[0].id, good: "railway" as const };
}

export function choosePort(scenario: Scenario, state: GameState, countryId: string, report: EconomyReport) {
  const country = state.countryEconomies[countryId];
  if (country.queue.length || state.elapsedDays % 28 !== 0 || country.treasury < projects.port.cost) return;
  const candidates = Object.entries(report.states).flatMap(([id, site]) => {
    if (state.ownerByStateId[id] !== countryId || !scenario.states[id].coastal ||
        constructionError(scenario, state, countryId, id, "port")) return [];
    const capacity = portCapacity(scenario.states[id].grainTransport, state.societies[id]);
    const utilized = (site.portTradeCargo ?? 0) + (site.portMilitaryCargo ?? 0);
    return utilized > 0 && utilized >= capacity * 0.8 ? [{ id, utilized }] : [];
  }).sort((left, right) => right.utilized - left.utilized);
  if (candidates.length > 0) return { stateId: candidates[0].id, good: "port" as const };
}

export function chooseElectrification(scenario: Scenario, state: GameState, countryId: string): Pick<Project, "stateId" | "good"> | undefined {
  const country = state.countryEconomies[countryId];
  if (country.queue.length || state.elapsedDays % 28 !== 0 || country.treasury < projects.electricity.cost ||
      state.nations[countryId].knowledge["电气化"] !== 100) return;
  const districts = Object.entries(state.stateEconomies).filter(([id, local]) =>
    state.ownerByStateId[id] === countryId && (local.buildings.tools > 0 || local.buildings.steel > 0))
    .sort(([, a], [, b]) => b.buildings.steel + b.buildings.tools - a.buildings.steel - a.buildings.tools);
  for (const [stateId, local] of districts) {
    const retrofit = electricIndustries.map((good) => electricRetrofits[good])
      .find((good) => !constructionError(scenario, state, countryId, stateId, good));
    if (retrofit === undefined) continue;
    const good = local.buildings.electricity > 0 ? retrofit : "electricity";
    if (!constructionError(scenario, state, countryId, stateId, good)) return { stateId, good };
  }
}

export function chooseIndustrialRetrofit(scenario: Scenario, state: GameState, countryId: string, report: EconomyReport): Pick<Project, "stateId" | "good"> | undefined {
  const country = state.countryEconomies[countryId];
  if (country.queue.length || state.elapsedDays % 28 !== 0) return;
  const { market } = report.countries[countryId];
  const shortageValue = (good: ProductiveBuilding) => {
    const { demand, supply, price } = market[outputGood(good)];
    return (demand - supply) * price;
  };
  const shortages = productiveBuildings.filter((good) => shortageValue(good) > 0)
    .sort((a, b) => shortageValue(b) - shortageValue(a));
  for (const good of shortages) {
    const candidates = Object.entries(report.states)
      .filter(([id]) => state.ownerByStateId[id] === countryId)
      .map(([id, site]) => ({ id, output: productiveBuildingActivity(site, good).output }))
      .filter(({ output }) => output > 0)
      .sort((a, b) => b.output - a.output);
    for (const { id } of candidates) {
      const current = productionTierAt(good, state.societies[id]);
      if (current === "advanced") continue;
      for (const tier of ["advanced", "mechanized"] as const) {
        const project = productionProject(good, tier);
        if (tier !== current && country.treasury >= 2 * projects[project].cost &&
            !constructionError(scenario, state, countryId, id, project)) return { stateId: id, good: project };
      }
    }
  }
}

export function chooseAdministrativeArchive(scenario: Scenario, state: GameState, countryId: string, report: EconomyReport): Pick<Project, "stateId" | "good"> | undefined {
  const country = state.countryEconomies[countryId];
  if (country.queue.length || state.elapsedDays % 28 !== 0 || country.treasury < 2 * projects.administrativeArchive.cost ||
      state.nations[countryId].knowledge["官僚改良"] !== 100) return;
  const candidates = Object.entries(report.states).flatMap(([id, report]) => {
    const site = state.societies[id], office = report.office!;
    const capacity = officeStaffCapacity(site.bureaucracy, false);
    if (state.ownerByStateId[id] !== countryId || capacity === 0 || office.staff < capacity || office.need <= office.staff) return [];
    return [{ id, gap: office.need - office.staff }];
  }).sort((a, b) => b.gap - a.gap);
  const target = candidates.find(({ id }) => !constructionError(scenario, state, countryId, id, "administrativeArchive"));
  if (target) return { stateId: target.id, good: "administrativeArchive" };
}

export function settleEconomy(state: GameState, war?: WarPlan, fractionOfYear = 7 / 365, scenario?: Scenario): GameState & { lastEconomy: EconomyReport } {
  const closingTick = elapsedTicks(state);
  const tuning = ruleTuning(state.settings);
  const stateEconomies = { ...state.stateEconomies },
    societies = { ...state.societies },
    countryEconomies = { ...state.countryEconomies },
    nations = { ...state.nations };
  // A project completed from this week's deliveries starts operating next week.
  const { report: production, referenceQuotes, localQuotes, industrialClosing, constructionClosing, constructionSchedules, fleetClosing,
    netHouseholdIncome, taxBurden, completedRefits } = projectSettlement(
    state, war, closingTick, scenario,
  );
  const budgets = weeklyBudgets(nations, production);
  const campusFunding: Record<string, number> = {};
  const administrationFunding: Record<string, number> = {};
  const militaryPayroll: Record<string, { paid: number; due: number; accrued: number; allocated: number }> = {};
  const journal = weeklyFinance(closingTick);
  for (const [id, c] of Object.entries(production.countries)) {
    const country = countryEconomies[id];
    const construction = c.construction!;
    const prepaidUpkeep = c.officeUpkeep! + institutions.reduce((sum, kind) => sum + c[`${kind}Upkeep`]!, 0) +
      militaryProcurementCost(c.military.procurement) +
      constructionSpending(construction.public) + constructionSpending(c.constructionMaintenance!) + fleetSpending(c.fleet!) + c.navy!.spending;
    const closing = settleFiscal({
      day: state.elapsedDays, treasury: country.treasury, fiscal: country.fiscal,
      tax: c.tax, receipts: budgets[id].balance + c.upkeep, upkeep: c.upkeep,
      prepaidUpkeep,
      fractionOfYear, difficulty: state.settings.difficulty,
    });
    const { week } = closing.fiscal;
    // Discretionary grants follow essential spending and debt service, using only cash held above the reserve.
    let subsidyBudget = week.risk === "stable" && week.borrowed === 0 ? Math.max(0, closing.treasury - 2 * week.upkeepDue) : 0;
    for (const siteId of Object.keys(country.industrySubsidies ?? {}).sort()) {
      const site = production.states[siteId];
      const subsidy = site.industrySubsidy;
      if (!subsidy || subsidyBudget === 0) continue;
      const paid = Math.min(subsidy.limit, subsidy.shortfall, subsidyBudget);
      subsidy.paid = paid;
      subsidyBudget -= paid;
      closing.treasury -= paid;
      c.industrySubsidiesPaid! += paid;
      industrialClosing[siteId].capital += paid;
      site.industrial!.capital += paid;
      journal.transfer(treasuryAccount(id), `industry:${siteId}`, paid, "产业补贴", siteId);
    }
    const universityDue = c.universityWages!;
    const administrationDue = c.administrationWages!;
    const civilianDue = universityDue + administrationDue;
    const remainingDue = c.upkeep - prepaidUpkeep;
    const remainingPaid = week.upkeepPaid - prepaidUpkeep;
    const militaryDue = remainingDue - civilianDue;
    const universityPaid = remainingDue > 0 ? Math.floor(remainingPaid * universityDue / remainingDue) : 0;
    const civilianPaid = remainingDue > 0 ? Math.floor(remainingPaid * civilianDue / remainingDue) : 0;
    const administrationPaid = civilianPaid - universityPaid;
    c.universityWages = universityPaid;
    c.administrationWages = administrationPaid;
    campusFunding[id] = universityDue > 0 ? universityPaid / universityDue : 0;
    administrationFunding[id] = administrationDue > 0 ? administrationPaid / administrationDue : 0;
    const militaryPaid = remainingPaid - civilianPaid;
    c.military.payroll!.paid = militaryPaid;
    militaryPayroll[id] = { paid: militaryPaid, due: militaryDue, accrued: 0, allocated: 0 };
    if (militaryDue > 0) c.military.readiness *= Math.min(1, militaryPaid / militaryDue);
    c.upkeep = week.upkeepPaid;
    c.interestPaid = week.interestPaid;
    const treasury = treasuryAccount(id), lender = `credit:${id}`;
    const market = `market:${marketOf(state, id)}`;
    journal.transfer(market, treasury, c.taxReceipts!.income, "实收所得税", id);
    journal.transfer(market, treasury, c.taxReceipts!.excise, "实收消费税", id);
    journal.transfer(`ownership:${id}`, treasury, c.publicIndustryIncome!, "国有产业收益", id);
    if (nations[id].overlord !== null)
      journal.transfer(treasury, treasuryAccount(nations[id].overlord!), c.tribute, "实缴贡赋", id);
    journal.transfer(lender, treasury, Math.max(0, -country.treasury), "旧透支转入债务", id);
    journal.transfer(lender, treasury, week.borrowed, "借款到账", id);
    journal.transfer(treasury, lender, week.repaid, "归还本金", id);
    journal.transfer(treasury, lender, week.interestPaid, "实付利息", id);
    journal.transfer(treasury, `public-payroll:${id}`, militaryPaid, "实付军饷", id);
    journal.transfer(treasury, `public-payroll:${id}`, universityPaid, "大学工资", id);
    journal.transfer(treasury, `public-payroll:${id}`, administrationPaid, "整合行政工资", id);
    journal.transfer(treasury, market, militaryProcurementCost(c.military.procurement), "军需采购", id);
    journal.transfer(treasury, market, fleetSpending(c.fleet!), "商船采购与维护", id);
    journal.transfer(treasury, market, c.navy!.spending, "海军采购与维护", id);
    journal.transfer(treasury, `public-services:${id}`, c.officeUpkeep!, "行政署支出", id);
    for (const kind of institutions)
      journal.transfer(treasury, `public-services:${id}`, c[`${kind}Upkeep`]!, institutionNames[kind], id);
    journal.transfer(treasury, `construction:${id}`, constructionSpending(construction.public), "公共施工", id);
    journal.transfer(treasury, `construction:${id}`, constructionSpending(c.constructionMaintenance!), "建造部门维护", id);
    journal.transfer(investmentAccount(id), `construction:${id}`, constructionSpending(construction.private), "私人施工", id);
    journal.transfer(`ownership:${id}`, investmentAccount(id), c.investment, "收益转入投资池", id);
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
    nations[id] = { ...nations[id], ...fleetClosing[id], morale,
      investment: nations[id].investment - constructionSpending(construction.private) + c.investment };
  }
  for (const shipment of production.trade ?? []) {
    if (shipment.status !== "shipped") continue;
    const exporter = state.ownerByStateId[shipment.from], importer = state.ownerByStateId[shipment.to];
    const reference = tradeRouteKey(shipment), trade = `trade:${reference}`;
    journal.transfer(`market:${marketOf(state, importer)}`, trade, shipment.sales, "进口成交", reference);
    journal.transfer(trade, `market:${marketOf(state, exporter)}`, shipment.purchase, "进口采购", reference);
    journal.transfer(trade, `income-clearing:${shipment.to}`, shipment.freight, "贸易运费", reference);
    journal.transfer(trade, treasuryAccount(importer), shipment.tariff, "实收进口关税", reference);
    journal.transfer(trade, `ownership:${importer}`, shipment.profit, "贸易经营结余", reference);
  }
  const integrationEfficiency = new Map<string, number>();
  for (const [id, s] of Object.entries(production.states)) {
    const owner = state.ownerByStateId[id];
    s.universityStaff! *= campusFunding[owner];
    s.administrationStaff! *= administrationFunding[owner];
    const current = societies[id];
    const injured = injuredPersonnel(current);
    const injuredTroops = injured.regulars + injured.conscripts;
    const privateClerks = serviceClerks(s.industries.services.employed);
    const drafted = assignMilitaryHouseholds(current, s.regulars, s.conscripts, injuredTroops, nations[owner].laws);
    const site = assignClerkHouseholds(drafted, s.office!.staff + privateClerks);
    societies[id] = site;
    const earned = netHouseholdIncome[id];
    const band = nations[owner].publicPay;
    const publicSpecialistWages = s.universityStaff! * publicSalary(universityWage, band) +
      s.administrationStaff! * publicSalary(administrationWage, band) +
      institutions.reduce((sum, kind) => sum + (s[kind]?.wages ?? 0), 0);
    const clericalWages = earned.文职;
    const construction = s.construction!;
    const standby = s.constructionMaintenance!;
    const publicConstructionWages = construction.public.wages + standby.wages;
    const payroll = militaryPayroll[owner];
    const grossArmyWages = militarySalary(s.regulars, s.conscripts, injuredTroops, band,
      draftDutyTicks(war?.routes[owner], closingTick));
    payroll.accrued += grossArmyWages;
    const assigned = payroll.due > 0 ? Math.floor(payroll.paid * payroll.accrued / payroll.due) : 0;
    const armyWages = assigned - payroll.allocated;
    payroll.allocated = assigned;
    const officerWages = grossArmyWages > 0 ? Math.floor(armyWages * officerSalary(s.regulars, band) / grossArmyWages) : 0;
    const enlistedWages = armyWages - officerWages;
    if (grossArmyWages > 0) s.militaryWages = { enlisted: enlistedWages, officers: officerWages };
    const jobs = goods.reduce((sum, good) => sum + s.industries[good].employed, s.builders + standby.workers);
    const subsistence = s.subsistence;
    const retainedValue = subsistence ? subsistence.retained.grain * s.localPrices.grain + subsistence.retained.wood * s.localPrices.wood : 0;
    const relief = s.welfareRelief?.paid;
    const basicCost = goods.reduce((sum, good) => sum + industries[good].demandPerPerson * s.localPrices[good], 0) +
      substitutedBasketCost(s.localPrices, s.householdSubstituteOrders!) / stateEconomies[id].population;
    const income = allocateHouseholdIncome(site.pops, basicCost, {
      ...earned,
      农民: earned.农民 + (relief?.农民 ?? 0),
      劳工: earned.劳工 + publicConstructionWages + (relief?.劳工 ?? 0),
      工程师: earned.工程师 + publicSpecialistWages,
      文职: clericalWages,
      军人: enlistedWages, 军官: officerWages,
    }, retainedValue);
    const basic = s.householdBasicPurchases!;
    const habit = s.opium?.nonMedical;
    const extra = s.householdExtras!;
    const localMarket = `market:${marketOf(state, owner)}`, household = `households:${id}`;
    const localTreasury = `local-treasury:${id}`, industrialAccount = `industry:${id}`;
    journal.transfer(household, localMarket, basic.spending, "家庭基本消费", id);
    journal.transfer(household, localMarket, extra.spending, "家庭可选消费", id);
    if (habit) journal.transfer(household, localMarket, habit.spending, "非医疗依赖支出", id);
    journal.transfer(`income-clearing:${id}`, household, income.basic + income.discretionary, "家庭可支配收入", id);
    if (s.industrial) {
      const wages = goods.reduce((total, good) => total + s.industries[good].wages, 0);
      journal.transfer(localMarket, industrialAccount, s.industrial.sales, "产业销售回款", id);
      journal.transfer(industrialAccount, localMarket, s.industrial.spent, "产业实际投入支出", id);
      journal.transfer(industrialAccount, `income-clearing:${id}`, wages, "产业实付工资", id);
      journal.transfer(industrialAccount, `ownership:${owner}`, s.industrial.distributed, "产业经营结余分配", id);
    }
    if (s.localFiscal) {
      journal.transfer(localMarket, localTreasury, s.localFiscal.retainedTax, "地方留税", id);
      journal.transfer(localTreasury, `public-services:${owner}`, s.localFiscal.publicSpending, "地方实付公共服务", id);
    }
    const { constructionStock: _priorStock, ...local } = stateEconomies[id];
    const staffing = Object.fromEntries(productiveBuildings.flatMap((good) => {
      const { employed } = productiveBuildingActivity(s, good);
      if (employed === 0) return [];
      const { skilled } = industrialPayroll(good, employed, industryMethodAt(good, site), s.industrialWage!);
      return [[good, { ordinary: employed - skilled, skilled }] as const];
    }));
    stateEconomies[id] = { ...local, localQuotes: localQuotes[id],
      industryLabor: { wage: s.industrialWage!, staffing },
      basicBudget: basic.budget - basic.spending + income.basic + (habit ? habit.budget - habit.spending : 0),
      discretionaryBudget: extra.budget - extra.spending + income.discretionary,
      ...(s.localFiscal ? { localTreasury: s.localFiscal.balance } : {}),
      ...(Object.hasOwn(constructionClosing, id) ? { constructionStock: constructionClosing[id] } : {}),
      ...(Object.hasOwn(industrialClosing, id) ? { industrial: industrialClosing[id] } : {}) };
    const governance = site.governance;
    if (governance?.integration) {
      const { integrationCost } = localGovernanceRule(site, nations[owner].laws);
      let efficiency = integrationEfficiency.get(owner);
      if (efficiency === undefined) {
        const locals = Object.entries(state.ownerByStateId)
          .filter(([, country]) => country === owner).map(([id]) => state.societies[id]);
        const legitimacy = governmentLegitimacy(nations[owner], influence(locals, owner, nations[owner]));
        efficiency = Math.min(1, 0.8 + legitimacy / 250);
        integrationEfficiency.set(owner, efficiency);
      }
      societies[id] = { ...site, governance: advanceIntegration(
        governance, s.administrationStaff!, integrationStaffNeeded(stateEconomies[id].population, state.settings.difficulty, integrationCost),
        s.access * (1 - (site.stability?.unrest ?? 0) / 250) * (0.75 + 0.25 * s.office!.coverage), fractionOfYear, efficiency,
      ) };
    }
    societies[id] = evolvePops(societies[id], owner, nations[owner], {
      grainPrice: s.localPrices.grain,
      laborWages: earned.劳工 + publicConstructionWages,
      specialistWages: earned.工程师 + publicSpecialistWages,
      clerkWages: clericalWages,
      enlistedWages, officerWages,
      ruralResources: retainedValue + earned.农民,
      capitalistIncome: earned.资本家, landownerIncome: earned.贵族,
      businessJobs: jobs - privateClerks,
      standardTarget: livingStandardTarget(s.consumptionIndex!, s.foodFulfillment!),
      taxBurden: Math.min(1, taxBurden[id]),
      training: s.universityStaff! / universityJobs + (s.education?.coverage ?? 0),
      warPressure: state.occupation?.stateId === id ? 0.22 : war?.routes[owner]?.recruitmentStates.has(id) ? 0.09 : 0,
      relief,
    }, tuning);
    if (site.institutionDuty) delete societies[id].institutionDuty;
    if (state.elapsedDays > 0) {
      const services = accumulatePopulationServices(site.populationServices, s, local.population);
      if (services) societies[id].populationServices = services;
    }
    if (site.opiumBurden !== undefined || (habit && habit.consumed > 0))
      societies[id] = { ...societies[id], opiumBurden: advanceOpiumBurden(site.opiumBurden ?? 0, habit?.consumed ?? 0,
        local.population, s.opium?.recoverySupport ?? 0) };
    if (site.barracksTraining) {
      const groups = inTraining(site, state.elapsedDays);
      if (groups.length !== site.barracksTraining.length) societies[id] = { ...societies[id], barracksTraining: groups };
    }
    if (Object.hasOwn(completedRefits, id)) societies[id] = { ...societies[id], battalionOrders: completedRefits[id] };
  }
  function complete<T extends Project>(queue: T[], duty: ReturnType<typeof constructionDuty>, points: number,
    privateBuild: boolean, nation: Nation) {
    const assigned = allocateConstructionPoints(duty, points);
    const remaining: T[] = [];
    for (const job of queue) {
      if (!activeConstruction(job)) continue;
      const { startedAtTick: _startedAtTick, ...unstarted } = job;
      const worked = assigned.get(job) ?? 0;
      if (worked === 0) {
        remaining.push(unstarted as T);
        continue;
      }
      const required = remainingProjectPoints(job);
      if (worked + 1e-9 < required) {
        remaining.push({ ...unstarted, weeksLeft: (required - worked) * projects[job.good].weeks / projectPoints(job.good) } as T);
        continue;
      }
      const { stateId, good } = job;
      if (isProductiveBuilding(good)) {
        const local = stateEconomies[stateId];
        const industrial = local.industrial ?? emptyIndustrialAccount();
        const levels = job.levels ?? 1;
        const owned = { ...ownedLevels(good, local.buildings[good], local.ownership) };
        const owner = state.ownerByStateId[stateId];
        const openingCapital = projectOpeningCapital(job);
        const deposit = `construction-deposit:${owner}`;
        journal.transfer(deposit, `industry:${stateId}`, openingCapital, "工程周转金划转投产", stateId);
        owned[job.ownership ?? projectOwnership(good, nation.laws, privateBuild)] += levels;
        stateEconomies[stateId] = {
          ...local,
          buildings: { ...local.buildings, [good]: local.buildings[good] + levels },
          ownership: { ...local.ownership, [good]: owned },
          industrial: { ...industrial, capital: industrial.capital + openingCapital },
        };
      } else if (isProductionProject(good)) {
        const { good: industry, tier } = productionProjectDefinitions[good], site = societies[stateId];
        societies[stateId] = { ...site, productionMethods: { ...site.productionMethods, [industry]: tier } };
      } else {
        const site = societies[stateId];
        const upgrade = productionUpgradeFor(good);
        societies[stateId] = { ...site, [good]: upgrade ? 1 : site[good] + 1,
          ...(upgrade ? { productionMethods: { ...site.productionMethods, [upgrade.good]: upgrade.tier } } : {}),
          ...(good === "barracks" ? { barracksTraining: trainNewBarracks(site, 1, state.elapsedDays, trainingDays(nation)) } : {}) };
      }
    }
    return remaining;
  }
  for (const [id, country] of Object.entries(countryEconomies)) {
    const construction = production.countries[id].construction!;
    const duty = constructionSchedules[id];
    const nation = nations[id];
    country.queue = complete(country.queue, duty.public, construction.public.points, false, nation);
    nation.privateQueue = complete(nation.privateQueue, duty.private, construction.private.points, true, nation);
  }
  const opiumLosses = recordOpiumLosses(state, production.opiumSmuggling ?? []);
  const { opiumLosses: _previousLosses, ...world } = state;
  return { ...world, stateEconomies, countryEconomies, societies, nations,
    ...(opiumLosses ? { opiumLosses } : {}), lastEconomy: production,
    financeJournal: { settled: [...(state.financeJournal?.pending ?? []), ...journal.entries], pending: [] } };
}
