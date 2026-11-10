import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { VoiceBeam } from "voice-glow";
import type { VoiceBeamMotion } from "voice-glow";
import "./ClyraCallGlow.css";

export type CallPhase =
  | "idle"
  | "activated"
  | "listening"
  | "thinking"
  | "speaking";

type Props = {
  open: boolean;
  phase: CallPhase;
  /** Backed by Clyra's existing microphone analyser (0–1). */
  getMicLevel?: () => number;
  /** Backed by an analyser on Clyra's existing TTS output (0–1). */
  getTtsLevel?: () => number;
  /**
   * Optional word/syllable boundary pulse (0–1, decays quickly after each
   * boundary). Refines timing only; the TTS amplitude stays the main driver.
   */
  getWordPulse?: () => number;
  /**
   * Listening holds the glow at one steady height (0–1) regardless of mic
   * volume. Pass null to make listening follow `getMicLevel` instead.
   * @default 0.5
   */
  listeningLevel?: number | null;
};

// Blue / cyan only.
const BLUE_COLORS = [
  "#267CFF",
  "#1153E8",
  "#51B8FF",
  "#073DAE",
  "#7DB8FF",
  "#1765FF",
  "#249CFF",
];

const EXIT_MS = 650;

/**
 * Glow heights, tuned to the reference states (measured as a share of screen
 * height): activated ~10%, listening ~15%, thinking ~18%, talking ~25%
 * (peaks ~30%). Values are VoiceBeam levels (0-1) that produce those heights.
 */
const LEVELS = {
  activated: 0.045, // thin line along the bottom
  listening: 0.105, // steady
  thinking: 0.06, // + slow wobble, plus the moving waves from motion()
  speakFloor: 0.105, // pauses settle to the listening height, never off
  speakRange: 0.55, // + voice amplitude on top
};

