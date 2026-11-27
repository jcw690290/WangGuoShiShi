import { z } from "zod";
import type { Scenario } from "../scenario/scenario.ts";
import { createGame, DAY_MS } from "./engine.ts";
import type { GameState } from "./engine.ts";
import { byGood, commercialLevels, industries, isIndustrialGood, originalGoods } from "./industry.ts";
import { migrateCommercialProduction } from "./commercialMigration.ts";
import { initialIndustrialAccount } from "./industrial.ts";
import { openingBasicBudget } from "./households.ts";
import { unusedPrepaidConstruction } from "./economy.ts";
import { isTaxLaw } from "./taxation.ts";

// Input boundary for published versions 1–4 of the regional demo.
export function importRegionalSave(region: Scenario, world: Scenario, save: unknown): GameState {
  const scenario = region;
  const countryId = z.enum(Object.keys(scenario.countries));
  const stateId = z.enum(Object.values(scenario.states).filter((s) => s.ownerId !== null).map((s) => s.id));
  const uint = z.int().nonnegative();
  const latestDay = Math.floor((8.64e15 - Date.parse(scenario.startDate)) / DAY_MS);
  const legacy = z.object({
    elapsedDays: uint.max(latestDay),
    playerCountryId: countryId,
    ownerByStateId: z.record(stateId, countryId),
  });
  const project = z.object({ stateId, good: z.enum(originalGoods), weeksLeft: z.int().positive() });
  const industry = z.object({ employed: uint, output: uint, wages: uint });
  const market = z.object({ demand: uint, supply: uint, price: z.int().positive() });
  const originalProducts = <T extends z.ZodType>(schema: T) => z.object({ grain: schema, cloth: schema });
  const countryReport = z.object({ market: originalProducts(market), tax: uint });
  const stateReport = z.object({ industries: originalProducts(industry), populationChange: z.int() });
  const economyReport = z.object({
    states: z.record(stateId, stateReport),
    countries: z.record(countryId, countryReport),
  });
  const economic = legacy
    .extend({
      stateEconomies: z.record(
        stateId,
        z.object({ population: z.int().positive(), buildings: originalProducts(uint) }),
      ),
      countryEconomies: z.record(countryId, z.object({ treasury: uint, queue: z.array(project) })),
      lastEconomy: economyReport.nullable(),
    })
    .refine((state) => {
      for (const [id, { queue }] of Object.entries(state.countryEconomies)) {
        if (
          !queue.every((item, index) => {
            const weeks = industries[item.good].weeks;
            return (
              state.ownerByStateId[item.stateId] === id &&
              (index === 0 ? item.weeksLeft <= weeks : item.weeksLeft === weeks)
            );
          })
        )
          return false;
      }
      return Object.entries(state.stateEconomies).every(([id, local]) => {
        const { queue } = state.countryEconomies[state.ownerByStateId[id]];
        return originalGoods.every((good) => {
          const queued = queue.filter((item) => item.stateId === id && item.good === good).length;
          return local.buildings[good] + queued <= Math.floor(scenario.states[id].capacity[good] / commercialLevels[good]);
        });
      });
    }, "建设队列或州容量无效");
  const politicsReport = countryReport.extend({
    wageTaxRate: z.literal([10, 14]),
    wageTaxGain: uint,
    clothOutputBonus: z.literal([0, 25]),
    clothOutputGain: uint,
  });
  const politicalEconomy = economyReport.extend({ countries: z.record(countryId, politicsReport) });
  const political = economic.safeExtend({
    countryPolitics: z.record(
      countryId,
      z.object({
        reformWeeks: uint.max(2).nullable(),
        researchWeeks: uint.max(4).nullable(),
      }),
    ),
    lastEconomy: politicalEconomy.nullable(),
  });
  const parties = z.object({ claimantId: countryId, defenderId: countryId });
  const dispute = z.discriminatedUnion("phase", [
    parties.extend({ phase: z.literal("demanded") }),
    parties.extend({ phase: z.literal("answered"), response: z.enum(["recognition", "refusal"]) }),
    parties.extend({
      phase: z.literal("war"),
      progress: uint.max(100),
      lastChange: z.int().min(-100).max(100).nullable(),
    }),
    parties.extend({
      phase: z.literal("resolved"),
      outcome: z.enum(["recognition", "withdrawal", "cession", "statusQuo"]),
      endedDay: uint,
    }),
  ]);
  const military = z.object({ conscripts: uint, grainDemand: uint, grainDrawn: uint, grainTransport: uint });
  const current = political
    .safeExtend({
      borderDispute: dispute.nullable(),
      lastEconomy: politicalEconomy
        .extend({
          states: z.record(stateId, stateReport.extend({ conscripts: uint })),
          countries: z.record(countryId, politicsReport.extend({ military })),
        })
        .nullable(),
    })
    .refine((state) => {
      const conflict = state.borderDispute;
      if (
        state.lastEconomy &&
        Object.values(state.lastEconomy.countries).some(
          ({ military }) =>
            military.grainDemand !== military.conscripts * scenario.borderDispute.grainPerRecruit ||
            military.grainDrawn > Math.min(military.grainDemand, military.grainTransport),
        )
      )
        return false;
      if (conflict === null) return true;
      if (conflict.claimantId === conflict.defenderId) return false;
      if (conflict.phase === "resolved") {
        const owner = conflict.outcome === "cession" ? conflict.claimantId : conflict.defenderId;
        return (
          conflict.endedDay <= state.elapsedDays &&
          state.ownerByStateId[scenario.borderDispute.targetStateId] === owner
        );
      }
      const target = scenario.borderDispute.targetStateId;
      if (
        state.ownerByStateId[target] !== conflict.defenderId ||
        !scenario.states[target].neighbors.some((id) => state.ownerByStateId[id] === conflict.claimantId)
      )
        return false;
      if (conflict.phase === "war") {
        const { progress, lastChange } = conflict;
        return lastChange === null
          ? progress === 0
          : state.lastEconomy !== null && progress - lastChange >= 0 && progress - lastChange <= 100;
      }
      return true;
    }, "边境争端或军需数据无效");
  const scenarioId = z.literal(scenario.id);
  const parsed = z
    .discriminatedUnion("version", [
      z.object({ version: z.literal(1), scenarioId, state: legacy }),
      z.object({ version: z.literal(2), scenarioId, state: economic }),
      z.object({ version: z.literal(3), scenarioId, state: political }),
      z.object({ version: z.literal(4), scenarioId, state: current }),
    ])
    .safeParse(save);

  if (!parsed.success) {
    throw new Error("存档数据无效或版本不兼容", { cause: parsed.error });
  }

  const original = parsed.data.state;
  const base = createGame(world);
  delete base.diplomaticTies;
  base.elapsedDays = original.elapsedDays;
  base.playerCountryId = original.playerCountryId;
  Object.assign(base.ownerByStateId, original.ownerByStateId);
  for (const id of Object.keys(region.countries))
    base.countryEconomies[id] = { treasury: region.countries[id].treasury, queue: [] };
  if ("countryEconomies" in original) {
    Object.assign(base.countryEconomies, original.countryEconomies);
    for (const [id, local] of Object.entries(original.stateEconomies)) {
      const { cropland, buildings: { steel, arms, ammo } } = base.stateEconomies[id];
      const industrial = initialIndustrialAccount({ grain: 0, cloth: 0, steel, arms, ammo });
      base.stateEconomies[id] = {
        ...(cropland === undefined ? {} : { cropland }),
        ...(industrial === undefined ? {} : { industrial }),
        population: local.population,
        basicBudget: openingBasicBudget(local.population),
        buildings: { ...byGood((good) => isIndustrialGood(good) ? 0 : local.buildings[good]), steel, arms, ammo, cashCrops: 0 },
      };
      const site = base.societies[id],
        sum = site.pops.reduce((a, p) => a + p.people, 0);
      let remainder = local.population;
      site.pops.forEach((p, i) => {
        p.people = i === site.pops.length - 1 ? remainder : Math.floor((p.people * local.population) / sum);
        remainder -= p.people;
      });
    }
  }
  if ("countryPolitics" in original)
    for (const [id, p] of Object.entries(original.countryPolitics)) {
      const n = base.nations[id];
      if (p.reformWeeks === 2) n.laws = [...n.laws.filter((law) => !isTaxLaw(law)), "工资税改革"];
      else if (p.reformWeeks !== null) {
        n.reform = "工资税改革";
        n.reformProgress = p.reformWeeks;
        n.government = ["乡民", "实业家"];
      }
      if (p.researchWeeks !== null) {
        n.knowledge["纺织工艺"] = 25 * p.researchWeeks;
        n.research = p.researchWeeks < 4 ? "纺织工艺" : null;
      }
    }
  if ("borderDispute" in original && original.borderDispute) {
    const d = original.borderDispute;
    base.borderDispute = {
      claimantId: d.claimantId,
      defenderId: d.defenderId,
      targetStateId: region.borderDispute.targetStateId,
      phase: d.phase === "answered" ? "bargaining" : d.phase === "demanded" ? "escalation" : d.phase,
      since: d.phase === "resolved" ? d.endedDay : base.elapsedDays,
      goals: ["cession"],
      maneuvers: 2,
      allies: [],
      promises: [],
      defenders: [],
      mobilized: d.phase === "war" ? [d.claimantId, d.defenderId] : [],
      advance: d.phase === "war" ? [d.claimantId] : [],
      raid: [],
      progress: d.phase === "war" ? d.progress : 0,
      lastChange: d.phase === "war" ? d.lastChange : null,
      outcome:
        d.phase === "resolved"
          ? d.outcome === "cession"
            ? "victory"
            : d.outcome === "withdrawal"
              ? "withdrawal"
              : "statusQuo"
          : null,
    };
  }
  migrateCommercialProduction(base);
  for (const account of Object.values(base.countryEconomies)) {
    account.treasury += account.queue.reduce((sum, project) => sum + unusedPrepaidConstruction(project), 0);
  }
  return base;
}
