import { z } from "zod";
import type { Scenario } from "../scenario/scenario.ts";
import { culturalAffinityOf, cultureShares } from "./culture.ts";
import { attacking, participants } from "./diplomacy.ts";
import type { GameState } from "./engine.ts";
import { byGood, goods } from "./industry.ts";
import type { ByGood, Good } from "./industry.ts";
import type { MarketFill } from "./market.ts";
import { marketOf } from "./market.ts";
import { GameRuleError } from "./rules.ts";

const units = z.int().nonnegative();
export const tradeLimit = z.int().positive().max(100_000);
export const tradeRouteSchema = z.object({
  from: z.string(),
  to: z.string(),
  exporter: z.string(),
  importer: z.string(),
  good: z.enum(goods),
  limit: tradeLimit,
  paused: z.boolean(),
  fromCapacity: units.positive(),
  toCapacity: units.positive(),
});
export type TradeRoute = z.infer<typeof tradeRouteSchema>;
export type TradeCommand =
  | { type: "openTradeRoute"; countryId: string; from: string; to: string; good: Good; limit: number }
  | { type: "setTradeRoute"; countryId: string; from: string; to: string; good: Good; limit: number; paused: boolean }
  | { type: "removeTradeRoute"; countryId: string; from: string; to: string; good: Good };

export const tradeStatuses = {
  shipped: "已发货",
  paused: "已暂停",
  sovereignty: "归属已变更",
  occupied: "口岸被占领",
  war: "两国交战",
  commonMarket: "同一关税市场",
  noVolume: "暂无可运货量",
  unprofitable: "价差无法覆盖运费和关税",
} as const;
export const tradeDeliverySchema = z.object({
  from: z.string(),
  to: z.string(),
  good: z.enum(goods),
  status: z.enum(["shipped", "paused", "sovereignty", "occupied", "war", "commonMarket", "noVolume", "unprofitable"]),
  quantity: units,
  purchase: units,
  freight: units,
  tariff: units,
  sales: units,
  profit: units,
}).refine((row) => row.sales === row.purchase + row.freight + row.tariff + row.profit &&
  (row.status === "shipped" ? row.quantity > 0 : row.quantity === 0 && row.sales === 0));
export type TradeDelivery = z.infer<typeof tradeDeliverySchema>;

export const tradeRouteKey = ({ from, to, good }: Pick<TradeRoute, "from" | "to" | "good">) =>
  JSON.stringify([from, to, good]);

export function landRouteCapacity(scenario: Scenario, from: string, to: string) {
  if (!Object.hasOwn(scenario.states, from) || !Object.hasOwn(scenario.states, to) ||
      !scenario.states[to].neighbors.includes(from)) return;
  return { fromCapacity: scenario.states[from].grainTransport, toCapacity: scenario.states[to].grainTransport };
}

export function applyTradeCommand(scenario: Scenario, state: GameState, cmd: TradeCommand): GameState {
  const routes = state.tradeRoutes ?? [];
  const key = tradeRouteKey(cmd);
  const route = routes.find((candidate) => tradeRouteKey(candidate) === key);
  if (cmd.type === "openTradeRoute") {
    const capacity = landRouteCapacity(scenario, cmd.from, cmd.to);
    const exporter = state.ownerByStateId[cmd.from];
    if (state.ownerByStateId[cmd.to] !== cmd.countryId || !Object.hasOwn(state.ownerByStateId, cmd.from) || !capacity)
      throw new GameRuleError("请选择本国进口州与接壤的出口州");
    if (marketOf(state, exporter) === marketOf(state, cmd.countryId))
      throw new GameRuleError("陆路贸易连接不同关税市场");
    if (route?.exporter === exporter && route.importer === cmd.countryId)
      throw new GameRuleError("该商品的陆路线路已存在");
    if (!tradeLimit.safeParse(cmd.limit).success) throw new GameRuleError("周运量上限应为 1–100000");
    const { from, to, good, limit, countryId: importer } = cmd;
    const remaining = route ? routes.filter((candidate) => candidate !== route) : routes;
    return { ...state, tradeRoutes: [...remaining, { from, to, good, limit, importer, exporter, paused: false, ...capacity }] };
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

type Orders = Record<string, ByGood<number>>;
export function settleLandTrade(
  state: GameState,
  supplies: Orders,
  demands: Orders,
  sites: Record<string, { localPrices: ByGood<number> }>,
  fills: ByGood<Record<string, MarketFill>>,
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
  const use = new Map<string, number>();
  const dispute = state.borderDispute;
  const fighters = dispute?.phase === "war" ? new Set(participants(dispute)) : new Set<string>();
  const deliveries = (state.tradeRoutes ?? []).map((route): TradeDelivery => {
    const { from, to, importer, exporter, good } = route;
    const empty = { from, to, good, quantity: 0, purchase: 0, freight: 0, tariff: 0, sales: 0, profit: 0 };
    if (route.paused) return { ...empty, status: "paused" };
    if (state.ownerByStateId[from] !== exporter || state.ownerByStateId[to] !== importer)
      return { ...empty, status: "sovereignty" };
    if (state.occupation?.stateId === from || state.occupation?.stateId === to)
      return { ...empty, status: "occupied" };
    if (dispute?.phase === "war" && fighters.has(importer) && fighters.has(exporter) &&
        attacking(dispute, importer) !== attacking(dispute, exporter))
      return { ...empty, status: "war" };
    const exportingMarket = marketOf(state, exporter), importingMarket = marketOf(state, importer);
    if (exportingMarket === importingMarket) return { ...empty, status: "commonMarket" };
    const source = at(from), target = at(to);
    const sourceCapacity = route.fromCapacity * state.societies[from].infrastructure;
    const targetCapacity = route.toCapacity * state.societies[to].infrastructure;
    const shippedFrom = use.get(from) ?? 0, shippedTo = use.get(to) ?? 0;
    const quantity = Math.min(
      route.limit, sourceCapacity - shippedFrom, targetCapacity - shippedTo,
      supplies[from][good] - fills[good][from].local - fills[good][from].poolSold - source.sent[good],
      demands[to][good] - fills[good][to].local - fills[good][to].poolBought - target.received[good],
    );
    if (quantity <= 0) return { ...empty, status: "noVolume" };
    const ask = sites[from].localPrices[good], bid = sites[to].localPrices[good];
    const affinity = culturalAffinityOf(state.societies[to]);
    let familiarity = 0;
    for (const [culture, share] of cultureShares(state.societies[from].pops))
      if (Object.hasOwn(affinity, culture)) familiarity += affinity[culture] * share;
    const purchase = ask * quantity, sales = bid * quantity;
    const standardFreight = Math.ceil(purchase * 0.05);
    const freight = standardFreight - Math.floor(standardFreight * familiarity / 1000);
    const tariff = Math.floor(purchase * 0.10);
    const profit = sales - purchase - freight - tariff;
    if (profit <= 0) return { ...empty, status: "unprofitable" };
    use.set(from, shippedFrom + quantity);
    use.set(to, shippedTo + quantity);
    source.sent[good] += quantity;
    target.received[good] += quantity;
    source.producerPayment[good] += purchase;
    target.freight += freight;
    target.profit += profit;
    target.tariff += tariff;
    return { from, to, good, quantity, status: "shipped", purchase, freight, tariff, sales, profit };
  });
  return { transfers, deliveries };
}
