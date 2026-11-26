import { z } from "zod";
import type { GameState } from "./engine.ts";
import type { Scenario } from "../scenario/scenario.ts";
import { GameRuleError } from "./rules.ts";

export const maxWarshipOrder = 30;
export const shipGoodsPerWarship = 80;
const units = z.int().nonnegative();
const condition = units.max(100);
export const navySchema = z.object({
  warships: units, condition, stores: units,
  order: z.object({ stateId: z.string(), remaining: z.int().min(1).max(maxWarshipOrder) }).nullable(),
});
export type Navy = z.infer<typeof navySchema>;
export const initialNavy = (coastalStates = 0): Navy => ({
  warships: coastalStates > 0 ? Math.min(6, 1 + Math.floor(coastalStates / 8)) : 0,
  condition: 100, stores: 0, order: null,
});

export type NavalConstructionCommand = {
  type: "setWarshipOrder"; countryId: string; stateId: string; operation: "add" | "move" | "cancel";
};
export const navyReportSchema = z.object({
  port: z.string().nullable(), warships: units, condition, ordered: units, delivered: units, spending: units,
  maintenanceDue: units, maintained: units, commissioned: units,
}).refine((week) => week.delivered <= week.ordered && week.maintained <= week.maintenanceDue);
export type NavyReport = z.infer<typeof navyReportSchema>;

export const navyMaintenance = (warships: number) => Math.ceil(warships / 2);

export function closeNavy(navy: Navy, delivered: number, port: string | null, berths: number, maintenanceDue: number) {
  let stores = navy.stores + delivered;
  const maintained = port === null ? 0 : Math.min(stores, maintenanceDue);
  stores -= maintained;
  const order = navy.order;
  const commissioned = order && port === order.stateId
    ? Math.min(order.remaining, berths, Math.floor(stores / shipGoodsPerWarship)) : 0;
  stores -= commissioned * shipGoodsPerWarship;
  const currentCondition = Math.max(0, Math.min(100, navy.condition +
    (maintenanceDue > 0 ? 10 * maintained / maintenanceDue - 5 : 0)));
  const warships = navy.warships + commissioned;
  const condition = warships > 0 ? Math.round((navy.warships * currentCondition + commissioned * 100) / warships) : 100;
  return {
    navy: {
      warships, condition, stores,
      order: order && order.remaining > commissioned ? { ...order, remaining: order.remaining - commissioned } : null,
    },
    maintained, maintenanceDue, commissioned,
  };
}

export function applyNavalConstruction(scenario: Scenario, state: GameState, cmd: NavalConstructionCommand): GameState {
  const { countryId, stateId, operation } = cmd;
  if (state.ownerByStateId[stateId] !== countryId || !scenario.states[stateId].coastal)
    throw new GameRuleError("只能在本国沿海州安排造舰");
  if (operation !== "cancel" && state.occupation?.stateId === stateId) throw new GameRuleError("该港口处于军事占领中");
  const nation = state.nations[countryId], current = nation.navy.order;
  if (operation === "cancel" && current?.stateId !== stateId || operation === "move" && current === null)
    throw new GameRuleError("该造舰订单已变更");
  if (operation === "add" && current && (current.stateId !== stateId || current.remaining >= maxWarshipOrder))
    throw new GameRuleError("请检查造舰港口和数量上限");
  const order = operation === "cancel" ? null : { stateId, remaining: (current?.remaining ?? 0) + Number(operation === "add") };
  return { ...state, nations: { ...state.nations, [countryId]: { ...nation, navy: { ...nation.navy, order } } } };
}
