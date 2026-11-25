export const startingLivingStandard = 10;

export function livingStandardTarget(consumptionIndex: number, foodFulfillment: number) {
  const target = Math.max(1, Math.min(30, 10 + 4 * Math.log2(consumptionIndex)));
  return foodFulfillment < 0.8 ? Math.min(target, 1 + 11 * foodFulfillment) : target;
}

export function updateLivingStandard(current: number, target: number) {
  return current + 0.2 * (target - current);
}
