import { useState } from "react";
import type { FormEvent } from "react";
import { count, silver } from "./format.ts";
import type { GameCommand, GameState } from "./game/engine.ts";
import { tradableGoods, industries } from "./game/industry.ts";
import type { Good } from "./game/industry.ts";
import { marketOf } from "./game/market.ts";
import { foreignTradeStatus, tradeRouteBlock, tradeRouteKey, tradeStatuses } from "./game/trade.ts";
import type { TradeMode, TradeRoute } from "./game/trade.ts";
import type { Scenario } from "./scenario/scenario.ts";

interface Props {
  scenario: Scenario;
  game: GameState;
  stateId: string;
  playerId: string;
  busy: boolean;
  send: (command: GameCommand) => void;
}

const modeNames = { land: "陆路", sea: "海运" };

function RouteControls({ route, busy, send }: { route: TradeRoute; busy: boolean; send: Props["send"] }) {
  const { importer: countryId, from, to, mode, good, paused } = route;
  const key = { countryId, from, to, mode, good };
  function setLimit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const limit = Number(new FormData(event.currentTarget).get("limit"));
    send({ type: "setTradeRoute", ...key, limit, paused });
  }
  return (
    <form className="diplomacy-actions" onSubmit={setLimit}>
      <label>周运量上限 <input key={route.limit} name="limit" type="number" min="1" max="100000" defaultValue={route.limit} required /></label>
      <button className="build" type="submit" disabled={busy}>保存运量</button>
      <button className="build" type="button" disabled={busy}
        onClick={() => send({ type: "setTradeRoute", ...key, limit: route.limit, paused: !paused })}>
        {paused ? "恢复线路" : "暂停线路"}
      </button>
      <button className="build" type="button" disabled={busy}
        onClick={() => send({ type: "removeTradeRoute", ...key })}>撤销线路</button>
    </form>
  );
}

export function TradePanel({ scenario, game, stateId, playerId, busy, send }: Props) {
  const [choice, setChoice] = useState("");
  const [good, setGood] = useState<Good>("grain");
  const [draftMode, setMode] = useState<TradeMode>("land");
  const owns = game.ownerByStateId[stateId] === playerId;
  const routes = (game.tradeRoutes ?? []).filter((row) => row.to === stateId || row.from === stateId);
  const port = owns && scenario.states[stateId].coastal;
  const mode = port ? draftMode : "land";
  const eligible = (id: string) => Object.hasOwn(game.ownerByStateId, id) &&
    marketOf(game, game.ownerByStateId[id]) !== marketOf(game, playerId);
  const landSources = owns ? scenario.states[stateId].neighbors.filter(eligible) : [];
  const sources = mode === "land" ? landSources :
    Object.keys(game.ownerByStateId).filter((id) => scenario.states[id].coastal && eligible(id));
  const source = sources.includes(choice) ? choice : sources[0];
  const restriction = source && (game.occupation?.stateId === source || game.occupation?.stateId === stateId)
    ? "occupied" : source ? foreignTradeStatus(game, game.ownerByStateId[source], playerId) : undefined;
  if (!routes.length && !landSources.length && !port) return null;
  function openRoute(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const limit = Number(new FormData(event.currentTarget).get("limit"));
    send({ type: "openTradeRoute", countryId: playerId, from: source, to: stateId, mode, good, limit });
  }
  const duplicate = routes.some((route) => route.from === source && route.to === stateId &&
    route.mode === mode && route.good === good && route.importer === playerId && route.exporter === game.ownerByStateId[source]);
  return (
    <details>
      <summary>跨市场贸易</summary>
      {port && <label>运输方式 <select value={mode} onChange={(event) => setMode(event.target.value as TradeMode)}>
        <option value="land">陆路</option><option value="sea">海运</option>
      </select></label>}
      {source && (
        <form className="diplomacy-actions" onSubmit={openRoute}>
          <label>出口州 <select value={source} onChange={(event) => setChoice(event.target.value)}>
            {sources.map((id) => <option key={id} value={id}>{scenario.states[id].name} · {scenario.countries[game.ownerByStateId[id]].name}</option>)}
          </select></label>
          <label>商品 <select value={good} onChange={(event) => setGood(event.target.value as Good)}>
            {tradableGoods.map((id) => <option key={id} value={id}>{industries[id].goodName}</option>)}
          </select></label>
          <label>周运量上限 <input name="limit" type="number" min="1" max="100000" defaultValue="500" required /></label>
          <button className="build" type="submit" disabled={busy || duplicate || restriction !== undefined}>批准进口</button>
          {restriction && <small>{tradeStatuses[restriction]}</small>}
        </form>
      )}
      {routes.length > 0 && <ul className="industry-list">
        {routes.map((route) => {
          const key = tradeRouteKey(route);
          const latest = game.lastEconomy?.trade?.find((row) => tradeRouteKey(row) === key);
          const currentRestriction = tradeRouteBlock(game, route);
          return (
            <li key={key}>
              <div>
                <strong>{scenario.states[route.from].name} → {scenario.states[route.to].name} · {modeNames[route.mode]} · {industries[route.good].goodName}</strong>
                <p>{currentRestriction ? tradeStatuses[currentRestriction] :
                  latest ? `上周${tradeStatuses[latest.status]}` : "待周结"} · 周上限 {count(route.limit)}</p>
                {latest?.status === "shipped" && <p>
                  上周运量 {count(latest.quantity)} · 购货 {silver(latest.purchase)} · 销售 {silver(latest.sales)} ·
                  运费 {silver(latest.freight)} · 关税 {silver(latest.tariff)} · 利润 {silver(latest.profit)}
                </p>}
                {route.importer === playerId && <RouteControls route={route} busy={busy} send={send} />}
              </div>
            </li>
          );
        })}
      </ul>}
    </details>
  );
}
