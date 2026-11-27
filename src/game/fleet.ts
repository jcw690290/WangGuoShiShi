import { z } from "zod";
import { convoyCargoCapacity } from "./transport.ts";

const units = z.int().nonnegative();
export const maxConvoyOrder = 50;
export const shipGoodsPerConvoy = 40;
export const shipGoodsPerMotor = 8;
export const rubberPerMotor = 10;
const motorCapacityBonus = 0.5;
export const fleetGoods = ["shipGoods", "oil", "rubber"] as const;
export type FleetGood = typeof fleetGoods[number];
export const isFleetGood = (good: string): good is FleetGood => (fleetGoods as readonly string[]).includes(good);
export function byFleetGood<T>(make: (good: FleetGood) => T): Record<FleetGood, T> {
  return { shipGoods: make("shipGoods"), oil: make("oil"), rubber: make("rubber") };
}
export const merchantFleetSchema = z.object({
  condition: z.int().min(0).max(100),
  stores: units,
  order: z.object({ stateId: z.string(), remaining: z.int().min(1).max(maxConvoyOrder) }).nullable(),
  motorizationPort: z.string().nullable().default(null),
  motorized: units.default(0),
  fueled: units.default(0),
  oil: units.default(0),
  rubber: units.default(0),
}).refine((fleet) => fleet.fueled <= fleet.motorized);
export type MerchantFleet = z.infer<typeof merchantFleetSchema>;
export const initialFleet = (): MerchantFleet => ({
  condition: 100, stores: 0, order: null, motorizationPort: null, motorized: 0, fueled: 0, oil: 0, rubber: 0,
});

const purchase = z.object({ ordered: units, delivered: units, spending: units }).refine((p) => p.delivered <= p.ordered);
export const fleetReportSchema = z.object({
  port: z.string().nullable(), ordered: units, delivered: units, spending: units,
  maintenanceDue: units, maintained: units, commissioned: units,
  motorization: z.object({ converted: units, fueled: units, oil: purchase, rubber: purchase }).optional(),
}).refine((week) => week.delivered <= week.ordered && week.maintained <= week.maintenanceDue);
export type FleetReport = z.infer<typeof fleetReportSchema>;
export function fleetSpending(fleet: FleetReport) {
  return fleet.spending + (fleet.motorization?.oil.spending ?? 0) + (fleet.motorization?.rubber.spending ?? 0);
}

export function maximumConvoyCapacity(nation: { convoys: number; fleet: MerchantFleet }) {
  return Math.floor((nation.convoys + nation.fleet.motorized * motorCapacityBonus) * convoyCargoCapacity);
}

export function effectiveConvoyCapacity(nation: { convoys: number; fleet: MerchantFleet }, perConvoy = convoyCargoCapacity) {
  return Math.floor((nation.convoys + nation.fleet.fueled * motorCapacityBonus) * perConvoy * nation.fleet.condition / 100);
}

export const fleetMaintenance = (convoys: number) => Math.ceil(convoys / 4);

export function closeFleet(convoys: number, fleet: MerchantFleet, delivered: Record<FleetGood, number>,
  port: string | null, berths: number, refits: number,
) {
  const maintenanceDue = fleetMaintenance(convoys);
  let stores = fleet.stores + delivered.shipGoods;
  const maintained = port === null ? 0 : Math.min(stores, maintenanceDue);
  stores -= maintained;
  const order = fleet.order;
  const commissioned = order && order.stateId === port
    ? Math.min(order.remaining, berths, Math.floor(stores / shipGoodsPerConvoy)) : 0;
  stores -= commissioned * shipGoodsPerConvoy;
  let rubber = fleet.rubber + delivered.rubber;
  const converted = Math.min(refits, Math.floor(stores / shipGoodsPerMotor), Math.floor(rubber / rubberPerMotor));
  stores -= converted * shipGoodsPerMotor;
  rubber -= converted * rubberPerMotor;
  const motorized = fleet.motorized + converted;
  const oil = fleet.oil + delivered.oil;
  const fueled = port === null ? 0 : Math.min(motorized, oil);
  const existingCondition = Math.max(0, Math.min(100, fleet.condition +
    (maintenanceDue > 0 ? 10 * maintained / maintenanceDue - 5 : 0)));
  const fleetSize = convoys + commissioned;
  const condition = fleetSize > 0 ? Math.round((convoys * existingCondition + commissioned * 100) / fleetSize) : 100;
  return { convoys: fleetSize, fleet: { condition, stores, rubber, oil: oil - fueled, motorized, fueled,
    motorizationPort: motorized < fleetSize ? fleet.motorizationPort : null,
    order: order && order.remaining > commissioned ? { ...order, remaining: order.remaining - commissioned } : null },
    maintenanceDue, maintained, commissioned, converted };
}
