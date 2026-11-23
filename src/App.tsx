import { useEffect, useMemo, useRef, useState } from "react";
import { DiplomacyPanel } from "./DiplomacyPanel.tsx";
import { EconomyPanel } from "./EconomyPanel.tsx";
import { PoliticsPanel } from "./PoliticsPanel.tsx";
import { count, silver } from "./format.ts";
import { projectEconomy } from "./game/economy.ts";
import { createGame, dispatch, getGameDate, isScenarioFinished, spanDays } from "./game/engine.ts";
import type { GameCommand, Span } from "./game/engine.ts";
import { planWar } from "./game/diplomacy.ts";
import { loadGame, saveGame } from "./game/storage.ts";
import { CLAIM_COST, claimError } from "./game/territory.ts";
import { StateMap } from "./map/StateMap.tsx";
import { capitals } from "./map/capitals.ts";
import { countryColor } from "./map/cartography.ts";
import type { StateGeometry } from "./map/geometry.ts";
import { RoomDialog, useOnlineRoom } from "./online/RoomDialog.tsx";
import type { Speed } from "./online/protocol.ts";
import { atlas } from "./scenario/scenario.ts";
import type { Scenario } from "./scenario/scenario.ts";

const dateFormat = new Intl.DateTimeFormat("zh-CN", { dateStyle: "long", timeZone: "UTC" });
export function App({ scenario, geometry }: { scenario: Scenario; geometry: StateGeometry }) {
  const [soloGame, setGame] = useState(() => createGame(scenario)),
    [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const countries = Object.values(scenario.countries),
    [choice, setChoice] = useState(countries[0].id);
  const [span, setSpan] = useState<Span>("week"),
    [until, setUntil] = useState<number | null>(null);
  const menu = useRef<HTMLDialogElement>(null);
  const roomDialog = useRef<HTMLDialogElement>(null);
  const online = useOnlineRoom(scenario, () => {
    setUntil(null);
    setSelected(null);
    setNotice("");
    setCommandId(null);
  });
  const { view, connection } = online;
  const [commandId, setCommandId] = useState<number | null>(null);
  const [onlineSpeed, setOnlineSpeed] = useState<Speed>(2000);
  const onlineCountry = view?.room.members.find((member) => member.user === connection!.user)?.country;
  const game = useMemo(() => {
    return view?.game ? { ...view.game, playerCountryId: onlineCountry! } : soloGame;
  }, [view?.game, onlineCountry, soloGame]);
  const onlinePlaying = view?.room.status === "playing";
  const canDrive = onlinePlaying && view.leased && !view.error;
  const tabs = ["经济与人口", "政治与科技", "外交与战争"] as const;
  const [tab, setTab] = useState<number>(0);
  const [search, setSearch] = useState("");
  const finished = (!connection || onlinePlaying) && isScenarioFinished(scenario, game),
    running = !finished && (onlinePlaying
      ? view.room.hostOnline && view.room.speed > 0
      : !connection && until !== null && game.elapsedDays < until),
    locked = connection
      ? online.busy || commandId !== null || !view?.room.hostOnline || Boolean(view.error)
      : busy || running,
    player = connection ? onlineCountry ?? null : game.playerCountryId;
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
        (id + " " + s.name + " " + (scenario.countries[game.ownerByStateId[id]]?.name ?? "无主领土"))
          .toLowerCase()
          .includes(search.trim().toLowerCase()),
      ),
    [search, game.ownerByStateId, scenario],
  );
  const date = getGameDate(scenario, game);
  const dateISO = date.toISOString().slice(0, 10);
  function send(cmd: GameCommand) {
    if (connection) {
      void online.act(async () => {
        setNotice("等待房主确认指令…");
        try {
          setCommandId(await connection.submit(cmd));
        } catch (error) {
          setNotice("");
          throw error;
        }
      });
      return;
    }
    setGame((previous) => dispatch(scenario, previous, cmd));
  }
  const commandResult = view?.room.results.find((result) => result.id === commandId);
  useEffect(() => {
    if (!commandResult) return;
    setNotice(commandResult.error ? "指令未执行 · " + commandResult.error : "指令已执行");
    setCommandId(null);
  }, [commandResult]);
  useEffect(() => {
    if (!connection) {
      setSelected(null);
      setCommandId(null);
      setNotice("");
    }
  }, [connection]);
  useEffect(() => {
    if (!running || connection) return;
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
  }, [running, until, span, game.elapsedDays, scenario, connection]);
  useEffect(() => {
    if (finished && !menu.current!.open) menu.current!.showModal();
  }, [finished]);
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
          <div className="brand"><span className="seal" aria-hidden="true">万</span>万国史诗</div>
          <div className="time-controls">
            {connection ? (
              <>
                <span className="paused">{!onlinePlaying ? "联机房间" : !view.room.hostOnline ? "房主离线" : running ? "推进中" : "已暂停"}</span>
                {onlinePlaying && <time dateTime={dateISO}>{dateFormat.format(date)}</time>}
                {canDrive && (
                  <>
                    <select
                      aria-label="联机推进速度"
                      disabled={online.busy || finished}
                      value={view.room.speed || onlineSpeed}
                      onChange={(event) => {
                        const speed = Number(event.target.value) as Speed;
                        setOnlineSpeed(speed);
                        if (running) void online.act(() => connection.setSpeed(speed));
                      }}
                    >
                      <option value={4000}>4 秒／天</option>
                      <option value={2000}>2 秒／天</option>
                      <option value={1000}>1 秒／天</option>
                    </select>
                    <button className="advance" disabled={online.busy || finished} onClick={() => {
                      void online.act(() => connection.setSpeed(running ? 0 : onlineSpeed));
                    }}>{running ? "暂停" : "继续"}</button>
                  </>
                )}
              </>
            ) : <>
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
            </>}
          </div>
          <div className="header-menus">
            <button className="menu-entry" aria-haspopup="dialog" onClick={() => roomDialog.current!.showModal()}>联机</button>
            <button className="menu-entry" aria-haspopup="dialog" onClick={() => menu.current!.showModal()}>政务菜单</button>
          </div>
        </div>
      </header>
      <main className="map-workspace">
        <StateMap scenario={scenario} geometry={geometry} game={game}
          selectedId={player ? selected : null} preview={player ? null : choice} onSelect={setSelected} />
        {!player && !connection && <aside className="country-picker">
          <h1>选择国家</h1>
          <div className="country-choices">
            {countries.map(c => <button key={c.id} aria-pressed={c.id === choice}
              onClick={() => setChoice(c.id)}>
              <i className="swatch" style={{ background: countryColor(c) }} />{c.name}
            </button>)}
          </div>
          <footer><small>首府 · {capitals[choice].name}</small>
            <button className="advance" disabled={busy} onClick={() => {
              setSelected(null); send({ type: "selectCountry", countryId: choice });
            }}>开始执政</button>
          </footer>
        </aside>}
        {player && (!connection || onlinePlaying) && selected && <button className="site-chip" onClick={() => {
          setTab(0); menu.current!.showModal();
        }}>{atlas[selected].name} · {owner ? scenario.countries[owner].name : "无主领土"} ›</button>}
      </main>
      <RoomDialog scenario={scenario} online={online} dialog={roomDialog} />
      <dialog className="government" ref={menu} aria-label="政务菜单">
        <header className="menu-tabs">
          {tabs.map((title, i) => <button key={title} aria-pressed={tab === i}
            onClick={() => setTab(i)}>{title}</button>)}
          {!connection && <div className="slot-actions" role="group" aria-label="本地存档">
            <button disabled={!player || locked} onClick={() => void slot("save")}>存档</button>
            <button disabled={locked} onClick={() => void slot("load")}>读档</button>
          </div>}
          <button className="close-menu" aria-label="关闭菜单" onClick={() => menu.current!.close()}>×</button>
        </header>
        <p role="status" className="save-notice">{online.error || notice}</p>
        <div className="menu-body">
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
          {player && (!connection || onlinePlaying) ? <>
            {tab === 0 && <EconomyPanel
              scenario={scenario}
              game={game}
              playerId={player}
              selectedId={owner ? site : null}
              report={report}
              busy={locked || finished}
              send={send}
            />}
            {tab === 1 && <PoliticsPanel game={game} playerId={player} busy={locked || finished} send={send} />}
            {tab === 2 && <DiplomacyPanel
              scenario={scenario}
              game={game}
              playerId={player}
              report={report}
              busy={locked || finished}
              send={send}
              selectedId={owner ? site : null}
            />}
          </> : <p>选择国家并开始执政后可查看各项政务。</p>}
          <div className="menu-tools">
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
                      {s.name} · {scenario.countries[game.ownerByStateId[id]]?.name ?? "无主领土"}
                    </option>
                  ))}
                </select>
                {site && (
                  <p aria-live="polite">
                    <strong>{atlas[site].name}</strong> · {owner ? scenario.countries[owner].name : "无主领土"}
                    {!owner && " · 占领后加入本国市场"}
                  </p>
                )}
                {site && !owner && (
                  <div className="claim-territory">
                    <p>无主领土可直接占领，无需宣战。一次支付 {silver(CLAIM_COST)}，立即获得州归属、人口和建设权限。</p>
                    <button
                      className="build"
                      disabled={locked || finished || Boolean(claimError(scenario, game, site))}
                      onClick={() => {
                        send({ type: "claimState", stateId: site });
                        if (!connection) setNotice(`已占领 ${atlas[site].name} · 支出 ${silver(CLAIM_COST)}`);
                      }}
                    >
                      占领 {atlas[site].name}
                    </button>
                    <p role="status">{finished ? "剧本已结束" : claimError(scenario, game, site) ?? "可占领 · 不限制接壤或跨海"}</p>
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
      </dialog>
    </>
  );
}
