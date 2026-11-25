import { openDB } from "idb";
import type { DBSchema } from "idb";
import { z } from "zod";
import { disputeSchema, participants } from "./diplomacy.ts";
import { DAY_MS, TICKS_PER_DAY } from "./engine.ts";
import type { GameState } from "./engine.ts";
import { byGood, goods } from "./industry.ts";
import { projects } from "./economy.ts";
import { nationSchema, siteSocialSchema, projectTypes } from "./society.ts";
import { importRegionalSave } from "./legacySave.ts";
import { borderScenario } from "../scenario/scenario.ts";
import type { Scenario } from "../scenario/scenario.ts";
const storeName = "saves";
const slot = "local";
export const saveVersion = 6;

interface SaveDatabase extends DBSchema {
  saves: { key: typeof slot; value: unknown };
}

function openSaves() {
  return openDB<SaveDatabase>("wang-guo-shi-shi", 1, {
    upgrade(db) {
      db.createObjectStore(storeName);
    },
  });
}

export async function saveGame(scenario: Scenario, state: GameState): Promise<void> {
  const db = await openSaves();
  try {
    await db.put(storeName, { version: saveVersion, scenarioId: scenario.id, state }, slot);
  } finally {
    db.close();
  }
}

export async function loadGame(scenario: Scenario): Promise<GameState | undefined> {
  const db = await openSaves();
  try {
    const save = await db.get(storeName, slot);
    if (save === undefined) return;
    return parseSave(scenario, save);
  } finally {
    db.close();
  }
}

const uint = z.int().nonnegative(),
  cash = z.int(),
  fraction = z.number().min(0).max(1);
