import type { Scenario } from "../scenario/scenario.ts";
import type { GameState } from "./engine.ts";
import { occupationAt } from "./conflict-state.ts";
import { effectiveConvoyCapacity } from "./fleet.ts";
import type { WarPlan } from "./diplomacy.ts";
import type { MarketFill } from "./market.ts";
import { connectedRailway, portCapacity, seaVoyageCargoCost } from "./transport.ts";
import { unrestEffects } from "./unrest.ts";

export interface FreightUse {
  road: Map<string, number>;
  rail: Map<string, number>;
  port: Map<string, number>;
  sea: Map<string, number>;
}

export const emptyFreightUse = (): FreightUse => ({ road: new Map(), rail: new Map(), port: new Map(), sea: new Map() });

export const addFreight = (use: Map<string, number>, id: string, freight: number) => use.set(id, (use.get(id) ?? 0) + freight);

type NavalPlan = WarPlan["naval"];
type Edge = { from: string; to: string; sea: number };

export function domesticFreight(scenario: Scenario, state: GameState, markets: Record<string, string[]>,
  militaryCargo: ReadonlyMap<string, number>, militaryPorts: ReadonlyMap<string, number>, naval?: NavalPlan,
  reserved = emptyFreightUse(),
) {
  const used = emptyFreightUse();

  const demandScale = new Map<string, number>();
  const roads = new Map<string, number>();
  const ports = new Map<string, number>();
  const convoys = new Map<string, number>();
  const landBonus = new Map<string, number>();
  const links = new Map<string, Edge[]>();
  const openPorts = new Set<string>();
  const selfMarkets = new Set<string>();
  for (const ids of Object.values(markets)) {
    const market = new Set(ids.filter((id) => !occupationAt(state, id)));
    if (ids.length === 1 && market.has(ids[0])) selfMarkets.add(ids[0]);
    const coastal = [...market].filter((id) => scenario.states[id].coastal && !naval?.blockadedPorts.has(id));
    for (const id of coastal) openPorts.add(id);
    for (const id of ids) {
      const { infrastructure, port, stability } = state.societies[id];
      const { grainTransport, neighbors } = scenario.states[id];
      const owner = state.ownerByStateId[id];
      const access = naval?.portAccess.get(id) ?? 1;
      const base = grainTransport * unrestEffects(stability).transport;
      roads.set(id, Math.floor(base * infrastructure));
      landBonus.set(id, base);
      ports.set(id, openPorts.has(id) ? Math.floor(access * portCapacity(grainTransport, { infrastructure, port, stability })) : 0);
      if (!convoys.has(owner)) convoys.set(owner, effectiveConvoyCapacity(state.nations[owner]) - (militaryCargo.get(owner) ?? 0));
      demandScale.set(id, Math.max(1, roads.get(id)!));
      links.set(id, market.has(id) ? neighbors.filter((next) => market.has(next)).map((to) => ({ from: id, to, sea: 0 })) : []);
    }
    // Both directions consume a port slot and the receiving owner's merchant capacity.
    for (const id of coastal) {
      const edges = links.get(id)!;
      const seaLinks = coastal.filter((next) => next !== id).map((next) => ({
        from: id, to: next, sea: seaVoyageCargoCost(scenario.states[id].label, scenario.states[next].label),
      }));
      seaLinks.sort((a, b) => a.sea - b.sea);
      edges.push(...seaLinks);
    }
  }

  function remaining(capacity: number, bucket: keyof FreightUse, id: string, pending?: FreightUse) {
    return capacity - (used[bucket].get(id) ?? 0) - (reserved[bucket].get(id) ?? 0) - (pending?.[bucket].get(id) ?? 0);
  }
  // The search walks backward from each buyer, so `from` receives the cargo.
  function capacity({ from, to, sea }: Edge, pending?: FreightUse) {
    if (sea) {
      const owner = state.ownerByStateId[from];
      const access = Math.min(naval?.portAccess.get(from) ?? 1, naval?.portAccess.get(to) ?? 1);
      const navalCargo = militaryCargo.get(owner) ?? 0;
      const seaLimit = Math.floor((convoys.get(owner)! + navalCargo) * access) - navalCargo;
      const limit = Math.min(remaining(ports.get(from)! - (militaryPorts.get(from) ?? 0), "port", from, pending),
        remaining(ports.get(to)! - (militaryPorts.get(to) ?? 0), "port", to, pending),
        Math.floor(remaining(seaLimit, "sea", owner, pending) / sea));
      return { total: Math.max(0, limit), rail: 0 };
    }
    const railLevel = connectedRailway(state.societies[from].railway, state.societies[to].railway);
    const rail = Math.max(0, Math.min(remaining(Math.floor(landBonus.get(from)! * railLevel), "rail", from, pending),
      remaining(Math.floor(landBonus.get(to)! * railLevel), "rail", to, pending)));
    const road = Math.max(0, Math.min(remaining(roads.get(from)!, "road", from, pending), remaining(roads.get(to)!, "road", to, pending)));
    return { total: rail + road, rail };
  }
  const access = new Map([...links].map(([id, edges]) => {
    const demand = demandScale.get(id)!;
    let available = 0;
    for (const edge of edges) {
      available = Math.max(available, capacity(edge).total);
      if (available >= demand) break;
    }
    return [id, selfMarkets.has(id) ? 1 : Math.min(1, available / demand)];
  }));

  function book(path: Edge[], amount: number, commit: boolean) {
    const pending = emptyFreightUse();
    for (const edge of path) {
      const { from, to, sea } = edge;
      const space = capacity(edge, pending);
      if (space.total < amount) return false;
      if (sea > 0) {
        addFreight(pending.port, from, amount);
        addFreight(pending.port, to, amount);
        addFreight(pending.sea, state.ownerByStateId[from], amount * sea);
      } else {
        const rail = Math.min(amount, space.rail);
        for (const id of [from, to]) {
          addFreight(pending.rail, id, rail);
          addFreight(pending.road, id, amount - rail);
        }
      }
    }
    if (commit) for (const bucket of ["road", "rail", "port", "sea"] as const)
      for (const [id, amount] of pending[bucket]) addFreight(used[bucket], id, amount);
    return true;
  }

  function clear(ids: string[], orders: readonly { supply: number; demand: number }[], localOnly: boolean) {
    const fills = orders.map(({ supply, demand }): MarketFill => ({ local: Math.min(supply, demand), poolBought: 0, poolSold: 0 }));
    let traded = fills.reduce((sum, fill) => sum + fill.local, 0);
    if (localOnly) return { traded, fills };
    const surplus = new Map(ids.flatMap((id, i) => orders[i].supply > fills[i].local ? [[id, orders[i].supply - fills[i].local]] : []));
    const indexes = new Map(ids.map((id, i) => [id, i]));
    for (const [i, buyer] of ids.entries()) {
      let missing = orders[i].demand - fills[i].local;
      while (missing > 0 && surplus.size > 0) {
        const nextInPath = new Map<string, Edge | null>([[buyer, null]]);
        let seller: string | undefined;
        for (const node of nextInPath.keys()) {
          if (surplus.has(node)) { seller = node; break; }
          for (const edge of links.get(node)!) {
            if (!nextInPath.has(edge.to) && capacity(edge).total > 0) nextInPath.set(edge.to, edge);
          }
        }
        if (seller === undefined) break;
        const path: Edge[] = [];
        for (let edge = nextInPath.get(seller); edge; edge = nextInPath.get(edge.from)) path.push(edge);
        const stock = surplus.get(seller)!;
        let amount = Math.min(missing, stock, ...path.map((edge) => capacity(edge).total));
        if (!book(path, amount, true)) {
          let low = 0, high = amount - 1;
          while (low < high) {
            const units = Math.ceil((low + high) / 2);
            if (book(path, units, false)) low = units;
            else high = units - 1;
          }
          amount = low;
          if (amount > 0) book(path, amount, true);
        }
        if (amount === 0) break;
        missing -= amount;
        traded += amount;
        fills[i].poolBought += amount;
        fills[indexes.get(seller)!].poolSold += amount;
        if (amount === stock) surplus.delete(seller);
        else surplus.set(seller, stock - amount);
      }
    }
    return { traded, fills };
  }

  return { clear, access, used };
}
