import { z } from "zod";
import type { Scenario } from "../scenario/scenario.ts";
import { culturalAffinityOf, cultureShares } from "./culture.ts";
import { attacking, participants } from "./diplomacy.ts";
import type { GameState } from "./engine.ts";
import { byGood, goods, industries, isLocalGood } from "./industry.ts";
import type { ByGood } from "./industry.ts";
import type { MarketFill } from "./market.ts";
import { marketOf } from "./market.ts";
import { GameRuleError } from "./rules.ts";
import { connectedRailway, portCapacity, seaVoyageCargoCost } from "./transport.ts";
import { effectiveConvoyCapacity } from "./fleet.ts";
import { unrestEffects } from "./unrest.ts";
import { tariffRate, tradeRestriction } from "./trade-policy.ts";

const units = z.int().nonnegative();
export const tradeLimit = z.int().positive().max(100_000);
export const tradeModes = ["land", "sea"] as const;
export type TradeMode = (typeof tradeModes)[number];
const tradeEndpoint = {
  from: z.string(),
  to: z.string(),
  good: z.enum(goods),
  mode: z.enum(tradeModes).default("land"),
};
export const tradeRouteSchema = z.object({
  ...tradeEndpoint,
  exporter: z.string(),
  importer: z.string(),
  limit: tradeLimit,
  paused: z.boolean(),
  fromCapacity: units.positive(),
  toCapacity: units.positive(),
  cargoCost: units.positive().default(1),
});
export type TradeRoute = z.infer<typeof tradeRouteSchema>;
type RouteSelection = Pick<TradeRoute, "from" | "to" | "good"> & { mode?: TradeMode };
export type TradeCommand = { countryId: string } & RouteSelection & (
  | { type: "openTradeRoute"; limit: number }
  | { type: "setTradeRoute"; limit: number; paused: boolean }
  | { type: "removeTradeRoute" }
);

export const tradeStatuses = {
  shipped: "已发货",
  paused: "已暂停",
  sovereignty: "归属已变更",
  occupied: "口岸被占领",
  war: "两国交战",
  blockaded: "口岸受封锁",
  commonMarket: "同一关税市场",
  importPolicy: "进口国未授予通商许可",
  exportPolicy: "出口国未授予通商许可",
  noVolume: "暂无可运货量",
  unprofitable: "价差无法覆盖运费和关税",
} as const;
export const tradeDeliverySchema = z.object({
  ...tradeEndpoint,
  status: z.enum(["shipped", "paused", "sovereignty", "occupied", "war", "blockaded", "commonMarket",
    "importPolicy", "exportPolicy", "noVolume", "unprofitable"]),
  quantity: units,
  purchase: units,
  freight: units,
  tariff: units,
  sales: units,
  profit: units,
}).refine((row) => row.sales === row.purchase + row.freight + row.tariff + row.profit &&
  (row.status === "shipped" ? row.quantity > 0 : row.quantity === 0 && row.sales === 0));
export type TradeDelivery = z.infer<typeof tradeDeliverySchema>;

export const tradeRouteKey = ({ from, to, good, mode = "land" }: RouteSelection) =>
  JSON.stringify([from, to, good, mode]);

export function routeTransport(scenario: Scenario, from: string, to: string, mode: TradeMode) {
  if (from === to || !Object.hasOwn(scenario.states, from) || !Object.hasOwn(scenario.states, to)) return;
  const source = scenario.states[from], target = scenario.states[to];
  if (mode === "land" ? !target.neighbors.includes(from) : !(source.coastal && target.coastal)) return;
  return {
    fromCapacity: source.grainTransport,
    toCapacity: target.grainTransport,
    cargoCost: mode === "sea" ? seaVoyageCargoCost(source.label, target.label) : 1,
  };
}

export function foreignTradeStatus(state: GameState, exporter: string, importer: string) {
  const dispute = state.borderDispute;
  if (dispute?.phase === "war") {
    const fighters = participants(dispute);
    if (fighters.includes(exporter) && fighters.includes(importer) && attacking(dispute, exporter) !== attacking(dispute, importer))
      return "war";
  }
  return tradeRestriction(state, exporter, importer);
}

export function tradeRouteBlock(state: GameState, route: TradeRoute) {
  const { from, to, exporter, importer } = route;
  if (route.paused) return "paused";
  if (state.ownerByStateId[from] !== exporter || state.ownerByStateId[to] !== importer) return "sovereignty";
  if (state.occupation?.stateId === from || state.occupation?.stateId === to) return "occupied";
  if (marketOf(state, exporter) === marketOf(state, importer)) return "commonMarket";
  return foreignTradeStatus(state, exporter, importer);
}