const goodsNumbers = z.object(byGood(() => uint));
const market = z.object({ demand: uint, supply: uint, price: z.int().positive() });
const industry = z.object({ employed: uint, output: uint, wages: uint });
const issue = z.object({ demand: uint, delivered: uint }).refine((i) => i.delivered <= i.demand);
const military = z.object({
  regulars: uint,
  conscripts: uint,
  grainDemand: uint,
  grainDrawn: uint,
  grainTransport: uint,
  equipment: z.object({ weapons: issue, ammunition: issue, uniforms: issue }),
  readiness: fraction,
});
const countryReport = z.object({
  market: z.object(byGood(() => market)),
  tax: uint,
  wageTaxRate: z.literal([10, 14]),
  wageTaxGain: uint,
  clothOutputBonus: z.literal([0, 25, 40]),
  clothOutputGain: uint,
  military,
  investment: uint,
  capacity: z.number().nonnegative(),
  tribute: uint,
  upkeep: uint,
});
const siteReport = z.object({
  industries: z.object(byGood(() => industry)),
  populationChange: cash,
  conscripts: uint,
  regulars: uint,
  builders: uint,
  armourers: uint,
  access: fraction,
  localPrices: goodsNumbers,
  dividends: uint,
  investment: uint,
});
export function parseSave(scenario: Scenario, save: unknown): GameState {
  const header = z.object({ version: z.int(), scenarioId: z.string() }).safeParse(save);
  if (!header.success) throw new Error("存档数据无效");
  if (header.data.version >= 1 && header.data.version <= 4) {
    const source =
      header.data.scenarioId === borderScenario.id && scenario.id === "world-1820"
        ? borderScenario
        : scenario;
    return importRegionalSave(source, scenario, save);
  }
  const sites = z.enum(Object.keys(scenario.states)),
    countries = z.enum(Object.keys(scenario.countries));
  // A valid map ID is optional until claimed; enum-keyed records require every ID.
  const activeSite = z.string().refine((id) => Object.hasOwn(scenario.states, id));
  const project = z.object({ stateId: sites, good: z.enum(projectTypes), weeksLeft: z.number().positive() });
  const stateSchema = z.object({
    elapsedDays: uint.max(Math.floor((8.64e15 - Date.parse(scenario.startDate)) / DAY_MS)),
    playerCountryId: countries,
    rng: uint.max(0xffffffff),
    ownerByStateId: z.record(activeSite, countries),
    stateEconomies: z.record(
      activeSite,
      z.object({ population: z.int().positive(), buildings: goodsNumbers }),
    ),
    countryEconomies: z.record(countries, z.object({ treasury: cash, queue: z.array(project) })),
    societies: z.record(activeSite, siteSocialSchema),
    nations: z.record(countries, nationSchema),
    borderDispute: disputeSchema.nullable(),
    lastEconomy: z
      .object({ states: z.record(activeSite, siteReport), countries: z.record(countries, countryReport) })
      .nullable(),
  });
  const scenarioId = z.literal(scenario.id);
  const schema = z
    .discriminatedUnion("version", [
      z.object({ version: z.literal(5), scenarioId, state: stateSchema }),
      z.object({
        version: z.literal(saveVersion),
        scenarioId,
        state: stateSchema.extend({ tickInDay: uint.max(TICKS_PER_DAY - 1) }),
      }),
    ])
    .safeParse(save);
  if (!schema.success) throw new Error("存档数据无效或版本不兼容", { cause: schema.error });
  const state = schema.data.version === 5 ? { ...schema.data.state, tickInDay: 0 } : schema.data.state;
  function invalid(): never {
    throw new Error("存档中的人口、工程、外交或归属数据无效");
  }
  const owned = Object.keys(state.ownerByStateId);
  const sameSites = (record: object) =>
    Object.keys(record).length === owned.length && owned.every((id) => Object.hasOwn(record, id));
  if (
    !sameSites(state.stateEconomies) ||
    !sameSites(state.societies) ||
    (state.lastEconomy !== null && !sameSites(state.lastEconomy.states)) ||
    Object.values(scenario.states).some((s) => s.ownerId !== null && !Object.hasOwn(state.ownerByStateId, s.id))
  ) invalid();
  for (const [id, n] of Object.entries(state.nations)) {
    if (
      (n.marketLeader &&
        (!state.nations[n.marketLeader] ||
          n.marketLeader === id ||
          state.nations[n.marketLeader].marketLeader)) ||
      (n.overlord && n.overlord !== n.marketLeader) ||
      n.interests.some((s) => !scenario.states[s])
    )
      invalid();
    if (Boolean(n.overlord) !== Boolean(n.subjectType)) invalid();
    const queued = [...state.countryEconomies[id].queue, ...n.privateQueue];
    for (const p of queued)
      if (state.ownerByStateId[p.stateId] !== id || p.weeksLeft > projects[p.good].weeks) invalid();
    if (state.lastEconomy) {
      const m = state.lastEconomy.countries[id].military;
      if (m.grainDrawn > Math.min(m.grainDemand, m.grainTransport)) invalid();
    }
  }
  for (const [id, local] of Object.entries(state.stateEconomies)) {
    const owner = state.ownerByStateId[id],
      pops = state.societies[id].pops;
    if (pops.reduce((sum, p) => sum + p.people, 0) !== local.population) invalid();
    for (const p of pops) {
      if (
        (p.occupation === "劳工" &&
          !pops.some((e) => e.occupation === "工程师" && e.culture === p.culture)) ||
        (p.occupation === "农民" && !pops.some((e) => e.occupation === "劳工" && e.culture === p.culture))
      )
        invalid();
    }
    const queue = [...state.countryEconomies[owner].queue, ...state.nations[owner].privateQueue];
    for (const g of goods)
      if (
        local.buildings[g] + queue.filter((p) => p.stateId === id && p.good === g).length >
        scenario.states[id].capacity[g]
      )
        invalid();
  }
  const d = state.borderDispute;
  if (d) {
    const parties = participants(d);
    if (
      !scenario.states[d.targetStateId] ||
      parties.some((id) => !state.nations[id]) ||
      new Set(parties).size !== parties.length ||
      d.since > state.elapsedDays ||
      [...d.advance, ...d.mobilized, ...d.raid].some((id) => !parties.includes(id)) ||
      d.promises.some((id) => !d.allies.includes(id))
    )
      invalid();
    const transferred = d.outcome === "victory" && (d.goals.includes("cession") || d.goals.includes("annex"));
    if (state.ownerByStateId[d.targetStateId] !== (transferred ? d.claimantId : d.defenderId)) invalid();
  }
  return state;
}
