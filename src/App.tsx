import { useEffect, useMemo, useRef, useState } from "react";
import { defaultMaxTickRate, DeveloperPanel } from "./DeveloperPanel.tsx";
import { EndingsGallery, StartMenu, TutorialGuide } from "./CampaignMenus.tsx";
import { DiplomacyPanel } from "./DiplomacyPanel.tsx";
import { EconomyPanel } from "./EconomyPanel.tsx";
import { PoliticsPanel } from "./PoliticsPanel.tsx";
import { count, silver } from "./format.ts";
import { projectEconomy } from "./game/economy.ts";
import { campaignEndDate, createGame, dispatch, elapsedTicks, getGameDate, isScenarioFinished, spanDays, TICKS_PER_DAY } from "./game/engine.ts";
import type { GameCommand, Span } from "./game/engine.ts";
import { planWar, settlementChallengeError } from "./game/diplomacy.ts";
import { archiveAchievements, archiveEnding, autoSaveSlot, autoSaveSlots, listGameSaves, loadGame, loadRecentGame, manualSaveSlots, saveGame, saveSlotSchema } from "./game/storage.ts";
import type { SaveSlot, SaveSummary } from "./game/storage.ts";
import { difficultyLevels, difficultyNames, difficultySchema } from "./game/settings.ts";
import type { Difficulty } from "./game/settings.ts";
import { canSettleVictory, completeGuideStep, defaultEndYear, endYearSchema } from "./game/campaign.ts";
import { CLAIM_COST, claimError, settlementAt, settlementContested, territorialClaimError, territoryType } from "./game/territory.ts";
import { StateMap } from "./map/StateMap.tsx";
import { capitals } from "./map/capitals.ts";
import { countryColor } from "./map/cartography.ts";
import type { StateGeometry } from "./map/geometry.ts";
import { RoomDialog, useOnlineRoom } from "./online/RoomDialog.tsx";
import type { Speed } from "./online/protocol.ts";
import { atlas } from "./scenario/scenario.ts";
import type { Scenario } from "./scenario/scenario.ts";
import { endingStory, endingTitle } from "./scenario/endings.ts";
import { countryDisplayName } from "./game/constitution.ts";

