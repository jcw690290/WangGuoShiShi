import type { SiteSocial } from "./society.ts";
import { unrestEffects } from "./unrest.ts";

export const convoyCargoCapacity = 800;
export const raidedConvoyCargoCapacity = 220;
export const railCapacityPerLevel = 0.5;

export function connectedRailway(left: number, right: number) {
  return Math.min(left, right) * railCapacityPerLevel;
}

export interface MaritimeTerminal {
  stateId: string;
  capacity: number;
}

export function portCapacity(base: number, site: Pick<SiteSocial, "infrastructure" | "port" | "stability">) {
  return Math.floor(base * (site.infrastructure + site.port) * unrestEffects(site.stability).transport);
}

export function seaVoyageCargoCost(from: readonly [number, number], to: readonly [number, number]) {
  const horizontal = Math.abs(from[0] - to[0]);
  const distance = Math.hypot(Math.min(horizontal, 1200 - horizontal), from[1] - to[1]);
  return Math.max(1, Math.ceil(distance / 200));
}
