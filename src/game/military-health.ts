import { z } from "zod";
import type { GameState } from "./engine.ts";
import type { EconomyReport } from "./economy.ts";
import { workForce } from "./labor.ts";
import type { SiteSocial } from "./society.ts";
import { opiumEffects } from "./opium.ts";

export const replacementTrainingDays = 12 * 7;
const recoveryWeeks = 8;
const count = z.int().nonnegative();
const replacementsSchema = z.object({ regulars: count, conscripts: count, readyDay: count })
  .refine(({ regulars, conscripts }) => regulars + conscripts > 0);
const injuriesSchema = z.object({
  people: count.positive(), regulars: count, conscripts: count,
  recovery: z.number().positive().max(recoveryWeeks), sufferedDay: count,
}).refine(({ people, regulars, conscripts }) => regulars + conscripts <= people);
export const militaryHealthSchema = z.object({
  injuries: z.array(injuriesSchema),
  replacements: z.array(replacementsSchema),
});
export const warLossesSchema = z.object({ dead: count, injured: count });

export function injuredPersonnel(site: SiteSocial) {
  const total = { people: 0, regulars: 0, conscripts: 0 };
  for (const group of site.militaryHealth?.injuries ?? []) {
    total.people += group.people;
    total.regulars += group.regulars;
    total.conscripts += group.conscripts;
  }
  return total;
}

export function activeReplacements(site: SiteSocial, day: number) {
  return (site.militaryHealth?.replacements ?? []).filter((group) => group.readyDay > day);
}

export function fitWorkforce(site: SiteSocial, population: number, day: number) {
  const vacancies = activeReplacements(site, day).reduce((sum, group) => sum + group.regulars + group.conscripts, 0);
  return Math.max(0, Math.floor(workForce(population + vacancies, site.laborParticipation) * opiumEffects(site.opiumBurden).workforce) -
    vacancies - injuredPersonnel(site).people);
}

export function recoverMilitaryInjuries(state: GameState, report: EconomyReport): GameState {
  if (!Object.values(state.societies).some((site) => site.militaryHealth !== undefined)) return state;
  const societies = { ...state.societies };
  for (const [id, site] of Object.entries(societies)) {
    if (!site.militaryHealth) continue;
    const coverage = state.occupation?.stateId === id ? 0 : report.states[id].healthcare?.coverage ?? 0;
    const injuries = site.militaryHealth.injuries.map((group) => ({
      ...group, recovery: group.recovery - (group.sufferedDay < state.elapsedDays ? 1 + coverage : 0),
    })).filter((group) => group.recovery > 0);
    const replacements = activeReplacements(site, state.elapsedDays);
    const { militaryHealth: _finished, ...social } = site;
    societies[id] = injuries.length > 0 || replacements.length > 0
      ? { ...social, militaryHealth: { injuries, replacements } }
      : social;
  }
  return { ...state, societies };
}

export interface MilitaryLoss {
  regularDead: number;
  conscriptDead: number;
  regularInjured: number;
  conscriptInjured: number;
}

export function applyMilitaryLoss(state: GameState, stateId: string, loss: MilitaryLoss) {
  const site = state.societies[stateId], local = state.stateEconomies[stateId];
  const dead = loss.regularDead + loss.conscriptDead;
  const injured = loss.regularInjured + loss.conscriptInjured;
  // Recruit deaths fall on the farm and industrial labor pools and the officer corps.
  const recruitment = site.pops.filter((pop) => pop.occupation === "农民" || pop.occupation === "劳工" || pop.occupation === "军官");
  const recruitPopulation = recruitment.reduce((sum, pop) => sum + pop.people, 0);
  const origins = recruitPopulation >= dead ? new Set(recruitment) : new Set(site.pops);
  const sourcePopulation = recruitPopulation >= dead ? recruitPopulation : local.population;
  let cumulative = 0, assigned = 0;
  const pops = dead === 0 ? site.pops : site.pops.map((pop) => {
    if (!origins.has(pop)) return pop;
    cumulative += pop.people;
    const total = Math.floor(dead * cumulative / sourcePopulation);
    const updated = { ...pop, people: pop.people - (total - assigned) };
    assigned = total;
    return updated;
  });
  const militaryHealth = {
    injuries: [...(site.militaryHealth?.injuries ?? [])],
    replacements: activeReplacements(site, state.elapsedDays),
  };
  if (injured > 0) militaryHealth.injuries.push({
    people: injured, regulars: loss.regularInjured, conscripts: loss.conscriptInjured,
    recovery: recoveryWeeks, sufferedDay: state.elapsedDays,
  });
  if (dead > 0) militaryHealth.replacements.push({
    regulars: loss.regularDead, conscripts: loss.conscriptDead, readyDay: state.elapsedDays + replacementTrainingDays,
  });
  state.societies[stateId] = { ...site, pops, militaryHealth };
  if (dead > 0) state.stateEconomies[stateId] = { ...local, population: local.population - dead };
}
