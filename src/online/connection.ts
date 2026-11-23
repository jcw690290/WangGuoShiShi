import type { RealtimeChannel } from "@supabase/supabase-js";
import { advanceDay, createGame, dispatch, isScenarioFinished } from "../game/engine.ts";
import type { GameCommand, GameState } from "../game/engine.ts";
import { GameRuleError } from "../game/rules.ts";
import type { Scenario } from "../scenario/scenario.ts";
import { onlineClient, OnlineRequestError, request } from "./client.ts";
import { applyPlayerCommand, decodeSnapshot, encodeSnapshot, protocolVersion, roomSchema } from "./protocol.ts";
import type { Room, Speed } from "./protocol.ts";

export interface RoomView {
  room: Room;
  game: GameState | null;
  leased: boolean;
  online: ReadonlySet<string>;
  error: string;
}

export class RoomConnection {
  private channel: RealtimeChannel | null = null;
  private readonly lease = crypto.randomUUID();
  private room: Room | null = null;
  private game: GameState | null = null;
  private checkpoint = 0;
  private leased = false;
  private renewAt = 0;
  private tickAt = Infinity;
  private online = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private working = false;
  private wakeRequested = false;
  private closed = false;
  private retry = false;
  private pause = false;
  private error = "";

  constructor(
    private readonly scenario: Scenario,
    readonly id: string,
    readonly user: string,
    private readonly publish: (view: RoomView) => void,
    private readonly fail: (error: string) => void,
  ) {
    document.addEventListener("visibilitychange", this.onVisibility);
    window.addEventListener("online", this.wake);
    this.wake();
  }

  close() {
    this.closed = true;
    clearTimeout(this.timer);
    document.removeEventListener("visibilitychange", this.onVisibility);
    window.removeEventListener("online", this.wake);
    if (this.channel) void onlineClient().removeChannel(this.channel);
  }

  async leave() {
    if (this.room?.status === "lobby") {
      await this.call("leave", { lease: this.lease });
    } else if (this.leased) {
      await this.call("release", { lease: this.lease });
    }
    this.close();
  }

  async selectCountry(country: string) {
    await this.call("country", { country });
    this.wake();
  }

  async start(room: Room, country: string) {
    const initial = dispatch(this.scenario, createGame(this.scenario), { type: "selectCountry", countryId: country });
    const snapshot = await encodeSnapshot(this.scenario, initial);
    if (!(await this.call("start", { lease: this.lease, version: room.version, snapshot })))
      throw new OnlineRequestError("房间已有更新，请重试");
    this.wake();
  }

  async setSpeed(speed: Speed) {
    if (!(await this.call("speed", { lease: this.lease, speed })))
      throw new OnlineRequestError("房主持有权已失效，请稍候");
    this.wake();
  }

  async submit(command: GameCommand) {
    const args = { nonce: crypto.randomUUID(), command };
    let result: unknown;
    try {
      result = await this.call("submit", args);
    } catch (error) {
      if (!(error instanceof OnlineRequestError && error.retryable)) throw error;
      // A request may have committed before the connection dropped. Reuse its nonce.
      result = await this.call("submit", args);
    }
    if (typeof result !== "number") throw new Error("联机服务返回了无效的指令编号");
    this.wake();
    return result;
  }

  private call(action: string, args: Record<string, unknown> = {}) {
    return request(action, { room: this.id, ...args });
  }

  private readonly onVisibility = () => {
    if (document.hidden && this.leased) this.pause = true;
    this.wake();
  };

  private readonly wake = () => {
    if (this.closed) return;
    if (this.working) {
      this.wakeRequested = true;
      return;
    }
    this.schedule(0);
  };

