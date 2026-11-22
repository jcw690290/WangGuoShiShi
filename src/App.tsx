import { useEffect, useMemo, useState } from "react";
import { DiplomacyPanel } from "./DiplomacyPanel.tsx";
import { EconomyPanel } from "./EconomyPanel.tsx";
import { PoliticsPanel } from "./PoliticsPanel.tsx";
import { count, silver } from "./format.ts";
import { projectEconomy } from "./game/economy.ts";
import { createGame, dispatch, getGameDate, isScenarioFinished, spanDays } from "./game/engine.ts";
import type { GameCommand, Span } from "./game/engine.ts";
import { planWar } from "./game/diplomacy.ts";
import { loadGame, saveGame } from "./game/storage.ts";
import { StateMap } from "./map/StateMap.tsx";
import type { StateGeometry } from "./map/geometry.ts";
import { atlas } from "./scenario/scenario.ts";
import type { Scenario } from "./scenario/scenario.ts";

const dateFormat = new Intl.DateTimeFormat("zh-CN", { dateStyle: "long", timeZone: "UTC" });
export function App({ scenario, geometry }: { scenario: Scenario; geometry: StateGeometry }) {
  const [game, setGame] = useState(() => createGame(scenario)),
    [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("保存在当前浏览器");
  const countries = Object.values(scenario.countries),
    [choice, setChoice] = useState(countries[0].id);
  const [span, setSpan] = useState<Span>("week"),
    [until, setUntil] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const finished = isScenarioFinished(scenario, game),
    running = !finished && until !== null && game.elapsedDays < until,
    locked = busy || running,
    player = game.playerCountryId;
  const site =
    selected ??
    (player
      ? (Object.keys(game.ownerByStateId).find((id) => game.ownerByStateId[id] === player) ?? null)
      : null);
  const owner = site ? game.ownerByStateId[site] : null;
  const report = useMemo(
    () => game.lastEconomy ?? projectEconomy(game, planWar(scenario, game)),
    [game, scenario],
  );
  const matches = useMemo(
    () =>
      Object.entries(atlas).filter(([id, s]) =>
        (id + " " + s.name + " " + (scenario.countries[game.ownerByStateId[id]]?.name ?? "未分配"))
          .toLowerCase()
          .includes(search.trim().toLowerCase()),
      ),
    [search, game.ownerByStateId, scenario],
  );
  const date = getGameDate(scenario, game);
  const dateISO = date.toISOString().slice(0, 10);
  function send(cmd: GameCommand) {
    setGame((previous) => dispatch(scenario, previous, cmd));
  }
  useEffect(() => {
    if (!running) return;
    const timer = setTimeout(
      () => {
        setGame((previous) => {
          let result = previous;
          const days = Math.min(span === "halfYear" ? 7 : 1, until! - previous.elapsedDays);
          for (let i = 0; i < days; i++) result = dispatch(scenario, result, { type: "advanceDay" });
          return result;
        });
      },
      span === "halfYear" ? 35 : 65,
    );
    return () => clearTimeout(timer);
  }, [running, until, span, game.elapsedDays, scenario]);
  async function slot(action: "save" | "load") {
    setBusy(true);
    try {
      if (action === "save") {
        await saveGame(scenario, game);
        setNotice("已存档 · " + dateFormat.format(date));
      } else {
        const saved = await loadGame(scenario);
        if (saved) {
          setGame(saved);
          setUntil(null);
          setSelected(null);
          setNotice("已读档 · " + dateFormat.format(getGameDate(scenario, saved)));
        } else setNotice("暂无存档");
      }
    } catch (e) {
      setNotice(
        (action === "save" ? "存档" : "读档") + "失败。" + (e instanceof Error ? e.message : String(e)),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <header className="masthead">
        <div className="masthead-inner">
          <div className="brand">
            <span className="seal" aria-hidden="true">
              王
            </span>
            王国史诗
          </div>
          <div className="time-controls">
            <span className="paused">{running ? "推进中" : "已暂停"}</span>
            <time dateTime={dateISO}>{dateFormat.format(date)}</time>
            <select
              aria-label="推进跨度"
              value={span}
              disabled={locked || finished}
              onChange={(e) => setSpan(e.target.value as Span)}
            >
              <option value="day">一天</option>
              <option value="week">一周</option>
              <option value="halfYear">半年</option>
            </select>
            <button
              className="advance"
              disabled={!player || busy || finished}
              onClick={() => setUntil(running ? null : game.elapsedDays + spanDays(scenario, game, span))}
            >
              {running ? "暂停" : "推进"}
            </button>
          </div>
        </div>
      </header>
      <main>
        <header className="scenario-heading">
          <h1>{scenario.name}</h1>
          <p>
            {countries.length} 个国家 · {Object.keys(atlas).length} 个州 ·{" "}
            {Object.keys(atlas).length - Object.keys(scenario.states).length} 个未分配州
            {scenario.endDate && ` · 剧本期限 ${dateFormat.format(new Date(scenario.endDate))}`}
          </p>
        </header>
        {finished && player && (
          <section className="panel scenario-result" aria-labelledby="result-title">
            <header className="panel-header">
              <h2 id="result-title">剧本结束 · {dateISO === scenario.endDate ? "期末结算" : "存档实况"}</h2>
            </header>
            <div className="control-block">
              <p role="status">
                {dateISO === scenario.endDate
                  ? `已于 ${dateFormat.format(date)} 到达剧本期限。`
                  : `此存档已超过剧本期限，以下为 ${dateFormat.format(date)} 的存档实况。`}
              </p>
              <p>
                {scenario.countries[player].name} · 国库 {silver(game.countryEconomies[player].treasury)} · 属州{" "}
                {count(Object.values(game.ownerByStateId).filter((id) => id === player).length)} 个 · 人口{" "}
                {count(Object.entries(game.stateEconomies).reduce(
                  (sum, [id, state]) => sum + (game.ownerByStateId[id] === player ? state.population : 0),
                  0,
                ))} 人
              </p>
            </div>
          </section>
        )}
        <div className="workspace">
          <section className="panel map-panel">
            <header className="panel-header">
              <h2>世界政区图</h2>
              <span>点选州 · 滚轮缩放 · 拖动平移</span>
            </header>
            <StateMap
              scenario={scenario}
              geometry={geometry}
              game={game}
              selectedId={site}
              onSelect={setSelected}
            />
            <div className="legend">
              <span>
                <i className="swatch" style={{ background: "#d1dbdd" }} />
                未分配
              </span>
              {site && (
                <span>
                  <i
                    className="swatch"
                    style={{ background: owner ? scenario.countries[owner].color : "#d1dbdd" }}
                  />
                  {atlas[site].name} · {owner ? scenario.countries[owner].name : "未分配"}
                </span>
              )}
              <span>
                地图改编自 <a href="https://www.mapchart.net/victoria-3.html">MapChart</a>
                {" · "}<a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a>
              </span>
            </div>
          </section>
          <aside className="sidebar">
            <section className="panel">
              <header className="panel-header">
                <h2>{player ? "玩家国家" : "选择国家"}</h2>
              </header>
              <div className="control-block">
                {player ? (
                  <>
                    <strong>{scenario.countries[player].name}</strong>
                    <nav>
                      <a href="#economy-title">经济与人口</a> · <a href="#politics-title">政治与科技</a> ·{" "}
                      <a href="#diplomacy-title">外交与战争</a>
                    </nav>
                  </>
                ) : (
                  <>
                    <select aria-label="开局国家" value={choice} onChange={(e) => setChoice(e.target.value)}>
                      {countries.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    <button
                      className="build"
                      disabled={busy}
                      onClick={() => {
                        setSelected(null);
                        send({ type: "selectCountry", countryId: choice });
                      }}
                    >
                      开始执政
                    </button>
                  </>
                )}
              </div>
            </section>
            <section className="panel">
              <header className="panel-header">
                <h2>查找州</h2>
              </header>
              <div className="control-block">
                <input
                  aria-label="筛选州"
                  placeholder="州名、ID 或国家"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <select
                  aria-label="查看州"
                  value={site && matches.some(([id]) => id === site) ? site : ""}
                  onChange={(e) => setSelected(e.target.value || null)}
                >
                  <option value="">{matches.length} 个匹配州</option>
                  {matches.map(([id, s]) => (
                    <option key={id} value={id}>
                      {s.name} · {scenario.countries[game.ownerByStateId[id]]?.name ?? "未分配"}
                    </option>
                  ))}
                </select>
                {site && (
                  <p aria-live="polite">
                    <strong>{atlas[site].name}</strong> · {owner ? scenario.countries[owner].name : "未分配"}
                    {!owner && " · 无国家市场"}
                  </p>
                )}
              </div>
            </section>
            <section className="panel">
              <header className="panel-header">
                <h2>本地存档</h2>
              </header>
              <div className="save-controls">
                <button disabled={!player || locked} onClick={() => void slot("save")}>
                  存档
                </button>
                <button disabled={locked} onClick={() => void slot("load")}>
                  读档
                </button>
              </div>
              <p role="status" className="save-notice">
                {notice}
              </p>
            </section>
          </aside>
        </div>
        {player && (
          <>
            <EconomyPanel
              scenario={scenario}
              game={game}
              playerId={player}
              selectedId={owner ? site : null}
              report={report}
              busy={locked || finished}
              send={send}
            />
            <PoliticsPanel game={game} playerId={player} busy={locked || finished} send={send} />
            <DiplomacyPanel
              scenario={scenario}
              game={game}
              playerId={player}
              report={report}
              busy={locked || finished}
              send={send}
              selectedId={owner ? site : null}
            />
          </>
        )}
      </main>
    </>
  );
}
