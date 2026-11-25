import { z } from "zod";
import { industries } from "./industry.ts";
import type { ByGood, Good } from "./industry.ts";
import type { Pop } from "./society.ts";

export const startingLivingStandard = 10;

export const extraGoods = ["food", "dailyGoods", "services", "luxury"] as const;
type ExtraGood = typeof extraGoods[number];
const quantities = z.record(z.enum(extraGoods), z.int().nonnegative());
export const extrasReportSchema = z.object({
  budget: z.int().nonnegative(),
  orders: quantities,
  delivered: quantities,
  spending: z.int().nonnegative(),
}).refine(({ budget, spending, orders, delivered }) => spending <= budget &&
  extraGoods.every((good) => delivered[good] <= orders[good]));
export type ExtrasReport = z.infer<typeof extrasReportSchema>;

export const essentialGoods = ["grain", "cloth", "wood", "services"] as const;
const grainPerFood = 2;
export const substituteOrdersSchema = z.object({ food: z.int().nonnegative(), coal: z.int().nonnegative() });
export type SubstituteOrders = z.infer<typeof substituteOrdersSchema>;

export function planBasicBasket(
  needs: ByGood<number>, supply: ByGood<number>, prices: ByGood<number>, coalForIndustry: number,
) {
  const food = supply.grain < needs.grain || prices.food <= prices.grain * grainPerFood
    ? Math.min(supply.food, Math.floor(needs.grain / (2 * grainPerFood))) : 0;
  const coal = supply.wood < needs.wood || prices.coal <= prices.wood
    ? Math.min(Math.max(0, supply.coal - coalForIndustry), Math.floor(needs.wood / 2)) : 0;
  return { ...needs, grain: needs.grain - grainPerFood * food, wood: needs.wood - coal, food, coal };
}

export function basicEquivalentSupply(delivered: ByGood<number>, extra?: ExtrasReport["delivered"]) {
  return {
    grain: delivered.grain + (delivered.food - (extra?.food ?? 0)) * grainPerFood,
    cloth: delivered.cloth,
    wood: delivered.wood + delivered.coal,
    services: delivered.services - (extra?.services ?? 0),
  };
}

export function substitutedBasketCost(prices: ByGood<number>, orders: SubstituteOrders) {
  return orders.food * (prices.food - grainPerFood * prices.grain) + orders.coal * (prices.coal - prices.wood);
}

export function isExtraGood(good: Good): good is ExtraGood {
  return (extraGoods as readonly Good[]).includes(good);
}

export function byExtraGood<T>(make: (good: ExtraGood) => T): Record<ExtraGood, T> {
  return { food: make("food"), dailyGoods: make("dailyGoods"), services: make("services"), luxury: make("luxury") };
}

const preferences = { food: 0.25, dailyGoods: 0.35, services: 0.25, luxury: 0.15 };
const extraPerPerson = { food: 0.20, dailyGoods: 0.25, services: 0.25, luxury: 0.075 };
export function extrasOrders(people: number, budget: number) {
  return byExtraGood((good) => Math.min(Math.round(people * extraPerPerson[good]),
    Math.floor(budget * preferences[good] / Math.ceil(industries[good].basePrice * 1.75))));
}

type IncomeOccupation = "农民" | "劳工" | "工程师" | "资本家" | "贵族";
export function discretionaryIncome(
  pops: readonly Pop[], basicCost: number, income: Record<IncomeOccupation, number>, ruralEssentials: number,
) {
  const people: Record<IncomeOccupation, number> = { 农民: 0, 劳工: 0, 工程师: 0, 资本家: 0, 贵族: 0 };
  for (const { occupation, people: size } of pops) if (Object.hasOwn(people, occupation))
    people[occupation as IncomeOccupation] += size;
  const available = (Object.keys(people) as IncomeOccupation[]).reduce((sum, job) => {
    const required = Math.max(0, basicCost * people[job] - (job === "农民" ? ruralEssentials : 0));
    return people[job] > 0 ? sum + Math.max(0, income[job] - required) : sum;
  }, 0);
  return Math.floor(available);
}

export function livingStandardTarget(consumptionIndex: number, foodFulfillment: number) {
  const target = Math.max(1, Math.min(30, 10 + 4 * Math.log2(consumptionIndex)));
  return foodFulfillment < 0.8 ? Math.min(target, 1 + 11 * foodFulfillment) : target;
}

export function updateLivingStandard(current: number, target: number) {
  return current + 0.2 * (target - current);
}
