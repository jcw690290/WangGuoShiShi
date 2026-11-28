import { currentDisputes, occupationAt } from "./conflict-state.ts";
import { z } from "zod";
import type { Scenario } from "../scenario/scenario.ts";
import { culturalAffinityOf, cultureShares } from "./culture.ts";
import { attacking, participants } from "./diplomacy.ts";
import type { EconomyReport } from "./economy.ts";
import type { GameState } from "./engine.ts";
import { byGood, goods, industries, isLocalGood, tradableGoods } from "./industry.ts";
import type { ByGood, Good } from "./industry.ts";
import type { MarketFill } from "./market.ts";
import { marketOf } from "./market.ts";
import { GameRuleError } from "./rules.ts";
import { connectedRailway, portCapacity, seaVoyageCargoCost } from "./transport.ts";
import { effectiveConvoyCapacity } from "./fleet.ts";
import { unrestEffects } from "./unrest.ts";
import { tariffRate, tradeRestriction } from "./trade-policy.ts";
import { opiumCommerceAllowed, opiumLaw } from "./opium.ts";
import type { OpiumSmuggling } from "./opium.ts";

const units = z.int().nonnegative();
const maxTradeLimit = 100_000;
export const tradeLimit = z.int().positive().max(maxTradeLimit);
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
  opiumPolicy: "鸦片禁令限制合法贸易",
  noVolume: "暂无可运货量",
  unprofitable: "价差无法覆盖运费和关税",
} as const;
export const tradeDeliverySchema = z.object({
  ...tradeEndpoint,
  status: z.enum(["shipped", "paused", "sovereignty", "occupied", "war", "blockaded", "commonMarket",
    "importPolicy", "exportPolicy", "opiumPolicy", "noVolume", "unprofitable"]),
  quantity: units,
  purchase: units,
  freight: units,
  tariff: units,
  sales: units,
  profit: units,
  seaCargo: z.object({ required: units.positive(), delivered: units }).optional(),
}).refine((row) => row.sales === row.purchase + row.freight + row.tariff + row.profit &&
  (row.status === "shipped" ? row.quantity > 0 : row.quantity === 0 && row.sales === 0) &&
  (!row.seaCargo || (row.mode === "sea" && row.seaCargo.delivered <= row.seaCargo.required &&
    (row.status === "shipped" ? row.seaCargo.delivered >= row.quantity : row.seaCargo.delivered === 0))));
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

export function foreignTradeStatus(state: GameState, exporter: string, importer: string, good?: TradeRoute["good"]) {
  for (const dispute of currentDisputes(state)) {
    if (dispute.phase !== "war") continue;
    const fighters = participants(dispute);
    if (fighters.includes(exporter) && fighters.includes(importer) && attacking(dispute, exporter) !== attacking(dispute, importer))
      return "war";
  }
  if (good === "opium" && (!opiumCommerceAllowed(state.nations[exporter].laws) || !opiumCommerceAllowed(state.nations[importer].laws)))
    return "opiumPolicy";
  return tradeRestriction(state, exporter, importer);
}

export function tradeRouteBlock(state: GameState, route: TradeRoute) {
  const { from, to, exporter, importer } = route;
  if (route.paused) return "paused";
  if (state.ownerByStateId[from] !== exporter || state.ownerByStateId[to] !== importer) return "sovereignty";
  if (!!occupationAt(state, from) || !!occupationAt(state, to)) return "occupied";
  if (marketOf(state, exporter) === marketOf(state, importer)) return "commonMarket";
  return foreignTradeStatus(state, exporter, importer, route.good);
}

