import { z } from "zod";
import type { ByGood } from "../game/industry.ts";
import type { DiplomaticTie } from "../game/diplomatic-ties.ts";
import gameData from "../../resources/1820_game_data.json" with { type: "json" };
import demoData from "./qing-vietnam.json" with { type: "json" };

import stateNames from "./state-names.zh.json" with { type: "json" };
import worldData from "./world-states.json" with { type: "json" };

export interface Country {
  id: string;
  name: string;
  color: string;
  treasury: number;
  selectable?: false;
}

interface ScenarioState {
  id: string;
  name: string;
  label: [number, number];
  ownerId: string | null;
  population: number;
  neighbors: string[];
  terrain?: "平原" | "森林" | "山地";
  coastal?: boolean;
  grainTransport: number;
  capacity: ByGood<number>;
  buildings: ByGood<number>;
}

export interface Scenario {
  id: string;
  name: string;
  startDate: string;
  endDate?: string;
  countries: Record<string, Country>;
  states: Record<string, ScenarioState>;
  borderDispute: z.infer<typeof borderDispute>;
  diplomaticTies?: readonly DiplomaticTie[];
}

const counts = z.object({ grain: z.int().nonnegative(), cloth: z.int().nonnegative() });
const borderDispute = z.object({
  targetStateId: z.string(),
  compromiseBorders: z.int().positive(),
  recruitPercent: z.int().min(1).max(100),
  supplyPercent: z.int().min(1).max(100),
  grainPerRecruit: z.int().positive(),
  strengthPerPoint: z.int().positive(),
  cessionProgress: z.int().min(1).max(100),
});
const demo = z
  .object({
    id: z.string(),
    name: z.string(),
    startDate: z.iso.date(),
    borderDispute,
    countries: z.array(z.object({ id: z.string(), treasury: z.int().nonnegative() })).nonempty(),
    states: z.array(
      z
        .object({
          id: z.string(),
          name: z.string(),
          label: z.tuple([z.number(), z.number()]),
          population: z.int().positive(),
          neighbors: z.array(z.string()).nonempty(),
          grainTransport: z.int().positive(),
          capacity: counts,
          buildings: counts,
        })
        .refine(
          ({ buildings, capacity }) => buildings.grain <= capacity.grain && buildings.cloth <= capacity.cloth,
        ),
    ),
  })
  .refine(({ states, borderDispute }) => {
    const byId = new Map(states.map((state) => [state.id, state]));
    return (
      byId.size === states.length &&
      byId.has(borderDispute.targetStateId) &&
      states.every(
        ({ id, neighbors }) =>
          new Set(neighbors).size === neighbors.length &&
          neighbors.every((neighbor) => neighbor !== id && byId.get(neighbor)?.neighbors.includes(id)),
      )
    );
  }, "争端州或剧本邻接无效")
  .parse(demoData);

const countryId = z.enum(demo.countries.map(({ id }) => id));
const countrySchema = z.object({
  id: countryId,
  name: z.string(),
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
});
const stateOwnerSchema = z.object({ countryId });
const sourceCountries = new Map(gameData.countries.map((country) => [country.id, country]));
const sourceStates = new Map(Object.entries(gameData.states));

export const borderScenario: Scenario = {
  id: demo.id,
  name: demo.name,
  startDate: demo.startDate,
  borderDispute: demo.borderDispute,
  countries: Object.fromEntries(
    demo.countries.map(({ id, treasury }) => [
      id,
      { ...countrySchema.parse(sourceCountries.get(id)), treasury },
    ]),
  ),
  states: Object.fromEntries(
    demo.states.map((state) => [
      state.id,
      { ...state, ownerId: stateOwnerSchema.parse(sourceStates.get(state.id)).countryId },
    ]),
  ),
};

const siteSchema = z.object({
  name: z.string(),
  label: z.tuple([z.number(), z.number()]),
  neighbors: z.array(z.string()),
  grainTransport: z.int().positive(),
  buildings: counts,
  capacity: counts,
  population: z.int().positive(),
  terrain: z.enum(["平原", "森林", "山地"]),
  coastal: z.boolean(),
});
export const atlas = z.record(z.string(), siteSchema).parse(
  Object.fromEntries(Object.entries(worldData).map(([id, state]) => [
    id, { ...state, name: (stateNames as Record<string, string>)[id] },
  ])),
);
const countries = z
  .array(countrySchema.extend({ id: z.string(), stateCount: z.int().positive() }))
  .parse(gameData.countries);
const countryIds = new Set(countries.map((c) => c.id));
const backgroundIds = new Set(["country_17", "country_23", "country_27"]);
if (
  countryIds.size !== countries.length ||
  Object.keys(gameData.states).some((id) => !Object.hasOwn(atlas, id)) ||
  !Object.entries(atlas).every(
    ([id, site]) =>
      site.neighbors.every((other) => other !== id && atlas[other]?.neighbors.includes(id)) &&
      site.buildings.grain <= site.capacity.grain &&
      site.buildings.cloth <= site.capacity.cloth,
  )
) {
  throw new Error("世界剧本的国家、邻接或容量数据无效");
}
export const scenario: Scenario = {
  id: "world-1820",
  name: "1820 世界剧本",
  diplomaticTies: [
    { kind: "investiture", senior: "country_01", partner: "country_26" },
    { kind: "investiture", senior: "country_01", partner: "country_28" },
    { kind: "tributeTrade", senior: "country_01", partner: "country_25" },
    { kind: "personalUnion", senior: "country_02", partner: "country_14" },
  ],
  startDate: demo.startDate,
  endDate: "1823-01-01",
  borderDispute: demo.borderDispute,
  countries: Object.fromEntries(
    countries.map(({ id, name, color, stateCount }) => [
      id,
      {
        id,
        name,
        color,
        treasury: 600_000 + stateCount * 150_000,
        ...(backgroundIds.has(id) ? { selectable: false as const } : {}),
      },
    ]),
  ),
  states: Object.fromEntries(
    Object.entries(atlas).map(([id, site]) => {
      const source = sourceStates.get(id);
      if (source && !countryIds.has(source.countryId)) throw new Error("州归属无效：" + id);
      return [id, { ...site, id, ownerId: source ? source.countryId : null }];
    }),
  ),
};
