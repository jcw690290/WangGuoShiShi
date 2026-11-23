import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import type { Scenario } from "../scenario/scenario.ts";
import { onlineConfigured, onlineUser, request } from "./client.ts";
import { RoomConnection } from "./connection.ts";
import type { RoomView } from "./connection.ts";

const lastRoomKey = "wgss-online-room";
const inviteCode = new URLSearchParams(window.location.search).get("room") ?? "";

export function useOnlineRoom(scenario: Scenario, onEnter: () => void) {
  const [connection, setConnection] = useState<RoomConnection | null>(null);
  const [view, setView] = useState<RoomView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => () => connection?.close(), [connection]);
  useEffect(() => {
    if (view) localStorage.setItem(lastRoomKey, view.room.code);
  }, [view?.room.code]);

  async function act(action: () => Promise<void>): Promise<void> {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  function enter(code?: string) {
    return act(async () => {
      const user = await onlineUser();
      const id = z.uuid().parse(await (code === undefined
        ? request("create", {})
        : request("join", { code: code.trim().toUpperCase() })));
      onEnter();
      setView(null);
      setConnection(new RoomConnection(scenario, id, user, setView, setError));
    });
  }

  function leave() {
    return act(async () => {
      try {
        await connection!.leave();
      } finally {
        connection!.close();
        setConnection(null);
        setView(null);
      }
    });
  }

  return { connection, view, error, busy, act, enter, leave };
}

export function RoomDialog({
  scenario,
  online,
  dialog,
}: {
  scenario: Scenario;
  online: ReturnType<typeof useOnlineRoom>;
  dialog: React.RefObject<HTMLDialogElement | null>;
}) {
  const { connection, view, busy, error, act, enter, leave } = online;
  const room = view?.room;
  const [code, setCode] = useState(inviteCode);
  const [copied, setCopied] = useState(false);
  const previousStatus = useRef<string | undefined>(undefined);
  const lastCode = localStorage.getItem(lastRoomKey);
  useEffect(() => {
    if (inviteCode) dialog.current!.showModal();
  }, [dialog]);
  useEffect(() => {
    if (room?.status === "playing" && previousStatus.current !== "playing") dialog.current!.close();
    previousStatus.current = room?.status;
  }, [dialog, room?.status]);

  const seat = room?.members.find((member) => member.user === connection!.user);
  const host = room?.host === connection?.user;
  return (
    <dialog className="online-dialog" ref={dialog} aria-labelledby="online-title">
      <header>
        <h2 id="online-title">好友联机</h2>
        <button aria-label="关闭联机菜单" onClick={() => dialog.current!.close()}>×</button>
      </header>
      {!onlineConfigured ? <p>当前版本的联机服务尚未配置。</p> : room ? (
        <>
          <div className="room-invite">
            <p>房间码 <code>{room.code}</code></p>
            <button disabled={busy} onClick={() => void act(async () => {
              const link = new URL(window.location.href);
              link.searchParams.set("room", room.code);
              await navigator.clipboard.writeText(link.href);
              setCopied(true);
            })}>{copied ? "已复制" : "复制邀请链接"}</button>
          </div>
          <ul className="room-members" aria-label="房间玩家">
            {room.members.map((member) => <li key={member.user}>
              <strong>{member.country ? scenario.countries[member.country].name : "待选国家"}</strong>
              <span>{member.user === room.host ? "房主" : "玩家"}{member.user === connection!.user ? " · 你" : ""} · {
                member.user === room.host ? (room.hostOnline ? "在线" : "离线") : (view.online.has(member.user) ? "在线" : "离线")
              }</span>
            </li>)}
          </ul>
          {room.status === "lobby" && (
            <>
              <label className="room-country">执政国家
                <select value={seat!.country ?? ""} disabled={busy || Boolean(view.error)} onChange={(event) => {
                  const country = event.target.value;
                  void act(() => connection!.selectCountry(country));
                }}>
                  <option value="" disabled>选择国家</option>
                  {Object.values(scenario.countries).map((country) => <option
                    key={country.id}
                    value={country.id}
                    disabled={room.members.some((member) => member.user !== connection!.user && member.country === country.id)}
                  >{country.name}</option>)}
                </select>
              </label>
              <p>{host ? "至少两位玩家选国后即可开局。" : "选国后等待房主开局。"}</p>
              {host && <button className="advance" disabled={busy || !view.leased || room.members.length < 2 ||
                room.members.some((member) => member.country === null)}
                onClick={() => void act(() => connection!.start(room, seat!.country!))}>开始联机</button>}
            </>
          )}
          <button disabled={busy} onClick={() => { setCopied(false); void leave(); }}>退出房间</button>
        </>
      ) : connection ? (
        <><p role="status">正在读取房间…</p><button disabled={busy} onClick={() => void leave()}>返回</button></>
      ) : (
        <>
          <button className="advance" disabled={busy} onClick={() => void enter()}>创建房间</button>
          <form className="room-join" onSubmit={(event) => { event.preventDefault(); void enter(code); }}>
            <label htmlFor="room-code">房间码</label>
            <input id="room-code" value={code} maxLength={12} autoComplete="off" onChange={(event) => setCode(event.target.value)} />
            <button disabled={busy || !/^[A-Fa-f0-9]{12}$/.test(code.trim())}>加入房间</button>
          </form>
          {lastCode && <button disabled={busy} onClick={() => void enter(lastCode)}>继续上次房间</button>}
        </>
      )}
      {error && <p className="room-error" role="alert">{error}</p>}
    </dialog>
  );
}
