import { z } from "zod";
import type { Scenario } from "../scenario/scenario.ts";
import type { EndingMetrics } from "../scenario/endingRules.ts";
import { culturalAffinityOf } from "./culture.ts";
import { participants } from "./diplomacy.ts";
import { projectEconomy, weeklyBudgets, workForce } from "./economy.ts";
import type { EconomyReport } from "./economy.ts";
import type { GameState } from "./engine.ts";
import { goods, industrialGoods, industries } from "./industry.ts";
import { inputs } from "./industrial.ts";
import { accepted, governmentLegitimacy, influence } from "./society.ts";

export const campaignBaselineSchema = z.object({ outputPerPerson: z.number().nonnegative(), army: z.number().nonnegative() });
type CampaignBaseline = z.infer<typeof campaignBaselineSchema>;

function civilianOutput(report: EconomyReport, holdings: readonly string[]) {
  let total = 0, manufacturing = 0;
  for (const id of holdings) {
    const { industries: activity, industrial } = report.states[id];
    for (const good of goods) total += activity[good].output * industries[good].basePrice;
    if (industrial) for (const good of industrialGoods) total -= industrial.used[good] * industries[good].basePrice;
    manufacturing += activity.cloth.output * industries.cloth.basePrice;
    for (const line of ["tools", "paper"] as const) {
      const recipe: Partial<Record<(typeof industrialGoods)[number], number>> = inputs[line];
      const inputsCost = industrialGoods.reduce((sum, good) =>
        sum + Math.ceil(activity[line].employed * (recipe[good] ?? 0) / industries[line].jobs) * industries[good].basePrice, 0);
      manufacturing += activity[line].output * industries[line].basePrice - inputsCost;
    }
  }
  return { total, manufacturing };
}

function effectiveArmy(report: EconomyReport, countryId: string) {
  const { regulars, conscripts, readiness } = report.countries[countryId].military;
  return (regulars + conscripts) * readiness;
}

export function openingMetrics(state: GameState, countryId: string): CampaignBaseline {
  const held = Object.keys(state.ownerByStateId).filter((id) => state.ownerByStateId[id] === countryId);
  const population = held.reduce((sum, id) => sum + state.stateEconomies[id].population, 0);
  const report = projectEconomy(state);
  return {
    outputPerPerson: population > 0 ? civilianOutput(report, held).total / population : 0,
    army: effectiveArmy(report, countryId),
  };
}

export function measureCampaign(
  scenario: Scenario, state: GameState, countryId: string, baseline: CampaignBaseline | undefined, peacefulForeignPolicy: boolean,
): EndingMetrics {
  const nation = state.nations[countryId];
  const held = Object.keys(state.ownerByStateId).filter((id) => state.ownerByStateId[id] === countryId);
  const locals = held.map((id) => state.societies[id]);
  let people = 0, living = 0, literacy = 0, discriminated = 0, unrest = 0, core = 0, coreControlled = 0;
  for (const site of locals) for (const pop of site.pops) {
    people += pop.people;
    living += pop.livingStandard * pop.people;
    literacy += pop.literacy * pop.people;
    unrest += (site.stability?.unrest ?? 0) * pop.people;
    if (!accepted(pop, countryId, nation)) discriminated += pop.people;
  }
  let culturalContacts = 0;
  for (const site of Object.values(scenario.states)) {
    const owner = state.ownerByStateId[site.id];
    if (site.ownerId === countryId) {
      core += site.population;
      const controller = state.occupation?.stateId === site.id ? state.occupation.controllerId : owner;
      if (controller === countryId) coreControlled += site.population;
    } else if (owner !== undefined && owner !== countryId &&
        (culturalAffinityOf(state.societies[site.id])[countryId] ?? 0) >= 60) {
      culturalContacts++;
    }
  }
  const metrics: EndingMetrics = {
    ...(people > 0 ? { SOL: living / people, LIT: literacy / people, DISCRIMINATION: discriminated / people } : {}),
    ...(core > 0 ? { CORE: coreControlled / core } : {}),
    LEG: governmentLegitimacy(nation, influence(locals, countryId, nation)),
    PUP: nation.subjectType === "puppet" ? 1 : 0,
    NEWCUL: culturalContacts,
    AGGRESSION_FREE_20: peacefulForeignPolicy ? 1 : 0,
  };
  const treasury = state.countryEconomies[countryId];
  if (people > 0 && locals.every((site) => site.stability !== undefined)) metrics.TUR = unrest / people;
  const fiscal = treasury.fiscal;
  if (fiscal) {
    const { creditLimit, upkeepDue, upkeepPaid } = fiscal.week;
    if (creditLimit > 0) metrics.FISCAL_RATIO = fiscal.debt / creditLimit;
    metrics.FISCAL_RUIN = fiscal.debt >= 0.95 * creditLimit &&
      treasury.treasury < 2 * upkeepDue && upkeepPaid < 0.60 * upkeepDue ? 1 : 0;
  }
  const report = state.lastEconomy;
  if (!report || people === 0) return metrics;
  const { total, manufacturing } = civilianOutput(report, held);
  if (baseline && baseline.outputPerPerson > 0) metrics.G = total / people / baseline.outputPerPerson;
  if (baseline && baseline.army > 0) metrics.ARM = effectiveArmy(report, countryId) / baseline.army;
  if (total > 0) {
    metrics.IND = manufacturing / total;
    metrics.TRADE = (report.trade ?? []).reduce((sum, { from, to, quantity, good }) =>
      state.ownerByStateId[from] === countryId || state.ownerByStateId[to] === countryId
        ? sum + quantity * industries[good].basePrice : sum, 0) / total;
  }
  let labour = 0, employed = 0, food = 0, governance = 0;
  for (const id of held) {
    const site = report.states[id];
    const population = state.stateEconomies[id].population;
    labour += workForce(population);
    employed += goods.reduce((sum, good) => sum + site.industries[good].employed, 0) +
      site.builders + site.armourers + site.regulars + site.conscripts +
      (site.universityStaff ?? 0) + (site.administrationStaff ?? 0) + (site.office?.staff ?? 0);
    food += population * (site.foodFulfillment ?? 0);
    governance += population * (site.office?.coverage ?? 0);
  }
  if (labour > 0) metrics.U = 1 - Math.min(1, employed / labour);
  if (held.every((id) => report.states[id].foodFulfillment !== undefined)) metrics.FOOD = food / people;
  if (held.every((id) => report.states[id].office !== undefined)) metrics.GOV = governance / people;
  if (held.every((id) => report.states[id].householdBasicOrders !== undefined &&
      report.states[id].householdConsumption !== undefined)) {
    metrics.BASIC_CONSUMPTION = Math.min(...goods.filter((good) => industries[good].demandPerPerson > 0).map((good) => {
      const total = held.reduce((sum, id) => sum + report.states[id].householdConsumption![good], 0);
      const required = held.reduce((sum, id) => sum + report.states[id].householdBasicOrders![good], 0);
      return required > 0 ? Math.min(1, total / required) : 1;
    }));
  }
  const dispute = state.borderDispute;
  if (dispute?.phase === "war" && participants(dispute).includes(countryId))
    metrics.SUP = report.countries[countryId].military.readiness;
  if (fiscal && metrics.FISCAL_RATIO !== undefined)
    metrics.SUSTAINABLE_FISCAL = fiscal.week.risk === "stable" && metrics.FISCAL_RATIO < 0.6 &&
      weeklyBudgets(state.nations, report)[countryId].balance >= 0 ? 1 : 0;
  return metrics;
}