  private schedule(delay: number) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.run(), delay);
  }

  private connectRealtime() {
    this.channel = onlineClient()
      .channel("wgss:" + this.id, { config: { private: true, presence: { key: this.user } } })
      .on("broadcast", { event: "changed" }, this.wake)
      .on("presence", { event: "sync" }, () => {
        this.online = new Set(Object.keys(this.channel!.presenceState()));
        this.emit();
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          void this.channel!.track({ joined: true });
          this.wake();
        }
      });
  }

  private emit() {
    if (this.room && !this.closed) this.publish({
      room: this.room, game: this.game, leased: this.leased, online: this.online, error: this.error,
    });
  }

  private async read(): Promise<Room> {
    const room = roomSchema.parse(await this.call("read", { checkpoint: this.checkpoint }));
    if (room.scenario !== this.scenario.id || room.protocol !== protocolVersion)
      throw new Error("房间版本与当前游戏不兼容");
    if (room.snapshot !== null) {
      this.game = await decodeSnapshot(this.scenario, room.snapshot);
      this.checkpoint = room.checkpointVersion;
    }
    if (room.status === "playing" && this.checkpoint !== room.checkpointVersion)
      throw new Error("缺少房间存档");
    if (room.day && this.game!.elapsedDays !== room.day.elapsedDays) this.game = { ...this.game!, ...room.day };
    if (room.speed !== this.room?.speed || room.hostOnline !== this.room?.hostOnline)
      this.tickAt = room.speed ? Date.now() + room.speed : Infinity;
    this.room = room;
    return room;
  }

  private async run() {
    if (this.closed) return;
    this.working = true;
    this.wakeRequested = false;
    let delay = 8000;
    try {
      let room = await this.read();
      if (this.closed) return;
      if (this.error) this.fail("");
      this.error = "";
      if (!this.channel) this.connectRealtime();

      if (room.host === this.user) {
        const now = Date.now();
        if (!room.hostOnline) this.leased = false;
        if (this.pause || this.retry) {
          this.retry = false;
          this.pause = false;
          if (this.leased && room.speed) {
            await this.call("speed", { lease: this.lease, speed: 0 });
            room = await this.read();
          }
        }
        if (!document.hidden && now >= this.renewAt) {
          const previouslyLeased = this.leased;
          this.leased = (await this.call("lease", { lease: this.lease })) === true;
          this.renewAt = Date.now() + 5000;
          if (this.leased && !previouslyLeased) room = await this.read();
        }
        this.emit();
        if (this.closed) return;
        if (!document.hidden) {
          delay = Math.min(delay, this.renewAt - Date.now());
          if (this.leased && this.game) {
            if (room.pending.length) {
              await this.processCommand(room, this.game);
              delay = 0;
            } else if (room.speed) {
              if (Date.now() >= this.tickAt) {
                await this.step(room, this.game);
                this.tickAt = Date.now() + room.speed;
              }
              delay = Math.min(delay, this.tickAt - Date.now());
            }
          }
        }
      } else {
        this.emit();
      }
    } catch (error) {
      if (this.closed) return;
      this.error = error instanceof Error ? error.message : String(error);
      this.emit();
      this.fail(this.error);
      if (!(error instanceof OnlineRequestError && error.retryable)) {
        this.close();
        return;
      }
      this.retry = true;
      delay = 3000;
    } finally {
      this.working = false;
      if (!this.closed) this.schedule(this.wakeRequested ? 0 : Math.max(delay, 0));
    }
  }

  private async processCommand(room: Room, game: GameState) {
    const pending = room.pending[0];
    let next: GameState;
    try {
      next = applyPlayerCommand(this.scenario, game, pending.country, pending.command);
    } catch (error) {
      if (!(error instanceof GameRuleError)) throw error;
      await this.call("commit", { lease: this.lease, version: room.version, commandId: pending.id, error: error.message });
      return;
    }
    const snapshot = await encodeSnapshot(this.scenario, next);
    if (this.closed) return;
    if (await this.call("commit", { lease: this.lease, version: room.version, commandId: pending.id, snapshot })) {
      this.game = next;
      this.checkpoint = room.version + 1;
    }
  }

  private async step(room: Room, game: GameState) {
    const humans = new Set(room.members.map((member) => member.country));
    const next = advanceDay(this.scenario, game, humans);
    if (next === game) {
      await this.setSpeed(0);
      return;
    }
    // Day ticks between weekly settlements only change the date and diplomatic phase.
    const checkpoint = next.elapsedDays % 7 === 0;
    const update = checkpoint
      ? { snapshot: await encodeSnapshot(this.scenario, next) }
      : { day: { elapsedDays: next.elapsedDays, borderDispute: next.borderDispute } };
    if (this.closed || document.hidden) return;
    const pause = isScenarioFinished(this.scenario, next);
    if (await this.call("commit", { lease: this.lease, version: room.version, ...update, pause })) {
      this.game = next;
      if (checkpoint) this.checkpoint = room.version + 1;
      this.emit();
    }
  }
}
