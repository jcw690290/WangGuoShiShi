interface Order {
  supply: number;
  demand: number;
  access: number;
}

export interface MarketFill {
  local: number;
  poolBought: number;
  poolSold: number;
}

export function targetPrice(basePrice: number, supply: number, demand: number) {
  return basePrice * (1 + 0.75 * (demand - supply) / Math.max(demand, supply, 0.000001));
}

export function nextPrice(previous: number, target: number) {
  return previous + 0.35 * (target - previous);
}

function ration(cumulative: number, total: number, volume: number) {
  if (total === volume) return cumulative;
  // Integer division keeps the rounding remainder inside the pool and each fill within its order.
  return Number(BigInt(cumulative) * BigInt(volume) / BigInt(total));
}

export function clearMarket(orders: readonly Order[]) {
  let supplied = 0;
  let requested = 0;
  let localTrade = 0;
  const connected = orders.map(({ supply, demand, access }) => {
    const listed = Math.floor(supply * access);
    const ordered = Math.floor(demand * access);
    const local = Math.min(supply - listed, demand - ordered);
    supplied += listed;
    requested += ordered;
    localTrade += local;
    return { listed, ordered, local };
  });
  const pooledTrade = Math.min(supplied, requested);
  let supplyProgress = 0;
  let demandProgress = 0;
  let sold = 0;
  let bought = 0;
  const fills = connected.map(({ listed, ordered, local }): MarketFill => {
    supplyProgress += listed;
    demandProgress += ordered;
    const nextSold = ration(supplyProgress, supplied, pooledTrade);
    const nextBought = ration(demandProgress, requested, pooledTrade);
    const fill = { local, poolBought: nextBought - bought, poolSold: nextSold - sold };
    sold = nextSold;
    bought = nextBought;
    return fill;
  });
  return { traded: localTrade + pooledTrade, fills };
}
