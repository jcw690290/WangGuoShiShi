import { z } from "zod";
import type { BorderDispute } from "./diplomacy.ts";
import type { GameState } from "./engine.ts";
import type { Scenario } from "../scenario/scenario.ts";
import { convoyCargoCapacity, portCapacity, raidedConvoyCargoCapacity, seaVoyageCargoCost } from "./transport.ts";

export const navalTasks = ["escort", "raid", "blockade", "landing"] as const;
export const navalTaskNames = { escort: "护航", raid: "破交", blockade: "封锁", landing: "登陆支援" } as const;
export const navalMissionSchema = z.strictObject({ task: z.enum(navalTasks), portId: z.string() });
export type NavalMission = z.infer<typeof navalMissionSchema>;
export type NavalMissionCommand = { type: "setNavalMission"; countryId: string; mission: NavalMission | null };

export function fleetPower(state: GameState, countryId: string) {
  const { warships, condition } = state.nations[countryId].navy;
  return warships * condition / 100;
}

function coalitions(dispute: BorderDispute) {
  return [[dispute.claimantId, ...dispute.allies], [dispute.defenderId, ...dispute.defenders]] as const;
}

export function navalMissionTargets(scenario: Scenario, state: GameState, dispute: BorderDispute, countryId: string,
  task: NavalMission["task"]) {
  const [claimants, defenders] = coalitions(dispute);
  const attacking = claimants.includes(countryId);
  const friendly = attacking ? claimants : defenders;
  const opposing = attacking ? defenders : claimants;
  const coast = Object.values(scenario.states).filter((site) => site.coastal && state.occupation?.stateId !== site.id);
  const bases = coast.filter((site) => state.ownerByStateId[site.id] === countryId);
  const eligible = task === "escort" ? friendly : opposing;
  const target = scenario.states[dispute.targetStateId];
  return coast.filter((site) => eligible.includes(state.ownerByStateId[site.id]) &&
    (task !== "landing" || (attacking && (site.id === target.id || target.neighbors.includes(site.id)))) &&
    bases.some((base) => seaVoyageCargoCost(base.label, site.label) <= 2))
    .sort((a, b) => portCapacity(b.grainTransport, state.societies[b.id]) - portCapacity(a.grainTransport, state.societies[a.id]));
}

export function planNavalOperations(scenario: Scenario, state: GameState, dispute: BorderDispute) {
  const pressures = new Map<string, { escorts: number; raids: number; blockaders: number }>();
  const landing = new Map<string, { portId: string; power: number }>();
  for (const id of coalitions(dispute).flat()) {
    const designated = dispute.navalMissions?.[id];
    const legacyRaid = designated === undefined && dispute.raid.includes(id);
    if (!designated && !legacyRaid) continue;
    const task = designated?.task ?? "blockade";
    const options = navalMissionTargets(scenario, state, dispute, id, task);
    const target = designated ? options.find((site) => site.id === designated.portId) : options[0];
    if (!target) continue;
    // Existing saves had no separate military fleet. Honor a legacy raid until a fleet is assigned.
    const power = legacyRaid && state.nations[id].navy.warships === 0 ? 1 : fleetPower(state, id);
    if (power === 0) continue;
    if (task === "landing") {
      landing.set(id, { portId: target.id, power });
      continue;
    }
    const pressure = pressures.get(target.id) ?? { escorts: 0, raids: 0, blockaders: 0 };
    if (task === "escort") pressure.escorts += power;
    if (task === "raid") pressure.raids += power;
    if (task === "blockade") pressure.blockaders += power;
    pressures.set(target.id, pressure);
  }
  const portAccess = new Map<string, number>(), blockadedPorts = new Set<string>();
  const maxDisruption = 1 - raidedConvoyCargoCapacity / convoyCargoCapacity;
  for (const [id, { escorts, raids, blockaders }] of pressures) {
    const threat = raids + blockaders;
    if (threat <= escorts) continue;
    portAccess.set(id, 1 - maxDisruption * (threat - escorts) / threat);
    if (blockaders > escorts) blockadedPorts.add(id);
  }
  for (const support of landing.values())
    support.power = Math.max(0, support.power - (pressures.get(support.portId)?.escorts ?? 0));
  return { portAccess, blockadedPorts, landing };
}
