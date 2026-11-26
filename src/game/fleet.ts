import { z } from "zod";
import { convoyCargoCapacity } from "./transport.ts";

const units = z.int().nonnegative();
export const maxConvoyOrder = 50;
export const shipGoodsPerConvoy = 40;
export const merchantFleetSchema = z.object({
  condition: z.int().min(0).max(100),
  stores: units,
  order: z.object({ stateId: z.string(), remaining: z.int().min(1).max(maxConvoyOrder) }).nullable(),
});
export type MerchantFleet = z.infer<typeof merchantFleetSchema>;
export const initialFleet = (): MerchantFleet => ({ condition: 100, stores: 0, order: null });

export const fleetReportSchema = z.object({
  port: z.string().nullable(), ordered: units, delivered: units, spending: units,
  maintenanceDue: units, maintained: units, commissioned: units,
}).refine((week) => week.delivered <= week.ordered && week.maintained <= week.maintenanceDue);
export type FleetReport = z.infer<typeof fleetReportSchema>;

export function effectiveConvoyCapacity(nation: { convoys: number; fleet: MerchantFleet }, perConvoy = convoyCargoCapacity) {
  return Math.floor(nation.convoys * perConvoy * nation.fleet.condition / 100);
}

export const fleetMaintenance = (convoys: number) => Math.ceil(convoys / 4);

export function closeFleet(convoys: number, fleet: MerchantFleet, delivered: number, port: string | null, berths: number) {
  const maintenanceDue = fleetMaintenance(convoys);
  let stores = fleet.stores + delivered;
  const maintained = port === null ? 0 : Math.min(stores, maintenanceDue);
  stores -= maintained;
  const order = fleet.order;
  const commissioned = order && order.stateId === port
    ? Math.min(order.remaining, berths, Math.floor(stores / shipGoodsPerConvoy)) : 0;
  stores -= commissioned * shipGoodsPerConvoy;
  const existingCondition = Math.max(0, Math.min(100, fleet.condition +
    (maintenanceDue > 0 ? 10 * maintained / maintenanceDue - 5 : 0)));
  const fleetSize = convoys + commissioned;
  const condition = fleetSize > 0 ? Math.round((convoys * existingCondition + commissioned * 100) / fleetSize) : 100;
  return { convoys: fleetSize, fleet: { condition, stores,
    order: order && order.remaining > commissioned ? { ...order, remaining: order.remaining - commissioned } : null },
    maintenanceDue, maintained, commissioned };
}
