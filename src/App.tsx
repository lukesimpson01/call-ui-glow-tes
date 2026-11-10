import { useEffect, useRef, useState } from "react";
import "./index.css";
import { ClyraCallGlow, type CallPhase } from "./ClyraCallGlow";
import {
  getMicLevel,
  getTtsLevel,
  getWordPulse,
  startSpeech,
  stopSpeech,
} from "./demoAudio";

type Step = {
  open: boolean;
  phase: CallPhase;
  title: string;
  sub: string;
  next: string;
};

// Tap, swipe or use the dots to move between states.
const STEPS: Step[] = [
  { open: false, phase: "idle", title: "Ready", sub: "Call not started", next: "start the call" },
  { open: true, phase: "activated", title: "Activated", sub: "Clyra is here", next: "start listening" },
  { open: true, phase: "listening", title: "Listening", sub: "Clyra is hearing you", next: "let Clyra think" },
  { open: true, phase: "thinking", title: "Thinking", sub: "Working on a reply", next: "let Clyra talk" },
  { open: true, phase: "speaking", title: "Talking", sub: "Clyra is speaking", next: "interrupt Clyra" },
  { open: true, phase: "listening", title: "Interrupted", sub: "Back to listening", next: "end the call" },
  { open: false, phase: "idle", title: "Call ended", sub: "The glow settles and fades", next: "start again" },
];

type Layer = { id: number; i: number; leaving: boolean };

export function App() {
  // ?phase=activated|listening|thinking|speaking starts directly in that state.
  const [i, setI] = useState(() => {
    const q = new URLSearchParams(location.search).get("phase");
    const idx = STEPS.findIndex((s) => s.open && s.phase === q);
    return idx > 0 ? idx : 0;
  });
  const dir = useRef(1);
  const idRef = useRef(0);
  const [layers, setLayers] = useState<Layer[]>([{ id: 0, i, leaving: false }]);
  const step = STEPS[i];

  const speaking = step.open && step.phase === "speaking";
  useEffect(() => {
    if (speaking) startSpeech();
    else stopSpeech();
  }, [speaking]);

  // Cross-fade: the old text leaves while the new text arrives.
  useEffect(() => {
    const id = ++idRef.current;
    setLayers((ls) => [
      ...ls.map((l) => ({ ...l, leaving: true })),
      { id, i, leaving: false },
    ]);
    const t = window.setTimeout(
      () => setLayers((ls) => ls.filter((l) => l.id === id || !l.leaving)),
      700
    );
    return () => window.clearTimeout(t);
  }, [i]);

  const go = (to: number, d: number) => {
    dir.current = d;
    setI(((to % STEPS.length) + STEPS.length) % STEPS.length);
  };
  const next = () => go(i + 1, 1);
  const prev = () => go(i - 1, -1);

  // Tap = next, horizontal swipe = next / previous.
  const down = useRef<{ x: number; y: number } | null>(null);
  const onDown = (e: React.PointerEvent) => {
    down.current = { x: e.clientX, y: e.clientY };
  };
  const onUp = (e: React.PointerEvent) => {
    const d = down.current;
    down.current = null;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.abs(dx) > 44 && Math.abs(dx) > Math.abs(dy)) dx < 0 ? next() : prev();
    else if (Math.abs(dx) < 12 && Math.abs(dy) < 12) next();
  };

  return (
    <>
      <main
        className="stage"
        style={{ "--dir": dir.current } as React.CSSProperties}
        onPointerDown={onDown}
        onPointerUp={onUp}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight" || e.key === " " || e.key === "Enter") next();
          if (e.key === "ArrowLeft") prev();
        }}
        role="group"
        tabIndex={0}
        aria-label={`${step.title}. Tap to ${step.next}`}
      >
        {layers.map((l) => (
          <div key={l.id} className={"layer" + (l.leaving ? " layer--out" : "")}>
            <div className="state">
              <h1>{STEPS[l.i].title}</h1>
              <p>{STEPS[l.i].sub}</p>
            </div>
            <div className="hint">
              <span>Tap to {STEPS[l.i].next}</span>
            </div>
          </div>
        ))}
      </main>

      <nav className="dots" aria-label="Call state">
        {STEPS.map((s, d) => (
          <button
            key={d}
            className={d === i ? "on" : ""}
            aria-label={s.title}
            aria-current={d === i}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              go(d, d >= i ? 1 : -1);
            }}
          />
        ))}
      </nav>

      <ClyraCallGlow
        open={step.open}
        phase={step.phase}
        getMicLevel={getMicLevel}
        getTtsLevel={getTtsLevel}
        getWordPulse={getWordPulse}
      />
    </>
  );
}
