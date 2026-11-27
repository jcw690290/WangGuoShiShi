import { useMemo, useState } from "react";
import { count, silver } from "./format.ts";
import type { EconomyReport } from "./game/economy.ts";
import type { GameState } from "./game/engine.ts";
import { goods, industries, isLocalGood } from "./game/industry.ts";
import type { Good } from "./game/industry.ts";
import { marketOf } from "./game/market.ts";
import { harvestGood } from "./game/subsistence.ts";
import { tradeStatuses } from "./game/trade.ts";
import { tariffRate, tradeLaw } from "./game/trade-policy.ts";
import type { Scenario } from "./scenario/scenario.ts";

interface Props {
  scenario: Scenario;
  game: GameState;
  report: EconomyReport;
  countryId: string;
}

export function CommodityDetails(props: Props) {
  const [open, setOpen] = useState(false);
  const [good, setGood] = useState<Good>("grain");
  return <details className="control-block commodity-details" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>商品详情 · 来源、买方与限制</summary>
    {open && <>
      <label>商品 <select value={good} onChange={(event) => setGood(event.target.value as Good)}>
        {goods.map((item) => <option key={item} value={item}>{industries[item].goodName}</option>)}
      </select></label>
      <CommodityActivity {...props} good={good} />
    </>}
  </details>;
}

function CommodityActivity({ scenario, game, report, countryId, good }: Props & { good: Good }) {
  const marketId = marketOf(game, countryId);
  const owners = game.ownerByStateId, nations = game.nations;
  const marketSites = useMemo(() => new Set(Object.entries(owners)
    .filter(([, owner]) => (nations[owner].marketLeader ?? owner) === marketId)
    .map(([id]) => id)), [owners, nations, marketId]);
  const market = report.countries[countryId].market[good];
  const nation = game.nations[countryId];
  const settled = game.lastEconomy === report;
  const members = [...marketSites].map((id) => {
    const site = report.states[id], industry = site.industries[good];
    const surplus = site.subsistence && harvestGood(good)
      ? site.subsistence.produced[good] - site.subsistence.retained[good] : 0;
    const ruralSales = site.subsistence && harvestGood(good) ? site.subsistence.sold[good] : 0;
    return {
      id, available: industry.output + surplus,
      sold: (industry.sold ?? 0) + ruralSales,
      bought: industry.bought ?? 0,
      buyers: industry.buyers,
      access: site.access,
    };
  });
  const suppliers = members.filter(({ available, sold }) => available > 0 || sold > 0)
    .sort((a, b) => b.available - a.available);
  const buyers = members.filter(({ bought }) => bought > 0).sort((a, b) => b.bought - a.bought);
  const shipments = (report.trade ?? []).filter((shipment) =>
    shipment.good === good && (marketSites.has(shipment.from) || marketSites.has(shipment.to)));
  const missing = market.traded === undefined ? undefined : market.demand - market.traded;
  return <>
    <p>{settled ? "最近周结算" : "市场估算"} · 参考价 {silver(market.price)}
      {market.targetPrice !== undefined && ` · 目标价 ${silver(market.targetPrice)}`}</p>
    <p>供给 {count(market.supply)} · 需求 {count(market.demand)}
      {missing !== undefined && ` · 成交 ${count(market.traded!)} · 未满足 ${count(missing)}`}</p>
    {market.demand > market.supply && <p>市场总供给低于需求。</p>}
    {market.traded !== undefined && market.traded < Math.min(market.supply, market.demand) &&
      <p>市场有未成交的供给和需求，可核对州接入与线路状态。</p>}
    <p>{isLocalGood(good) ? "本地商品，无法建立跨市场线路。" :
      `所选国家实行${tradeLaw(nation.laws)}，当前进口关税 ${tariffRate(nation)}%。`}</p>
    <details>
      <summary>州级供给记录 · {suppliers.length} 州</summary>
      {suppliers.length > 0
        ? <ul>{suppliers.map(({ id, available, sold, access }) => <li key={id}>
          {scenario.states[id].name} · 商品产出及自给余量 {count(available)} · 销售 {count(sold)} · 接入 {Math.round(access * 100)}%
        </li>)}</ul>
        : <p>本市场没有该商品的州级供给记录。</p>}
    </details>
    <details>
      <summary>州级市场采购记录 · {buyers.length} 州</summary>
      {buyers.length > 0
        ? <ul>{buyers.map(({ id, bought, buyers, access }) => <li key={id}>
          {scenario.states[id].name} · 购入 {count(bought)} · 接入 {Math.round(access * 100)}%
          {buyers && <small> · 家庭 {count(buyers.households)} · 建设 {count(buyers.construction)}
            {" · "}产业 {count(buyers.industry)} · 公共机构与舰队 {count(buyers.publicServices)}</small>}
        </li>)}</ul>
        : <p>本市场没有该商品的州级采购记录。</p>}
    </details>
    {!isLocalGood(good) && <details>
      <summary>跨市场线路状态 · {shipments.length} 条</summary>
      {shipments.length > 0
        ? <ul>{shipments.map(({ from, to, mode, status, quantity }) =>
          <li key={JSON.stringify([from, to, mode])}>
            {scenario.states[from].name} → {scenario.states[to].name} · {mode === "sea" ? "海运" : "陆运"} · {tradeStatuses[status]}
            {quantity > 0 && ` ${count(quantity)}`}
          </li>)}</ul>
        : <p>没有该商品的线路记录。</p>}
    </details>}
  </>;
}