export function illicitOpiumEligible(state: GameState, route: TradeRoute) {
  const { from, to, exporter, importer } = route;
  return route.good === "opium" && !route.paused &&
    state.ownerByStateId[from] === exporter && state.ownerByStateId[to] === importer &&
    !occupationAt(state, from) && !occupationAt(state, to) &&
    marketOf(state, exporter) !== marketOf(state, importer) && !foreignTradeStatus(state, exporter, importer) &&
    opiumCommerceAllowed(state.nations[exporter].laws) && opiumLaw(state.nations[importer].laws) !== "鸦片许可经营";
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
    if (!!occupationAt(state, from) || !!occupationAt(state, to))
      throw new GameRuleError(tradeStatuses.occupied);
    const restriction = foreignTradeStatus(state, exporter, importer, good);
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
type NavalTradeRestrictions = { portAccess: ReadonlyMap<string, number>; blockadedPorts: ReadonlySet<string> };

function tradeAmounts(state: GameState, route: TradeRoute, quantity: number, ask: number, bid: number) {
  const affinity = culturalAffinityOf(state.societies[route.to]);
  let familiarity = 0;
  for (const [culture, share] of cultureShares(state.societies[route.from].pops))
    if (Object.hasOwn(affinity, culture)) familiarity += affinity[culture] * share;
  const purchase = ask * quantity, sales = bid * quantity;
  const standardFreight = Math.ceil(purchase * 0.05 * route.cargoCost);
  const freight = standardFreight - Math.floor(standardFreight * familiarity / 1000);
  const tariff = Math.floor(purchase * tariffRate(state.nations[route.importer]) / 100);
  return { purchase, sales, freight, tariff, profit: sales - purchase - freight - tariff };
}

export function chooseAITradeRoutes(scenario: Scenario, state: GameState, report: EconomyReport,
  humanCountries: ReadonlySet<string | null>, naval?: NavalTradeRestrictions) {
  const owned = Object.keys(state.ownerByStateId);
  const coastal = owned.filter((id) => scenario.states[id].coastal && !naval?.blockadedPorts.has(id));
  const portsByGood = byGood((good) => coastal.filter((id) => report.states[id].industries[good].unsold)
    .sort((a, b) => report.states[a].localPrices[good] - report.states[b].localPrices[good]));
  const existing = new Map((state.tradeRoutes ?? []).map((route) => [tradeRouteKey(route), route]));
  const landUse = new Map<string, number>();
  const existingRoom = new Set<string>();
  for (const row of report.trade ?? []) {
    if (row.status !== "shipped") continue;
    const route = existing.get(tradeRouteKey(row));
    if (!route || tradeRouteBlock(state, route)) continue;
    if (row.quantity < route.limit) existingRoom.add(JSON.stringify([route.importer, row.good]));
    if (row.mode === "land") {
      for (const site of [row.from, row.to]) landUse.set(site, (landUse.get(site) ?? 0) + row.quantity);
    }
  }

  const reserved = new Map<string, number>();
  const reservedPorts = new Map<string, number>();
  const commands: TradeCommand[] = [];
  for (const importer of new Set(Object.values(state.ownerByStateId))) {
    if (humanCountries.has(importer)) continue;
    const market = marketOf(state, importer);
    const country = report.countries[importer];
    const convoyCapacity = effectiveConvoyCapacity(state.nations[importer]);
    const occupiedConvoys = (country.military.seaCargoUsed ?? 0) + (country.tradeSeaCargo ?? 0);
    const seaTargets = new Map<Good, { id: string; value: number; demand: number }>();
    let best: { route: TradeRoute; profit: number } | undefined;

    function consider(from: string, to: string, good: Good, mode: TradeMode, demand: number, bestProfit: number) {
      const exporter = state.ownerByStateId[from];
      if (!exporter || marketOf(state, exporter) === market || foreignTradeStatus(state, exporter, importer, good) ||
          !!occupationAt(state, from) || !!occupationAt(state, to)) return;
      const source = report.states[from], destination = report.states[to];
      const supply = source.industries[good].unsold ?? 0;
      const sourceKey = JSON.stringify([from, good]);
      const spare = supply - (reserved.get(sourceKey) ?? 0);
      const ask = source.localPrices[good], bid = destination.localPrices[good];
      if (spare <= 0 || ask >= bid) return;
      const previous = existing.get(tradeRouteKey({ from, to, good, mode }));
      if (previous?.exporter === exporter && previous.importer === importer) return;
      const path = routeTransport(scenario, from, to, mode);
      if (!path) return;
      const fromSite = state.societies[from], toSite = state.societies[to];
      const sourceEffect = unrestEffects(fromSite.stability).transport, destinationEffect = unrestEffects(toSite.stability).transport;
      let transport: number;
      if (mode === "land") {
        const rail = connectedRailway(fromSite.railway, toSite.railway);
        const road = Math.min(Math.floor(path.fromCapacity * fromSite.infrastructure * sourceEffect),
          Math.floor(path.toCapacity * toSite.infrastructure * destinationEffect));
        const railway = Math.min(Math.floor(path.fromCapacity * rail * sourceEffect),
          Math.floor(path.toCapacity * rail * destinationEffect));
        transport = road + railway - Math.max(landUse.get(from) ?? 0, landUse.get(to) ?? 0);
      } else {
        const fromAccess = naval?.portAccess.get(from) ?? 1, toAccess = naval?.portAccess.get(to) ?? 1;
        const spareConvoys = Math.floor(convoyCapacity * Math.min(fromAccess, toAccess)) - occupiedConvoys;
        transport = Math.min(Math.floor(portCapacity(path.fromCapacity, fromSite) * fromAccess) -
          (source.portMilitaryCargo ?? 0) - (source.portTradeCargo ?? 0) - (reservedPorts.get(from) ?? 0),
          Math.floor(portCapacity(path.toCapacity, toSite) * toAccess) -
          (destination.portMilitaryCargo ?? 0) - (destination.portTradeCargo ?? 0) - (reservedPorts.get(to) ?? 0),
          Math.floor(spareConvoys / path.cargoCost));
      }
      const limit = Math.min(spare, demand, transport, maxTradeLimit);
      if (limit <= 0 || (bid - ask) * limit <= bestProfit) return;
      const route = { from, to, good, mode, exporter, importer, limit, paused: false, ...path };
      const { profit } = tradeAmounts(state, route, limit, ask, bid);
      if (profit > bestProfit) return { route, profit };
    }

    for (const to of owned) {
      if (state.ownerByStateId[to] !== importer || !!occupationAt(state, to)) continue;
      const destination = report.states[to], site = scenario.states[to];
      for (const good of tradableGoods) {
        const demand = destination.industries[good].unfilled ?? 0;
        if (demand === 0 || existingRoom.has(JSON.stringify([importer, good]))) continue;
        for (const from of site.neighbors) best = consider(from, to, good, "land", demand, best?.profit ?? 0) ?? best;
        if (!site.coastal || convoyCapacity <= occupiedConvoys || naval?.blockadedPorts.has(to)) continue;
        const value = demand * destination.localPrices[good];
        if (value > (seaTargets.get(good)?.value ?? 0)) seaTargets.set(good, { id: to, value, demand });
      }
    }
    for (const [good, { id: to, demand }] of seaTargets) {
      const destination = report.states[to];
      for (const from of portsByGood[good]) {
        if (report.states[from].localPrices[good] >= destination.localPrices[good]) break;
        best = consider(from, to, good, "sea", demand, best?.profit ?? 0) ?? best;
      }
    }
    if (!best) continue;
    const { from, to, good, mode, limit } = best.route;
    const sourceKey = JSON.stringify([from, good]);
    reserved.set(sourceKey, (reserved.get(sourceKey) ?? 0) + limit);
    const capacityUse = mode === "land" ? landUse : reservedPorts;
    for (const site of [from, to]) capacityUse.set(site, (capacityUse.get(site) ?? 0) + limit);
    commands.push({ type: "openTradeRoute", countryId: importer, from, to, good, mode, limit });
  }
  return commands;
}

export function settleTrade(
  state: GameState,
  supplies: Orders,
  demands: Orders,
  sites: Record<string, { localPrices: ByGood<number> }>,
  fills: ByGood<Record<string, MarketFill>>,
  militaryCargo: ReadonlyMap<string, number>,
  militaryPortUse: ReadonlyMap<string, number>,
  naval?: NavalTradeRestrictions,
  illicitOrders?: ReadonlyMap<string, { quantity: number; budget: number }>,
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
  const blockedAtSea = ({ mode, from, to }: TradeRoute) => mode === "sea" &&
    (naval?.blockadedPorts.has(from) || naval?.blockadedPorts.has(to));
  function corridor(route: TradeRoute) {
    const { from, to, mode, importer, cargoCost } = route;
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
    const fromAccess = naval?.portAccess.get(from) ?? 1, toAccess = naval?.portAccess.get(to) ?? 1;
    const seaLimit = Math.floor(effectiveConvoyCapacity(state.nations[importer]) * Math.min(fromAccess, toAccess));
    const spaceAtSea = seaLimit - (militaryCargo.get(importer) ?? 0) - usedAtSea;
    const freightFrom = portFreight.get(from) ?? 0, freightTo = portFreight.get(to) ?? 0;
    const transport = mode === "sea" ? Math.min(
      Math.floor(portCapacity(route.fromCapacity, sourceSite) * fromAccess) - (militaryPortUse.get(from) ?? 0) - freightFrom,
      Math.floor(portCapacity(route.toCapacity, targetSite) * toAccess) - (militaryPortUse.get(to) ?? 0) - freightTo,
      Math.floor(spaceAtSea / cargoCost),
    ) : roadSpace + railSpace;
    function book(quantity: number) {
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
    }
    return { transport, book };
  }
  const deliveries = (state.tradeRoutes ?? []).map((route): TradeDelivery => {
    const { from, to, importer, good, mode, cargoCost } = route;
    const empty = { from, to, good, mode, quantity: 0, purchase: 0, freight: 0, tariff: 0, sales: 0, profit: 0 };
    const restriction = tradeRouteBlock(state, route);
    if (restriction) return { ...empty, status: restriction };
    const source = at(from), target = at(to);
    const required = Math.min(
      route.limit,
      supplies[from][good] - fills[good][from].local - fills[good][from].poolSold - source.sent[good],
      demands[to][good] - fills[good][to].local - fills[good][to].poolBought - target.received[good],
    );
    const seaCargo = (quantity: number) => mode === "sea" && required > 0 ?
      { seaCargo: { required: required * cargoCost, delivered: quantity * cargoCost } } : {};
    if (blockedAtSea(route)) return { ...empty, status: "blockaded", ...seaCargo(0) };
    const { transport, book } = corridor(route);
    const quantity = Math.min(required, transport);
    if (quantity <= 0) return { ...empty, status: "noVolume", ...seaCargo(0) };
    const amounts = tradeAmounts(state, route, quantity, sites[from].localPrices[good], sites[to].localPrices[good]);
    const { purchase, freight, tariff, profit } = amounts;
    if (profit <= 0) return { ...empty, status: "unprofitable" };
    book(quantity);
    source.sent[good] += quantity;
    target.received[good] += quantity;
    source.producerPayment[good] += purchase;
    target.freight += freight;
    target.profit += profit;
    target.tariff += tariff;
    return { from, to, good, mode, quantity, status: "shipped", ...amounts, ...seaCargo(quantity) };
  });
  const smuggling: OpiumSmuggling[] = [];
  const illicitImports = new Map<string, { attempted: number; seized: number; delivered: number; spending: number }>();
  const illicitExports = new Map<string, { attempted: number; delivered: number; receipts: number }>();
  for (const route of state.tradeRoutes ?? []) {
    const { from, to, importer, exporter } = route;
    const order = illicitOrders?.get(to);
    if (!order || !illicitOpiumEligible(state, route) || blockedAtSea(route)) continue;
    const received = illicitImports.get(to) ?? { attempted: 0, seized: 0, delivered: 0, spending: 0 };
    const sent = illicitExports.get(from) ?? { attempted: 0, delivered: 0, receipts: 0 };
    const { transport, book } = corridor(route);
    const unitPrice = sites[from].localPrices.opium;
    const legalSupply = fills.opium[from];
    const stock = supplies[from].opium - legalSupply.local - legalSupply.poolSold - at(from).sent.opium - sent.attempted;
    const attempted = Math.min(route.limit, transport, stock, order.quantity - received.attempted,
      Math.floor((order.budget - received.spending) / unitPrice));
    if (attempted <= 0) continue;
    const customs = state.lastEconomy?.states[to];
    const patrol = 0.3 * (customs?.office?.coverage ?? 0) + 0.7 * (customs?.policing?.coverage ?? 0);
    const law = opiumLaw(state.nations[importer].laws);
    const seized = Math.round(attempted * patrol * (law === "鸦片禁令" ? 1 : 0.75));
    const delivered = attempted - seized, spending = delivered * unitPrice;
    book(attempted);
    illicitImports.set(to, { attempted: received.attempted + attempted, seized: received.seized + seized,
      delivered: received.delivered + delivered, spending: received.spending + spending });
    illicitExports.set(from, { attempted: sent.attempted + attempted, delivered: sent.delivered + delivered, receipts: sent.receipts + spending });
    smuggling.push({ from, to, importer, exporter, mode: route.mode, attempted, seized, delivered, spending, lostValue: seized * unitPrice });
  }
  const freight = { road: roadUse, rail: railUse, port: portFreight, sea: seaCargo };
  return { transfers, deliveries, seaCargo, portFreight, smuggling, illicitImports, illicitExports, freight };
}
