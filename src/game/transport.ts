export const convoyCargoCapacity = 800;
export const raidedConvoyCargoCapacity = 220;
export const railCapacityPerLevel = 0.5;

export function connectedRailway(left: number, right: number) {
  return Math.min(left, right) * railCapacityPerLevel;
}

export function seaVoyageCargoCost(from: readonly [number, number], to: readonly [number, number]) {
  const horizontal = Math.abs(from[0] - to[0]);
  const distance = Math.hypot(Math.min(horizontal, 1200 - horizontal), from[1] - to[1]);
  return Math.max(1, Math.ceil(distance / 200));
}
