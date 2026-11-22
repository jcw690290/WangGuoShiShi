import { Application, Container, Graphics, Text } from "pixi.js";
import { useEffect, useRef, useState } from "react";
import type { GameState } from "../game/engine.ts";
import { atlas } from "../scenario/scenario.ts";
import type { Scenario } from "../scenario/scenario.ts";
import type { StateGeometry } from "./geometry.ts";

interface Props {
  scenario: Scenario;
  geometry: StateGeometry;
  game: GameState;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

async function mountMap(
  host: HTMLDivElement,
  scenario: Scenario,
  geometry: StateGeometry,
  onSelect: Props["onSelect"],
) {
  const app = new Application();
  await app.init({
    antialias: true,
    autoDensity: true,
    resolution: Math.min(2, window.devicePixelRatio),
    backgroundAlpha: 0,
    autoStart: false,
  });
  app.canvas.setAttribute("aria-hidden", "true");
  host.appendChild(app.canvas);

  const map = new Container();
  app.stage.addChild(map);

  const zoomBox = document.createElement("div");
  zoomBox.className = "zoom-controls";
  host.appendChild(zoomBox);
  let zoom = 1,
    dx = 0,
    dy = 0,
    dragged = false;
  let press: { x: number; y: number; dx: number; dy: number } | null = null;
  const colors = new Map<string, string>();
  const shapes = new Map(
    Object.keys(geometry).map((id) => {
      const shape = new Graphics({ eventMode: "static", cursor: "pointer" });
      shape.on("pointertap", () => {
        if (!dragged) onSelect(id);
      });
      map.addChild(shape);
      return [id, shape];
    }),
  );
  const label = new Text({
    text: "",
    style: {
      fontFamily: "Microsoft YaHei, sans-serif",
      fontSize: 15,
      fontWeight: "bold",
      fill: "#fffaf0",
      stroke: { color: "#302717", width: 3 },
    },
    eventMode: "none",
  });
  label.anchor.set(0.5, 1);
  map.addChild(label);
  const place = () => {
    const w = host.clientWidth,
      h = host.clientHeight,
      k = Math.min(w / 1200, h / 575) * zoom;
    dx = Math.max(-600 * k, Math.min(600 * k, dx));
    dy = Math.max(-287.5 * k, Math.min(287.5 * k, dy));
    map.scale.set(k);
    map.position.set((w - 1200 * k) / 2 + dx, (h - 575 * k) / 2 + dy);
    label.scale.set(1 / k);
    app.render();
  };
  const magnify = (factor: number, x = host.clientWidth / 2, y = host.clientHeight / 2) => {
    const next = Math.min(16, Math.max(1, zoom * factor)),
      ratio = next / zoom;
    dx = (dx + host.clientWidth / 2 - x) * ratio + x - host.clientWidth / 2;
    dy = (dy + host.clientHeight / 2 - y) * ratio + y - host.clientHeight / 2;
    zoom = next;
    if (zoom === 1) {
      dx = 0;
      dy = 0;
    }
    place();
  };
  let focus: string | null = null;
  for (const [name, action] of [
    ["放大", () => magnify(1.65)],
    ["缩小", () => magnify(1 / 1.65)],
    [
      "定位",
      () => {
        if (focus) {
          zoom = 5;
          const k = Math.min(host.clientWidth / 1200, host.clientHeight / 575) * zoom;
          const [x, y] = atlas[focus].label;
          dx = (600 - x) * k;
          dy = (287.5 - y) * k;
          place();
        }
      },
    ],
    [
      "全图",
      () => {
        zoom = 1;
        dx = dy = 0;
        place();
      },
    ],
  ] as const) {
    const b = document.createElement("button");
    b.textContent = name;
    b.onclick = action;
    zoomBox.append(b);
  }
  const canvas = app.canvas;
  canvas.style.touchAction = "none";
  canvas.addEventListener(
    "wheel",
    (ev) => {
      ev.preventDefault();
      const box = canvas.getBoundingClientRect();
      magnify(ev.deltaY < 0 ? 1.25 : 0.8, ev.clientX - box.left, ev.clientY - box.top);
    },
    { passive: false },
  );
  canvas.addEventListener("pointerdown", (ev) => {
    press = { x: ev.clientX, y: ev.clientY, dx, dy };
    dragged = false;
    canvas.setPointerCapture(ev.pointerId);
  });
  canvas.addEventListener("pointermove", (ev) => {
    if (!press) return;
    const x = ev.clientX - press.x,
      y = ev.clientY - press.y;
    if (Math.hypot(x, y) > 4) dragged = true;
    if (dragged) {
      dx = press.dx + x;
      dy = press.dy + y;
      place();
    }
  });
  canvas.addEventListener("pointerup", () => {
    press = null;
  });
  canvas.addEventListener("pointercancel", () => {
    press = null;
  });
  const observer = new ResizeObserver(() => {
    app.renderer.resize(host.clientWidth, host.clientHeight);
    place();
  });
  observer.observe(host);
  let previousOwners: GameState["ownerByStateId"] | null = null;
  let previousOccupation: string | null = null;
  return {
    draw(game: GameState, selectedId: string | null) {
      const conflict = game.borderDispute;
      const occupation = conflict?.phase === "war" && conflict.progress >= 50 ? conflict.targetStateId : null;
      if (previousOwners === game.ownerByStateId && focus === selectedId && previousOccupation === occupation)
        return;
      previousOwners = game.ownerByStateId;
      previousOccupation = occupation;
      focus = selectedId;
      for (const [id, shape] of shapes) {
        const owner = game.ownerByStateId[id];
        const color = owner ? scenario.countries[owner].color : "#d1dbdd",
          selected = id === selectedId;
        const occupied = occupation === id;
        const key = color + (selected ? "!" : "") + (occupied ? "*" : "");
        if (colors.get(id) === key) continue;
        colors.set(id, key);
        shape.clear();
        const border = {
          color: selected ? "#fff8dc" : occupied ? "#ffb51e" : "#574e43",
          width: selected || occupied ? 1.25 : 0.28,
        };
        for (const [shell, ...holes] of geometry[id]) {
          shape.poly(shell.flat()).fill(color);
          for (const hole of holes) shape.poly(hole.flat()).cut();
          shape.poly(shell.flat()).stroke(border);
        }
        if (selected) map.addChild(shape);
      }
      label.visible = selectedId !== null;
      if (selectedId) {
        label.text = atlas[selectedId].name;
        label.position.set(...atlas[selectedId].label);
        map.addChild(label);
      }
      place();
    },
    destroy() {
      observer.disconnect();
      zoomBox.remove();
      app.destroy({ removeView: true }, { children: true });
    },
  };
}
export function StateMap({ scenario, geometry, game, selectedId, onSelect }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<Awaited<ReturnType<typeof mountMap>>>(null);
  const frame = useRef({ game, selectedId });
  const [error, setError] = useState<string>();

  useEffect(() => {
    frame.current = { game, selectedId };
    map.current?.draw(game, selectedId);
  }, [game, selectedId]);

  useEffect(() => {
    let disposed = false;
    void mountMap(host.current!, scenario, geometry, onSelect).then(
      (instance) => {
        if (disposed) {
          instance.destroy();
          return;
        }
        map.current = instance;
        instance.draw(frame.current.game, frame.current.selectedId);
      },
      (error: unknown) => {
        if (!disposed) setError(error instanceof Error ? error.message : String(error));
      },
    );
    return () => {
      disposed = true;
      map.current?.destroy();
      map.current = null;
    };
  }, [scenario, geometry, onSelect]);

  return (
    <div className="map-frame">
      {error && (
        <p role="alert" className="map-error">
          无法显示地图。{error}
        </p>
      )}
      <div className="map-host" ref={host} />
    </div>
  );
}
