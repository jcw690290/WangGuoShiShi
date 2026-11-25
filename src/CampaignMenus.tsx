import { useEffect, useRef, useState } from "react";
import { count, silver } from "./format.ts";
import { difficultyNames } from "./game/settings.ts";
import { defaultEndYear, guideSteps } from "./game/campaign.ts";
import type { Campaign, EndingRecord } from "./game/campaign.ts";
import { listAchievements, listEndings } from "./game/storage.ts";
import { achievementCatalog, achievementKey } from "./game/achievements.ts";
import type { AchievementRecord } from "./game/achievements.ts";
import { endingCatalog, endingStory, endingTitle } from "./scenario/endings.ts";
import type { Scenario } from "./scenario/scenario.ts";

export function StartMenu({ saveCount, busy, hasCurrent, newGame, resume, gallery, returnToGame, notice }: {
  saveCount: number | null;
  busy: boolean;
  hasCurrent: boolean;
  newGame: (tutorial: boolean) => void;
  resume: () => void;
  gallery: () => void;
  returnToGame: () => void;
  notice: string;
}) {
  return <section className="launcher" aria-labelledby="launcher-title">
    <h1 id="launcher-title">万国史诗</h1>
    <p>1820–{defaultEndYear}</p>
    <div className="launcher-actions">
      <button className="advance" onClick={() => newGame(false)} disabled={busy}>新游戏</button>
      <button className="menu-button" onClick={resume} disabled={busy || !saveCount}>继续游戏</button>
      <button className="menu-button" onClick={() => newGame(true)} disabled={busy}>新手模式</button>
      <button className="menu-button" onClick={gallery} disabled={busy}>结局</button>
    </div>
    {saveCount === 0 && <small>暂无存档</small>}
    {saveCount === null && !notice && <small>正在检查存档</small>}
    {hasCurrent && <button className="launcher-secondary" onClick={returnToGame}>返回当前战役</button>}
    {notice && <p role="status">{notice}</p>}
  </section>;
}

export function EndingsGallery({ scenario, close }: { scenario: Scenario; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [records, setRecords] = useState<EndingRecord[] | null>(null);
  const [achievements, setAchievements] = useState<AchievementRecord[] | null>(null);
  const [error, setError] = useState("");
  const [achievementError, setAchievementError] = useState("");
  const [country, setCountry] = useState(Object.keys(endingCatalog)[0]);
  const story = endingCatalog[country];
  useEffect(() => {
    dialog.current!.showModal();
    let cancelled = false;
    void listEndings().then(
      (rows) => { if (!cancelled) setRecords(rows); },
      (cause: unknown) => { if (!cancelled) setError("结局读取失败 · " + String(cause)); },
    );
    void listAchievements().then(
      (rows) => { if (!cancelled) setAchievements(rows); },
      (cause: unknown) => { if (!cancelled) setAchievementError("成就读取失败 · " + String(cause)); },
    );
    return () => { cancelled = true; };
  }, []);
  return <dialog className="online-dialog ending-gallery" ref={dialog} onClose={close} aria-labelledby="gallery-title">
    <header className="room-heading">
      <h2 id="gallery-title">结局与成就</h2>
      <button className="close-menu" aria-label="关闭结局与成就" onClick={() => dialog.current!.close()}>×</button>
    </header>
    <section>
      <h3>已结算战役</h3>
      {error ? <p role="alert">{error}</p> : records === null ? <p>正在读取记录</p>
        : records.length === 0 ? <p>暂无结局记录</p>
        : <ul className="ending-records">{records.map((record) => <li key={record.campaignId}>
          <strong>{endingTitle(record)}</strong>
          <p>{scenario.countries[record.countryId]?.name ?? record.countryId} · {record.date} · {difficultyNames[record.difficulty]}</p>
          <small>国库 {silver(record.treasury)} · 属州 {count(record.stateCount)} · 人口 {count(record.population)}</small>
          {endingStory(record) && <p>{endingStory(record)}</p>}
        </li>)}</ul>}
    </section>
    <section>
      <h3>战役成就</h3>
      {achievementError ? <p role="alert">{achievementError}</p> : achievements === null ? <p>正在读取成就</p>
        : achievements.length === 0 ? <p>暂无已解锁成就</p>
        : <ul className="ending-records">{achievements.map((record) => <li key={achievementKey(record)}>
          <strong>{achievementCatalog[record.id].title}</strong>
          <p>{scenario.countries[record.countryId]?.name ?? record.countryId} · {record.date} · {difficultyNames[record.difficulty]}</p>
        </li>)}</ul>}
      <details>
        <summary>成就条件</summary>
        <dl>{Object.entries(achievementCatalog).map(([id, milestone]) => <div key={id}>
          <dt>{milestone.title}</dt><dd>{milestone.condition}</dd>
        </div>)}</dl>
      </details>
    </section>
    <section>
      <h3>国家结局条件</h3>
      <select aria-label="查看国家结局" value={country} onChange={(event) => setCountry(event.target.value)}>
        {Object.entries(endingCatalog).map(([id, entry]) => <option key={id} value={id}>{entry.name}</option>)}
      </select>
      <dl>
        <dt>{story.victory.title}</dt><dd>{story.victory.conditions}</dd>
        <dt>{story.defeat.title}</dt><dd>{story.defeat.conditions}</dd>
      </dl>
      <details>
        <summary>指标释义</summary>
        <p>G 人均产出增长，SOL 生活水平，LIT 识字率，TUR 动乱，LEG 合法性，U 失业率。</p>
        <p>IND 工业增加值占比，TRADE 贸易占比，GOV 治理覆盖，CORE 开局核心控制，SUP 陆军补给，ARM 有效陆军倍数，SEA 海运完成率，NEWCUL 新增亲近州，PUP 傀儡控制，FISCAL_RUIN 财政崩溃。</p>
      </details>
      <p><strong>民生典范</strong> · 高生活水平、识字率、基本消费满足率与可持续财政连续保持 5 年。</p>
      <small>终局按已接入的指标判定。地方动乱、治理覆盖、完整消费篮子及部分制度指标待接入。</small>
    </section>
  </dialog>;
}

export function TutorialGuide({ campaign, skip }: { campaign: Campaign; skip: () => void }) {
  const current = guideSteps[campaign.guideStep];
  return <aside className="tutorial-guide" aria-label="新手教程">
    {!campaign.guideSkipped && current && <>
      <p><strong>{campaign.guideStep + 1}/{guideSteps.length} {current[0]}</strong> {current[1]}</p>
      <button className="menu-button" onClick={skip}>跳过教程</button>
    </>}
    <details>
      <summary>{campaign.guideStep === guideSteps.length ? "教程完成 · 回看" : "回看教程"}</summary>
      <ol>{guideSteps.map(([title, text]) => <li key={title}><strong>{title}</strong> {text}</li>)}</ol>
    </details>
  </aside>;
}