function clamp(value: number) {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

export function ClyraCallGlow({
  open,
  phase,
  getMicLevel,
  getTtsLevel,
  getWordPulse,
  listeningLevel = 0.5,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const phaseRef = useRef(phase);
  const micRef = useRef(getMicLevel);
  const ttsRef = useRef(getTtsLevel);
  const pulseRef = useRef(getWordPulse);
  const [width, setWidth] = useState(() =>
    typeof window === "undefined" ? 390 : window.innerWidth
  );
  const [reducedMotion, setReducedMotion] = useState(false);
  // Keeps the beam alive until the CSS exit has finished.
  const [beamActive, setBeamActive] = useState(open);

  phaseRef.current = phase;
  micRef.current = getMicLevel;
  ttsRef.current = getTtsLevel;
  pulseRef.current = getWordPulse;
  const listeningLevelRef = useRef(listeningLevel);
  listeningLevelRef.current = listeningLevel;
  const reducedMotionRef = useRef(reducedMotion);
  reducedMotionRef.current = reducedMotion;
  const openRef = useRef(open);
  openRef.current = open;

  useEffect(() => {
    if (open) {
      setBeamActive(true);
      return;
    }
    const id = window.setTimeout(() => setBeamActive(false), EXIT_MS + 50);
    return () => window.clearTimeout(id);
  }, [open]);

  // Match the full width of the application.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width);
      setWidth((prev) => (Math.abs(prev - w) > 8 ? w : prev));
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  // Per-frame state lives in refs: no React renders for audio frames.
  const mix = useRef({ last: 0, base: 0, tts: 0, calm: 1 });

  // VoiceBeam samples this every animation frame.
  const level = useCallback(() => {
    const now = performance.now() / 1000;
    const m = mix.current;
    const dt = m.last ? Math.min(0.05, Math.max(0, now - m.last)) : 0.016;
    m.last = now;

    const p = phaseRef.current;
    // The steady height glides between states (never snaps), including the
    // speaking -> listening interruption.
    let baseTarget = 0;
    if (p === "activated") baseTarget = LEVELS.activated;
    else if (p === "listening") {
      const steady = listeningLevelRef.current;
      baseTarget =
        steady === null
          ? LEVELS.listening + clamp(micRef.current?.() ?? 0) * 0.3
          : LEVELS.listening;
    } else if (p === "speaking") baseTarget = LEVELS.speakFloor;
    else if (p === "thinking") {
      // Slow, layered swell so the whole glow breathes and never repeats.
      baseTarget =
        LEVELS.thinking +
        Math.sin(now * 0.6) * 0.05 +
        Math.sin(now * 0.37 + 1.1) * 0.04 +
        Math.sin(now * 1.05 + 2.3) * 0.015;
    }
    m.base += (baseTarget - m.base) * (1 - Math.exp(-dt * 2.2));
    m.tts += ((p === "speaking" ? 1 : 0) - m.tts) * (1 - Math.exp(-dt * 6));
    // Closing: calm the waves before the fade completes.
    m.calm += ((openRef.current ? 1 : 0.15) - m.calm) * (1 - Math.exp(-dt * 5));

    let v = m.base;
    if (m.tts > 0.002) {
      const tts = clamp(ttsRef.current?.() ?? 0);
      const pulse = clamp(pulseRef.current?.() ?? 0);
      // Amplitude leads; word boundaries add a tight accent on top.
      v += clamp(tts + pulse * 0.2 * (0.4 + tts)) * LEVELS.speakRange * m.tts;
    }
    return clamp(v * m.calm);
  }, []);

  const motionState = useRef({
    lastTime: 0,
    gather: 0,
    offset: 0,
    stretch: 0,
    heldLevel: 0,
  });

  // Organic "thinking" motion built from the public motion API.
  const motion = useCallback((): VoiceBeamMotion => {
    const now = performance.now() / 1000;
    const state = motionState.current;
    const dt = state.lastTime
      ? Math.min(0.05, Math.max(0, now - state.lastTime))
      : 0.016;
    state.lastTime = now;

    const thinking =
      phaseRef.current === "thinking" &&
      openRef.current &&
      !reducedMotionRef.current;

    const slowFlow =
      Math.sin(now * 0.52) * 0.72 +
      Math.sin(now * 0.27 + 1.4) * 0.22 +
      Math.sin(now * 0.91 + 0.4) * 0.06;
    const breathing =
      Math.sin(now * 0.82) * 0.08 + Math.sin(now * 1.37) * 0.035;

    const target = thinking
      ? {
          gather: 0.12 + breathing * 0.8,
          offset: slowFlow * 0.95,
          stretch: 0.5 + Math.sin(now * 0.57) * 0.15,
          heldLevel:
            LEVELS.thinking +
            Math.sin(now * 0.91) * 0.04 +
            Math.sin(now * 0.43 + 2) * 0.03,
        }
      : { gather: 0, offset: 0, stretch: 0, heldLevel: 0 };

    // Slower ease out of thinking so the hand-off to listening/speaking is soft.
    const ease = 1 - Math.exp(-dt * 1.6);
    state.gather += (target.gather - state.gather) * ease;
    state.offset += (target.offset - state.offset) * ease;
    state.stretch += (target.stretch - state.stretch) * ease;
    state.heldLevel += (target.heldLevel - state.heldLevel) * ease;

    return {
      gather: clamp(state.gather),
      offset: state.offset,
      stretch: clamp(state.stretch),
      heldLevel: clamp(state.heldLevel),
    };
  }, []);

  // Extend the library's phone-sized geometry across the whole window.
  // Heights follow screen height (so 15% stays 15% on any device); widths
  // follow screen width.
  const [vh, setVh] = useState(() =>
    typeof window === "undefined" ? 844 : window.innerHeight
  );
  useEffect(() => {
    const on = () => setVh((v) => (Math.abs(v - window.innerHeight) > 8 ? window.innerHeight : v));
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  const scale = Math.min(1.6, Math.max(0.7, vh / 844));
  const horizontalScale = Math.min(5, Math.max(1, width / (390 * scale)));
  const speaking = phase === "speaking";

  return createPortal(
    <div
      ref={hostRef}
      aria-hidden="true"
      className={
        "clyra-voice-glow" + (open ? " clyra-voice-glow--visible" : "")
      }
    >
      {/* Thinking: soft blue waves gliding side to side (CSS transforms only). */}
      <div
        className={
          "clyra-voice-glow__drift" +
          (phase === "thinking" && open && !reducedMotion
            ? " clyra-voice-glow__drift--on"
            : "")
        }
      >
        <i /> <i /> <i />
      </div>
      <div className="clyra-voice-glow__beam">
        <VoiceBeam
          type="mobile"
          scale={scale}
          borderRadius={0}
          theme={"light"}
          active={beamActive}
          level={level}
          motion={motion}
          colorVariant="ice"
          colors={BLUE_COLORS}
          bandColors={{
            core: "#3F8CFF",
            above: "#8DBBFF",
            mid: "#2A73FF",
            below: "#1747C9",
          }}
          staticColors={true}
          // Brightness stays low on purpose; intensity comes from layer opacity.
          brightness={0.92}
          saturation={1.7}
          bloomOpacity={2.4}
          innerOpacity={2.2}
          strokeOpacity={1.2}
          strength={1}
          sensitivity={3.1}
          threshold={0.012}
          // Tighter response while speaking so syllables read; calmer otherwise.
          attack={speaking ? 0.08 : 0.45}
          release={speaking ? 0.28 : 0.8}
          idle={0.12}
          // Bands drive lobes only while talking; elsewhere the glow stays full-width.
          bands={phase === "speaking"}
          reach={3}
          spread={1.2}
          flow={phase === "thinking" ? 70 : 38}
          bend={52}
          glowWidth={1.1 * horizontalScale}
          lobeSpacing={1.05 * horizontalScale}
          rangeWidth={1.1 * horizontalScale}
          glowHeight={1.8}
          bloomHeight={2.6}
          bloomScale={1.25}
          softness={1.25}
          distortion={0.3}
        >
          <div className="clyra-voice-glow__surface" />
        </VoiceBeam>
      </div>
    </div>,
    document.body
  );
}
