import { useEffect, useState } from "react";
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

// Tap anywhere to move to the next state. The glow transitions smoothly.
const STEPS: Step[] = [
  { open: false, phase: "idle", title: "Ready", sub: "Call not started", next: "Start call" },
  { open: true, phase: "listening", title: "Listening", sub: "Clyra is hearing you", next: "Clyra thinks" },
  { open: true, phase: "thinking", title: "Thinking", sub: "Working on a reply", next: "Clyra speaks" },
  { open: true, phase: "speaking", title: "Speaking", sub: "Clyra is talking", next: "Interrupt" },
  { open: true, phase: "listening", title: "Interrupted", sub: "Back to listening", next: "End call" },
  { open: false, phase: "idle", title: "Call ended", sub: "The glow settles and fades", next: "Start again" },
];

export function App() {
  const [i, setI] = useState(0);
  const step = STEPS[i];

  const speaking = step.open && step.phase === "speaking";
  useEffect(() => {
    if (speaking) startSpeech();
    else stopSpeech();
  }, [speaking]);

  const advance = () => setI((n) => (n + 1) % STEPS.length);

  return (
    <>
      <main
        className="stage"
        onClick={advance}
        onKeyDown={(e) => (e.key === " " || e.key === "Enter") && advance()}
        role="button"
        tabIndex={0}
        aria-label={`${step.title}. Tap to ${step.next}`}
      >
        <div className="state" key={i}>
          <div className="state__dots" aria-hidden="true">
            {STEPS.slice(0, 5).map((_, d) => (
              <span key={d} className={d === Math.min(i, 4) ? "on" : ""} />
            ))}
          </div>
          <h1>{step.title}</h1>
          <p>{step.sub}</p>
        </div>
        <div className="hint">Tap to: {step.next}</div>
      </main>
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