export function applyTradeCommand(scenario: Scenario, state: GameState, cmd: TradeCommand): GameState {
  if (isLocalGood(cmd.good)) throw new GameRuleError(`${cmd.good === "services" ? "服务" : industries[cmd.good].goodName}只能在本州成交`);
  const routes = state.tradeRoutes ?? [];
  const key = tradeRouteKey(cmd);
  const route = routes.find((candidate) => tradeRouteKey(candidate) === key);
  if (cmd.type === "openTradeRoute") {
    const { from, to, good, limit, mode = "land", countryId: importer } = cmd;
    const capacity = routeTransport(scenario, from, to, mode);
    const exporter = state.ownerByStateId[cmd.from];
    if (state.ownerByStateId[to] !== importer || !Object.hasOwn(state.ownerByStateId, from) || !capacity)
      throw new GameRuleError(mode === "sea" ? "请选择本国沿海进口州与沿海外国出口州" : "请选择本国进口州与接壤的出口州");
    if (marketOf(state, exporter) === marketOf(state, importer))
      throw new GameRuleError("贸易连接不同关税市场");
    if (state.occupation?.stateId === from || state.occupation?.stateId === to)
      throw new GameRuleError(tradeStatuses.occupied);
    const restriction = foreignTradeStatus(state, exporter, importer);
    if (restriction) throw new GameRuleError(tradeStatuses[restriction]);
    if (route?.exporter === exporter && route.importer === cmd.countryId)
      throw new GameRuleError("该商品的线路已存在");
    if (!tradeLimit.safeParse(limit).success) throw new GameRuleError("周运量上限应为 1–100000");
    const remaining = route ? routes.filter((candidate) => candidate !== route) : routes;
    return { ...state, tradeRoutes: [...remaining, { from, to, good, mode, limit, importer, exporter, paused: false, ...capacity }] };
  }
  if (!route || route.importer !== cmd.countryId) throw new GameRuleError("只能管理本国设立的进口线路");
  if (cmd.type === "removeTradeRoute")
    return { ...state, tradeRoutes: routes.filter((candidate) => candidate !== route) };
  if (!tradeLimit.safeParse(cmd.limit).success) throw new GameRuleError("周运量上限应为 1–100000");
  return {
    ...state,
    tradeRoutes: routes.map((candidate) => candidate === route ? { ...route, limit: cmd.limit, paused: cmd.paused } : candidate),
  };
}

export function expectedTrade(state: GameState) {
  const sites = new Map<string, ByGood<{ incoming: number; outgoing: number }>>();
  const markets = new Map<string, ByGood<{ incoming: number; outgoing: number }>>();
  const delivered = state.lastEconomy?.trade;
  if (!delivered?.length || !state.tradeRoutes?.length) return { sites, markets };
  const active = new Map(state.tradeRoutes.filter((route) => !tradeRouteBlock(state, route))
    .map((route) => [tradeRouteKey(route), route]));
  function add(book: typeof sites, id: string, good: TradeRoute["good"], side: "incoming" | "outgoing", quantity: number) {
    const quantities = book.get(id) ?? byGood(() => ({ incoming: 0, outgoing: 0 }));
    quantities[good][side] += quantity;
    book.set(id, quantities);
  }
  for (const shipment of delivered) {
    if (!shipment.quantity) continue;
    const route = active.get(tradeRouteKey(shipment));
    if (!route) continue;
    const fromMarket = marketOf(state, route.exporter), toMarket = marketOf(state, route.importer);
    const quantity = Math.min(shipment.quantity, route.limit);
    add(sites, route.from, route.good, "outgoing", quantity);
    add(sites, route.to, route.good, "incoming", quantity);
    add(markets, fromMarket, route.good, "outgoing", quantity);
    add(markets, toMarket, route.good, "incoming", quantity);
  }
  return { sites, markets };
}

