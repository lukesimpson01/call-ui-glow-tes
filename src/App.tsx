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

type Step = { open: boolean; phase: CallPhase; ms: number; note?: string };

// Blank page, no call UI: the glow cycles through every call mode.
// Pin one with ?phase=listening|thinking|speaking.
const CYCLE: Step[] = [
  { open: false, phase: "idle", ms: 1800, note: "blank" },
  { open: true, phase: "listening", ms: 5500 },
  { open: true, phase: "thinking", ms: 6000 },
  { open: true, phase: "speaking", ms: 3500 },
  { open: true, phase: "listening", ms: 3500, note: "interrupted" },
  { open: true, phase: "thinking", ms: 3500 },
  { open: true, phase: "speaking", ms: 8000 },
  { open: false, phase: "idle", ms: 2200, note: "call ended" },
];

export function App() {
  const pinned = new URLSearchParams(location.search).get("phase") as CallPhase | null;
  const [i, setI] = useState(0);
  const [step, setStep] = useState<Step>(
    pinned ? { open: true, phase: pinned, ms: 0 } : CYCLE[0]
  );

  useEffect(() => {
    if (pinned) return;
    const s = CYCLE[i];
    setStep(s);
    const id = window.setTimeout(() => setI((n) => (n + 1) % CYCLE.length), s.ms);
    return () => window.clearTimeout(id);
  }, [i, pinned]);

  const speaking = step.open && step.phase === "speaking";
  useEffect(() => {
    if (speaking) startSpeech();
    else stopSpeech();
  }, [speaking]);

  return (
    <ClyraCallGlow
      open={step.open}
      phase={step.phase}
      getMicLevel={getMicLevel}
      getTtsLevel={getTtsLevel}
      getWordPulse={getWordPulse}
    />
  );
}
