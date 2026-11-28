import { occupationAt } from "./conflict-state.ts";
import { z } from "zod";
import type { GameState } from "./engine.ts";
import { GameRuleError } from "./rules.ts";
import { calendarMonthsPassed } from "./time.ts";
import { authorityBudget, localNegotiationAuthority } from "./constitution.ts";

const causes = ["hardship", "exclusion", "war", "politics"] as const;
type Cause = (typeof causes)[number];
export const localIncidentMonths = 24;
const incidentCooldownMonths = 24;
const calmMonthsToResolve = 2;
export const incidentNames = {
  hardship: "民生停工", exclusion: "地方拒税", war: "战时运输受阻", politics: "政治停工",
} satisfies Record<Cause, string>;
const dayNumber = z.int().nonnegative();
export const stabilitySchema = z.object({
  unrest: z.number().min(0).max(100),
  incident: z.object({
    cause: z.enum(causes), since: dayNumber, negotiated: z.boolean(), calmSince: dayNumber.optional(),
  }).nullable(),
  lastIncident: z.partialRecord(z.enum(causes), dayNumber),
  lastResolved: z.partialRecord(z.enum(causes), dayNumber).optional(),
}).refine(({ incident, lastIncident, lastResolved }) => {
  if (!incident) return true;
  const resolved = lastResolved?.[incident.cause];
  return lastIncident[incident.cause] === incident.since &&
    (resolved === undefined || resolved < incident.since) &&
    (incident.calmSince === undefined || incident.calmSince >= incident.since);
});
export type LocalStability = z.infer<typeof stabilitySchema>;
export const emptyStability = (): LocalStability => ({ unrest: 0, incident: null, lastIncident: {} });

export function advanceUnrest(
  previous: LocalStability, date: Date, day: number,
  facts: { radicals: number; living: number; excluded: number; food: number; war: number; extraHardship?: number },
  policing = 0,
): LocalStability {
  const pressure: Record<Cause, number> = {
    hardship: (1 - facts.food) * 45 + Math.max(0, 9 - facts.living) * 3 + (facts.extraHardship ?? 0),
    exclusion: facts.excluded * 55,
    war: facts.war,
    politics: Math.max(0, facts.radicals - 45) * 0.40,
  };
  const unmitigated = Math.min(100, Object.values(pressure).reduce((total, value) => total + value, 0));
  const target = Math.max(0, unmitigated * (1 - 0.30 * policing) - (previous.incident?.negotiated ? 25 : 0));
  const unrest = previous.unrest + 0.22 * (target - previous.unrest);
  let incident = previous.incident;
  let lastResolved = previous.lastResolved;
  if (incident) {
    const { cause, since, negotiated } = incident;
    const calmSince = pressure[cause] < 8 ? incident.calmSince ?? day : undefined;
    if (unrest < 20 || calendarMonthsPassed(date, day - since, localIncidentMonths) ||
        (calmSince !== undefined && calendarMonthsPassed(date, day - calmSince, calmMonthsToResolve))) {
      lastResolved = { ...lastResolved, [cause]: day };
      incident = null;
    } else {
      incident = calmSince === undefined ? { cause, since, negotiated } : { cause, since, negotiated, calmSince };
    }
  }
  let lastIncident = previous.lastIncident;
  if (incident === null && unrest >= 35) {
    const cause = [...causes].sort((left, right) => pressure[right] - pressure[left]).find((candidate) => {
      const last = lastResolved?.[candidate] ?? lastIncident[candidate];
      return pressure[candidate] >= 12 &&
        (last === undefined || calendarMonthsPassed(date, day - last, incidentCooldownMonths));
    });
    if (cause) {
      incident = { cause, since: day, negotiated: false };
      lastIncident = { ...lastIncident, [cause]: day };
    }
  }
  return lastResolved === undefined ? { unrest, incident, lastIncident } : { unrest, incident, lastIncident, lastResolved };
}

export function unrestEffects(stability: LocalStability | undefined) {
  if (!stability?.incident) return { output: 1, collection: 1, transport: 1 };
  const { incident, unrest } = stability;
  const intensity = unrest / 100;
  const collection = incident.cause === "exclusion" ? 1 - 0.30 * intensity : 1;
  return {
    output: incident.cause === "hardship" || incident.cause === "politics" ? 1 - 0.25 * intensity : 1,
    collection: incident.negotiated ? Math.min(0.85, collection) : collection,
    transport: incident.cause === "war" ? 1 - 0.40 * intensity : 1,
  };
}

export type LocalUnrestCommand = { type: "negotiateLocalUnrest"; countryId: string; stateId: string };

export function negotiateLocalUnrest(state: GameState, command: LocalUnrestCommand): GameState {
  const { countryId, stateId } = command;
  if (state.ownerByStateId[stateId] !== countryId) throw new GameRuleError("只能与本国辖区谈判");
  if (!!occupationAt(state, stateId)) throw new GameRuleError("军事占领期间无法作出中央减税承诺");
  const site = state.societies[stateId];
  const stability = site.stability;
  if (!stability?.incident || stability.incident.negotiated) throw new GameRuleError("此州没有可协商的地方事件");
  if (authorityBudget(state, countryId).available < localNegotiationAuthority)
    throw new GameRuleError(`协商减税需要 ${localNegotiationAuthority} 权威力`);
  const incident = { ...stability.incident, negotiated: true };
  return { ...state, societies: { ...state.societies, [stateId]: { ...site, stability: { ...stability, incident } } } };
}

export function chooseLocalNegotiation(state: GameState, countryId: string): LocalUnrestCommand | undefined {
  if (authorityBudget(state, countryId).available < localNegotiationAuthority) return;
  const stateId = Object.keys(state.ownerByStateId).find((id) => {
    if (state.ownerByStateId[id] !== countryId || !!occupationAt(state, id)) return false;
    const stability = state.societies[id].stability;
    return !!stability?.incident && !stability.incident.negotiated && stability.unrest >= 55;
  });
  if (stateId !== undefined) return { type: "negotiateLocalUnrest", countryId, stateId };
}