type Orders = Record<string, ByGood<number>>;
export function settleTrade(
  state: GameState,
  supplies: Orders,
  demands: Orders,
  sites: Record<string, { localPrices: ByGood<number> }>,
  fills: ByGood<Record<string, MarketFill>>,
  militaryCargo: ReadonlyMap<string, number>,
  blockadedPorts: ReadonlySet<string>,
  militaryPortUse: ReadonlyMap<string, number>,
) {
  const transfers = new Map<string, {
    sent: ByGood<number>; received: ByGood<number>; producerPayment: ByGood<number>;
    freight: number; profit: number; tariff: number;
  }>();
  function at(stateId: string) {
    let transfer = transfers.get(stateId);
    if (!transfer) {
      transfer = { sent: byGood(() => 0), received: byGood(() => 0), producerPayment: byGood(() => 0),
        freight: 0, profit: 0, tariff: 0 };
      transfers.set(stateId, transfer);
    }
    return transfer;
  }
  const roadUse = new Map<string, number>();
  const railUse = new Map<string, number>();
  const seaCargo = new Map<string, number>();
  const portFreight = new Map<string, number>();
  const deliveries = (state.tradeRoutes ?? []).map((route): TradeDelivery => {
    const { from, to, importer, good, mode, cargoCost } = route;
    const empty = { from, to, good, mode, quantity: 0, purchase: 0, freight: 0, tariff: 0, sales: 0, profit: 0 };
    const restriction = tradeRouteBlock(state, route);
    if (restriction) return { ...empty, status: restriction };
    if (mode === "sea" && (blockadedPorts.has(from) || blockadedPorts.has(to)))
      return { ...empty, status: "blockaded" };
    const source = at(from), target = at(to);
    const sourceSite = state.societies[from], targetSite = state.societies[to];
    const sourceTransport = unrestEffects(sourceSite.stability).transport;
    const targetTransport = unrestEffects(targetSite.stability).transport;
    const roadFrom = roadUse.get(from) ?? 0, roadTo = roadUse.get(to) ?? 0;
    const roadSpace = Math.max(0, Math.min(
      Math.floor(route.fromCapacity * sourceSite.infrastructure * sourceTransport) - roadFrom,
      Math.floor(route.toCapacity * targetSite.infrastructure * targetTransport) - roadTo,
    ));
    const railFrom = railUse.get(from) ?? 0, railTo = railUse.get(to) ?? 0;
    const rail = mode === "land" ? connectedRailway(sourceSite.railway, targetSite.railway) : 0;
    const railSpace = Math.max(0, Math.min(
      Math.floor(route.fromCapacity * rail * sourceTransport) - railFrom,
      Math.floor(route.toCapacity * rail * targetTransport) - railTo,
    ));
    const usedAtSea = seaCargo.get(importer) ?? 0;
    const spaceAtSea = effectiveConvoyCapacity(state.nations[importer]) - (militaryCargo.get(importer) ?? 0) - usedAtSea;
    const freightFrom = portFreight.get(from) ?? 0, freightTo = portFreight.get(to) ?? 0;
    const transport = mode === "sea" ? Math.min(
      portCapacity(route.fromCapacity, sourceSite) - (militaryPortUse.get(from) ?? 0) - freightFrom,
      portCapacity(route.toCapacity, targetSite) - (militaryPortUse.get(to) ?? 0) - freightTo,
      Math.floor(spaceAtSea / cargoCost),
    ) : roadSpace + railSpace;
    const quantity = Math.min(
      route.limit, transport,
      supplies[from][good] - fills[good][from].local - fills[good][from].poolSold - source.sent[good],
      demands[to][good] - fills[good][to].local - fills[good][to].poolBought - target.received[good],
    );
    if (quantity <= 0) return { ...empty, status: "noVolume" };
    const ask = sites[from].localPrices[good], bid = sites[to].localPrices[good];
    const affinity = culturalAffinityOf(targetSite);
    let familiarity = 0;
    for (const [culture, share] of cultureShares(sourceSite.pops))
      if (Object.hasOwn(affinity, culture)) familiarity += affinity[culture] * share;
    const purchase = ask * quantity, sales = bid * quantity;
    const standardFreight = Math.ceil(purchase * 0.05 * cargoCost);
    const freight = standardFreight - Math.floor(standardFreight * familiarity / 1000);
    const tariff = Math.floor(purchase * tariffRate(state.nations[importer]) / 100);
    const profit = sales - purchase - freight - tariff;
    if (profit <= 0) return { ...empty, status: "unprofitable" };
    if (mode === "sea") {
      seaCargo.set(importer, usedAtSea + quantity * cargoCost);
      portFreight.set(from, freightFrom + quantity);
      portFreight.set(to, freightTo + quantity);
    } else {
      const shippedByRail = Math.min(quantity, railSpace);
      roadUse.set(from, roadFrom + quantity - shippedByRail);
      roadUse.set(to, roadTo + quantity - shippedByRail);
      if (shippedByRail > 0) {
        railUse.set(from, railFrom + shippedByRail);
        railUse.set(to, railTo + shippedByRail);
      }
    }
    source.sent[good] += quantity;
    target.received[good] += quantity;
    source.producerPayment[good] += purchase;
    target.freight += freight;
    target.profit += profit;
    target.tariff += tariff;
    return { from, to, good, mode, quantity, status: "shipped", purchase, freight, tariff, sales, profit };
  });
  return { transfers, deliveries, seaCargo, portFreight };
}