const dateFormat = new Intl.DateTimeFormat("zh-CN", { dateStyle: "long", timeZone: "UTC" });
const tickRates = [1, 2, 4, 8];
const periods = ["00:00", "06:00", "12:00", "18:00"];
function DifficultyOptions() {
  return difficultyLevels.map((level) => <option key={level} value={level}>{difficultyNames[level]}</option>);
}
export function App({ scenario, geometry, initialSaves, initialSaveNotice }: {
  scenario: Scenario;
  geometry: StateGeometry;
  initialSaves: SaveSummary[] | null;
  initialSaveNotice: string;
}) {
  const [opening] = useState(() => createGame(scenario));
  const [soloGame, setGame] = useState(opening),
    [selected, setSelected] = useState<string | null>(null);
  const [screen, setScreen] = useState<"menu" | "new" | "tutorial" | "play">("menu");
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [mapLayer, setMapLayer] = useState<"owner" | "controller">("owner");
  const [governmentOpen, setGovernmentOpen] = useState(false);
  const [endYear, setEndYear] = useState(String(defaultEndYear));
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(initialSaveNotice);
  const [saves, setSaves] = useState<SaveSummary[] | null>(initialSaves);
  const [activeSlot, setActiveSlot] = useState<SaveSlot>("local");
  const savedMonth = useRef(0);
  const countries = Object.values(scenario.countries).filter((country) => country.selectable !== false),
    backgroundCountries = Object.values(scenario.countries).filter((country) => country.selectable === false),
    [choice, setChoice] = useState(countries[0].id);
  const [openingDifficulty, setOpeningDifficulty] = useState<Difficulty>("relaxed");
  const [span, setSpan] = useState<Span | "continuous">("continuous"),
    [until, setUntil] = useState<number | null>(null);
  const [speed, setSpeed] = useState(2);
  const [maxTickRate, setMaxTickRate] = useState(defaultMaxTickRate);
  const [developerOpen, setDeveloperOpen] = useState(false);
  const logoClicks = useRef({ count: 0, time: -Infinity });
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
  const canDrive = onlinePlaying && view.room.hostOnline && view.leased && !view.error;
  const tabs = ["经济与人口", "政治与科技", "外交与战争"] as const;
  const [tab, setTab] = useState<number>(0);
  const [search, setSearch] = useState("");
  const finished = (onlinePlaying || (!connection && screen === "play")) && isScenarioFinished(scenario, game),
    running = !finished && (onlinePlaying
      ? view.room.hostOnline && view.room.speed > 0
      : !connection && screen === "play" && until !== null && elapsedTicks(game) < until),
    locked = connection
      ? online.busy || commandId !== null || !view?.room.hostOnline || Boolean(view.error)
      : busy || running,
    player = connection ? onlineCountry ?? null : screen === "play" ? game.playerCountryId : null;
  const site =
    selected ??
    (player
      ? (Object.keys(game.ownerByStateId).find((id) => game.ownerByStateId[id] === player) ?? null)
      : null);
  const owner = site ? game.ownerByStateId[site] : null;
  const unownedLabels = { UNCLAIMED: "无主地区", LOCAL_POLITY: "地方势力", STATE_OWNED: "国家领土" };
  const selectedTerritory = site ? territoryType(scenario, game, site) : null;
  const settlement = site ? settlementAt(game, site) : undefined;
  const settlementBlock = site && player && !owner && !settlement ? claimError(scenario, game, site, player) : undefined;
  const claims = site ? (game.territorialClaims ?? []).filter((claim) => claim.stateId === site) : [];
  const hasClaim = claims.some((claim) => claim.claimantId === player);
  const challenge = player && site && hasClaim && settlement && settlement.countryId !== player ?
    { type: "challengeTerritorialSettlement" as const, countryId: player, stateId: site } : null;
  const declaration = player && site && owner !== player ? {
    type: hasClaim ? "renounceTerritorialClaim" as const : "declareTerritorialClaim" as const,
    countryId: player, stateId: site,
  } : null;
  const countryNames = useMemo(() => Object.fromEntries(Object.entries(scenario.countries)
    .map(([id, country]) => [id, countryDisplayName(country, game.nations[id])])), [scenario.countries, game.nations]);
  const occupation = game.occupation;
  const actualController = occupation?.stateId === site ? occupation.controllerId : null;
  const mapOwners = useMemo(() => mapLayer === "controller" && occupation
    ? { ...game.ownerByStateId, [occupation.stateId]: occupation.controllerId }
    : game.ownerByStateId, [mapLayer, game.ownerByStateId, occupation]);
  const report = useMemo(
    () => governmentOpen ? game.lastEconomy ?? projectEconomy(game, planWar(scenario, game), scenario) : null,
    [governmentOpen, game.lastEconomy, game.ownerByStateId, game.countryEconomies, game.stateEconomies,
      game.nations, game.societies, game.borderDispute, scenario],
  );
  const matches = useMemo(
    () =>
      Object.entries(atlas).filter(([id, s]) =>
        (id + " " + s.name + " " + (countryNames[game.ownerByStateId[id]] ?? "无主领土"))
          .toLowerCase()
          .includes(search.trim().toLowerCase()),
      ),
    [search, game.ownerByStateId, countryNames],
  );
  const date = getGameDate(scenario, game);
  const dateISO = date.toISOString().slice(0, 10);
  const ending = game.campaign?.ending;
  const achievements = game.campaign?.achievements?.records;
  const deadline = campaignEndDate(scenario, game);
  const picker = !connection && (screen === "new" || screen === "tutorial");
  function markGuide(step: number) {
    if (!connection) setGame((state) => completeGuideStep(state, step));
  }
  function openGovernment(nextTab = tab) {
    setTab(nextTab);
    setGovernmentOpen(true);
    if (nextTab === 0) markGuide(1);
  }
  function launch(tutorial: boolean) {
    setNotice("");
    setOpeningDifficulty("relaxed");
    setEndYear(String(defaultEndYear));
    if (tutorial && Object.hasOwn(scenario.countries, "country_12")) setChoice("country_12");
    setScreen(tutorial ? "tutorial" : "new");
  }
  function startNewGame() {
    const year = endYearSchema.parse(Number(endYear));
    if (soloGame.playerCountryId && !window.confirm("开始新局会替换当前内存进度。已有存档可以继续读取。")) return;
    savedMonth.current = 0;
    setUntil(null);
    setSelected(null);
    setGame(dispatch(scenario, createGame(scenario, undefined, openingDifficulty, {
      id: crypto.randomUUID(), endYear: year, tutorialEnabled: screen === "tutorial",
    }), { type: "selectCountry", countryId: choice }));
    setScreen("play");
  }
  function showStartMenu() {
    setUntil(null);
    setNotice("");
    menu.current!.close();
    setScreen("menu");
    void listGameSaves().then(setSaves, (error: unknown) => setNotice("无法读取存档列表 · " + String(error)));
  }
  function clickLogo(time: number) {
    if (connection) return;
    const count = time - logoClicks.current.time <= 1200 ? logoClicks.current.count + 1 : 1;
    logoClicks.current = { count, time };
    if (count !== 5) return;
    logoClicks.current = { count: 0, time: -Infinity };
    setUntil(null);
    setDeveloperOpen(true);
  }
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
    setGame((previous) => {
      const next = dispatch(scenario, previous, cmd);
      return cmd.type === "queueConstruction" ? completeGuideStep(completeGuideStep(next, 3), 7) : next;
    });
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
    }
  }, [connection]);
  useEffect(() => {
    if (connection || !running || until === null) return;
    const timer = setInterval(() => {
      if (document.hidden) return;
      setGame((previous) => elapsedTicks(previous) < until
        ? dispatch(scenario, previous, { type: "advanceTick" })
        : previous);
    }, 1000 / (speed === 5 ? maxTickRate : speed));
    return () => clearInterval(timer);
  }, [running, until, speed, maxTickRate, scenario, connection]);
  useEffect(() => {
    function pauseHiddenGame() {
      if (document.hidden) setUntil(null);
    }
    document.addEventListener("visibilitychange", pauseHiddenGame);
    return () => document.removeEventListener("visibilitychange", pauseHiddenGame);
  }, []);
  useEffect(() => {
    if (finished) setGovernmentOpen(true);
  }, [finished]);
  useEffect(() => {
    if (governmentOpen && !menu.current!.open) menu.current!.showModal();
  }, [governmentOpen]);
  useEffect(() => {
    if (!connection && screen === "play" && ending)
      void archiveEnding(ending).catch((error: unknown) => setNotice("结局归档失败 · " + String(error)));
  }, [connection, ending, screen]);
  useEffect(() => {
    if (!connection && screen === "play" && achievements?.length)
      void archiveAchievements(achievements).catch((error: unknown) => setNotice("成就归档失败 · " + String(error)));
  }, [connection, achievements, screen]);
  const guideWeek = soloGame.campaign?.guideWeek;
  const guideStep = soloGame.campaign?.tutorialEnabled && !soloGame.campaign.guideSkipped ? soloGame.campaign.guideStep : null;
  const currentWeek = Math.floor(soloGame.elapsedDays / 7);
  const hasAdvanced = elapsedTicks(soloGame) > 0;
  useEffect(() => {
    if (!connection && screen === "play" && guideStep === 0 && !running && hasAdvanced)
      setGame((state) => completeGuideStep(state, 0));
  }, [connection, screen, guideStep, running, hasAdvanced]);
  useEffect(() => {
    if (connection || screen !== "play" || guideStep !== 4 || guideWeek == null || currentWeek <= guideWeek) return;
    setUntil(null);
    setGame((state) => completeGuideStep(state, 4));
  }, [connection, screen, guideStep, guideWeek, currentWeek]);
  const populationDay = soloGame.lastPopulation?.day ?? 0;
  useEffect(() => {
    if (connection || !soloGame.playerCountryId || populationDay <= savedMonth.current) return;
    savedMonth.current = populationDay;
    const slot = autoSaveSlot(getGameDate(scenario, { ...soloGame, elapsedDays: populationDay }));
    void saveGame(scenario, soloGame, slot, true).then(
      (summary) => setSaves((entries) => [summary, ...(entries ?? []).filter((entry) => entry.slot !== slot)]),
      (error: unknown) => setNotice("自动存档失败 · " + String(error)),
    );
  }, [connection, populationDay, scenario, soloGame]);

  async function slot(action: "save" | "load" | "recent") {
    setBusy(true);
    try {
      if (action === "save") {
        const entries = await listGameSaves();
        const existing = entries.find((entry) => entry.slot === activeSlot);
        if (existing && !window.confirm(`覆盖此手动档（${existing.date ?? "旧存档"}）？`)) return;
        const summary = await saveGame(scenario, game, activeSlot, existing !== undefined);
        setSaves([summary, ...entries.filter((entry) => entry.slot !== activeSlot)]);
        setNotice("已存档 · " + dateFormat.format(date));
      } else {
        const result = action === "recent"
          ? await loadRecentGame(scenario)
          : { state: await loadGame(scenario, activeSlot), slot: activeSlot, skipped: 0 };
        if (result?.state) {
          savedMonth.current = result.state.lastPopulation?.day ?? 0;
          setActiveSlot(result.slot);
          setGame(result.state);
          setUntil(null);
          setSelected(null);
          setScreen("play");
          setNotice((result.skipped ? "已跳过损坏存档 · " : "") + "已读档 · " + dateFormat.format(getGameDate(scenario, result.state)));
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
  function saveSlotOptions(slots: readonly SaveSlot[], label: string) {
    return slots.map((id, index) => {
      const summary = saves?.find((entry) => entry.slot === id);
      const nation = summary?.countryId ? scenario.countries[summary.countryId]?.name : undefined;
      const detail = summary ? [nation, summary.date ?? "旧存档"].filter(Boolean).join(" ") : "空";
      return <option key={id} value={id}>{label} {index + 1} · {detail}</option>;
    });
  }
  return (
    <>
      <header className="masthead">
        <div className="masthead-inner">
          <button type="button" className="brand" onClick={(event) => clickLogo(event.timeStamp)}>
            <span className="seal" aria-hidden="true">万</span>万国史诗
          </button>
          {(connection || player) && <div className={connection ? "time-controls online-time-controls" : "time-controls"}>
            {connection ? (
              <>
                <span className="paused online-status" role="status">{view?.error ? "同步中断" : !onlinePlaying ? "联机房间" : !view.room.hostOnline ? "房主离线" : running ? "推进中" : "已暂停"}</span>
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
            <time dateTime={dateISO + "T" + periods[game.tickInDay]}>{dateFormat.format(date)} {periods[game.tickInDay]}</time>
            <select aria-label="单机推进速度" value={speed} disabled={finished}
              onChange={(event) => setSpeed(Number(event.target.value))}>
              {tickRates.map((rate) => <option key={rate} value={rate}>{rate} tick／秒</option>)}
              <option value={5}>{maxTickRate} tick／秒</option>
            </select>
            <select
              aria-label="推进跨度"
              value={span}
              disabled={locked || finished}
              onChange={(e) => setSpan(e.target.value as Span | "continuous")}
            >
              <option value="continuous">持续推进</option>
              <option value="day">一天</option>
              <option value="week">一周</option>
              <option value="halfYear">半年</option>
            </select>
            <button
              className="advance"
              disabled={!player || busy || finished}
              onClick={() => {
                if (running && elapsedTicks(game) > 0) markGuide(0);
                setUntil(running ? null : span === "continuous"
                  ? Infinity
                  : elapsedTicks(game) + TICKS_PER_DAY * spanDays(scenario, game, span));
              }}
            >
              {running ? "暂停" : "继续"}
            </button>
            </>}
          </div>}
          <div className="header-menus">
            <button className="menu-entry" aria-haspopup="dialog" onClick={() => roomDialog.current!.showModal()}>联机</button>
            {(connection || player) && <button className="menu-entry" aria-haspopup="dialog" onClick={() => openGovernment()}>政务菜单</button>}
          </div>
        </div>
      </header>
      <main className="map-workspace">
        <StateMap scenario={scenario} geometry={geometry} game={connection || player ? game : opening}
          owners={connection || player ? mapOwners : opening.ownerByStateId}
          selectedId={player ? selected : null} preview={picker ? choice : null} onSelect={setSelected} />
        {player && <div className="map-layers" role="group" aria-label="地图图层">
          <button className="menu-button" aria-pressed={mapLayer === "owner"} onClick={() => setMapLayer("owner")}>正式归属</button>
          <button className="menu-button" aria-pressed={mapLayer === "controller"} onClick={() => setMapLayer("controller")}>实际控制</button>
        </div>}
        {!connection && screen === "menu" && <StartMenu saveCount={saves?.length ?? null} busy={busy}
          hasCurrent={soloGame.playerCountryId !== null} newGame={launch} resume={() => void slot("recent")}
          gallery={() => setGalleryOpen(true)} returnToGame={() => setScreen("play")} notice={notice} />}
        {picker && <aside className="country-picker">
          <h1>选择国家</h1>
          {screen === "tutorial" && <p className="country-tip">推荐从瑞士或巴伐利亚开始。</p>}
          <div className="country-choices">
            {countries.map(c => <button key={c.id} aria-pressed={c.id === choice}
              onClick={() => setChoice(c.id)}>
              <i className="swatch" style={{ background: countryColor(c) }} />{c.name}
            </button>)}
          </div>
          <footer>
            <small>首府 · {capitals[choice].name}</small>
            {backgroundCountries.length > 0 && <small>背景势力（不可选） · {backgroundCountries.map(({ name }) => name).join("、")}</small>}
            <label>难度
              <select aria-label="开局难度" value={openingDifficulty}
                onChange={(event) => setOpeningDifficulty(difficultySchema.parse(event.target.value))}>
                <DifficultyOptions />
              </select>
            </label>
            <label>终局年份
              <input type="number" min={1821} max={9999} value={endYear} onChange={(event) => setEndYear(event.target.value)} />
            </label>
            <button className="advance" disabled={busy || !endYearSchema.safeParse(Number(endYear)).success}
              onClick={startNewGame}>开始执政</button>
            <button className="menu-button" onClick={() => setScreen("menu")}>返回主菜单</button>
          </footer>
        </aside>}
        {player && (!connection || onlinePlaying) && selected && <button className="site-chip" onClick={() => {
          if (owner === player) markGuide(2);
          openGovernment(0);
        }}>{atlas[selected].name} · {owner ? countryNames[owner] : "无主领土"}
          {actualController && `（${countryNames[actualController]}控制）`} ›</button>}
        {!connection && screen === "play" && game.campaign?.tutorialEnabled
          && !finished && <TutorialGuide campaign={game.campaign} skip={() => setGame((state) => ({
            ...state, campaign: { ...state.campaign!, guideSkipped: true },
          }))} />}
      </main>
      {galleryOpen && <EndingsGallery scenario={scenario} close={() => setGalleryOpen(false)} />}
      {developerOpen && !connection && <DeveloperPanel maxTickRate={maxTickRate}
        settings={player && !finished ? game.settings : null}
        setMaxTickRate={setMaxTickRate} setTuning={(tuning) => send({ type: "setRuleTuning", tuning })}
        onClose={() => setDeveloperOpen(false)} />}
      <RoomDialog scenario={scenario} online={online} dialog={roomDialog} />
      <dialog className="government" ref={menu} aria-label="政务菜单" onClose={() => setGovernmentOpen(false)}>
        {governmentOpen && <>
        <header className="menu-tabs">
          {tabs.map((title, i) => <button key={title} aria-pressed={tab === i}
            onClick={() => openGovernment(i)}>{title}</button>)}
          {!connection && <div className="slot-actions" role="group" aria-label="本地存档">
            <select aria-label="存档槽" value={activeSlot} disabled={locked || saves === null}
              onChange={(event) => setActiveSlot(saveSlotSchema.parse(event.target.value))}>
              <optgroup label="手动档">{saveSlotOptions(manualSaveSlots, "手动档")}</optgroup>
              <optgroup label="自动档">{saveSlotOptions(autoSaveSlots, "自动档")}</optgroup>
            </select>
            <button disabled={!player || locked || saves === null || !manualSaveSlots.some((id) => id === activeSlot)}
              onClick={() => void slot("save")}>存档</button>
            <button disabled={locked || !saves?.some((entry) => entry.slot === activeSlot)} onClick={() => void slot("load")}>读档</button>
            <button disabled={locked || !saves?.length} onClick={() => void slot("recent")}>最近有效档</button>
          </div>}
          <button className="close-menu" aria-label="关闭菜单" onClick={() => menu.current!.close()}>×</button>
        </header>
        <p role="status" className="save-notice">{online.error || notice}</p>
        <div className="menu-body">
        {!connection && player && <div className="difficulty-control">
          <label>游戏难度
            <select aria-label="游戏难度" value={game.settings.difficulty} disabled={locked || finished}
              onChange={(event) => send({ type: "setDifficulty", difficulty: difficultySchema.parse(event.target.value) })}>
              <DifficultyOptions />
            </select>
          </label>
          <small>本局最低难度 · {difficultyNames[game.settings.lowestDifficulty]}</small>
          {canSettleVictory(game, date) && <button className="advance" onClick={() => send({ type: "settleCampaignVictory" })}>
            结算胜利
          </button>}
          <button className="menu-button" onClick={showStartMenu}>返回主菜单</button>
        </div>}
        {finished && player && (
          <section className="panel scenario-result" aria-labelledby="result-title">
            <header className="panel-header">
              <h2 id="result-title">{ending
                ? endingTitle(ending)
                : dateISO === deadline ? "剧本结束 · 期末结算" : "剧本结束 · 存档实况"}</h2>
            </header>
            <div className="control-block">
              <p role="status">
                {ending?.kind === "extinct"
                  ? "本国已失去最后一个正式拥有的州。"
                  : ending
                  ? `已于 ${ending.date} 结算战役。`
                  : dateISO === deadline
                  ? `已于 ${dateFormat.format(date)} 到达剧本期限。`
                  : `此存档已超过剧本期限，以下为 ${dateFormat.format(date)} 的存档实况。`}
              </p>
              {ending && endingStory(ending) && <p>{endingStory(ending)}</p>}
              {ending?.kind === "neutral" && <p>本局取得 {game.campaign!.achievements?.records.length ?? 0} 项成就。{ending.metrics?.SOL !== undefined &&
                `结算时居民平均生活水平为 ${ending.metrics.SOL.toFixed(1)}。`}</p>}
              {ending && ending.kind !== "extinct" && <button className="advance" onClick={() => {
                setUntil(null);
                send({ type: "continueSandbox" });
                menu.current!.close();
              }}>继续沙盒</button>}
              <p>
                {countryNames[player]} · 国库 {silver(game.countryEconomies[player].treasury)} · 属州{" "}
                {count(Object.values(game.ownerByStateId).filter((id) => id === player).length)} 个 · 人口{" "}
                {count(Object.entries(game.stateEconomies).reduce(
                  (sum, [id, state]) => sum + (game.ownerByStateId[id] === player ? state.population : 0),
                  0,
                ))} 人
              </p>
            </div>
          </section>
        )}
          {player && report && (!connection || onlinePlaying) ? <>
            {tab === 0 && <EconomyPanel
              scenario={scenario}
              game={game}
              playerId={player}
              selectedId={owner ? site : null}
              report={report}
              busy={locked || finished}
              send={send}
              onPopulationOpen={() => markGuide(5)}
            />}
            {tab === 0 && !connection && guideStep === 6 && game.lastEconomy && <button className="menu-button" onClick={() => markGuide(6)}>
              已核对市场缺口
            </button>}
            {tab === 1 && <PoliticsPanel game={game} playerId={player} year={date.getUTCFullYear()} busy={locked || finished} send={send} />}
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
                          {s.name} · {countryNames[game.ownerByStateId[id]] ?? unownedLabels[territoryType(scenario, game, id)]}
                    </option>
                  ))}
                </select>
                {site && (
                  <p aria-live="polite">
                    <strong>{atlas[site].name}</strong> · {owner ? countryNames[owner] : unownedLabels[selectedTerritory!]}
                    {actualController && ` · 实际控制 ${countryNames[actualController]}`}
                  </p>
                )}
                {claims.map((claim) => (
                  <p key={claim.claimantId}>
                    {countryNames[claim.claimantId]}的外交宣称
                    {claim.recognizedBy.length > 0 && ` · 承认方 ${claim.recognizedBy.map((id) => countryNames[id]).join("、")}`}
                  </p>
                ))}
                {declaration && (() => {
                  const reason = territorialClaimError(scenario, game, declaration);
                  return (
                    <button className="build" disabled={locked || finished || reason !== undefined} title={reason}
                      onClick={() => send(declaration)}>
                      {hasClaim ? "撤回本国领土宣称" : "登记领土宣称 · 1 外交影响力"}
                    </button>
                  );
                })()}
                {site && !owner && (
                  <div className="claim-territory">
                    {settlement ? <>
                      <p>{countryNames[settlement.countryId]} · {settlement.mode === "INDIRECT" ? "地方协议" : "移民开发"} ·
                        行政来源 {atlas[settlement.anchorId].name} · 进度 {Math.floor(settlement.progress * 100)}%</p>
                      {game.lastEconomy && <p>上周来源州行政覆盖 {Math.round((game.lastEconomy.states[settlement.anchorId].office?.coverage ?? 0) * 100)}%</p>}
                      <progress aria-label="领土项目进度" max={1} value={settlement.progress} />
                      {settlementContested(game, site) && <p role="status">项目因地区博弈暂停。</p>}
                      {player === settlement.countryId && <button className="build" disabled={locked || finished || settlementContested(game, site)}
                        onClick={() => send({ type: "cancelTerritorialSettlement", countryId: player, stateId: site })}>
                        终止 {atlas[site].name} 项目
                      </button>}
                      {challenge && (() => {
                        const reason = settlementChallengeError(scenario, game, challenge.countryId, challenge.stateId);
                        return <button className="build" disabled={locked || finished || reason !== undefined} title={reason}
                          onClick={() => send(challenge)}>对领土项目提出异议</button>;
                      })()}
                    </> : player && <>
                      <button className="build" disabled={locked || finished || settlementBlock !== undefined} title={settlementBlock}
                        onClick={() => send({ type: "claimState", countryId: player, stateId: site })}>
                        {selectedTerritory === "LOCAL_POLITY" ? "洽谈地方协议" : "启动移民开发"} · {silver(CLAIM_COST)}
                      </button>
                      {settlementBlock && <p role="status">{settlementBlock}</p>}
                    </>}
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
        </>}
      </dialog>
    </>
  );
}
