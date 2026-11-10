import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { VoiceBeam } from "voice-glow";
import type { VoiceBeamMotion } from "voice-glow";
import "./ClyraCallGlow.css";

export type CallPhase = "idle" | "listening" | "thinking" | "speaking";

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

function clamp(value: number) {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

export function ClyraCallGlow({
  open,
  phase,
  getMicLevel,
  getTtsLevel,
  getWordPulse,
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
  const mix = useRef({ last: 0, mic: 0, tts: 0, calm: 1 });

  // VoiceBeam samples this every animation frame.
  const level = useCallback(() => {
    const now = performance.now() / 1000;
    const m = mix.current;
    const dt = m.last ? Math.min(0.05, Math.max(0, now - m.last)) : 0.016;
    m.last = now;

    const p = phaseRef.current;
    // Crossfade sources so an interruption (speaking -> listening) glides.
    const k = 1 - Math.exp(-dt * 9);
    m.mic += ((p === "listening" ? 1 : 0) - m.mic) * k;
    m.tts += ((p === "speaking" ? 1 : 0) - m.tts) * k;
    // Closing: calm the waves before the fade completes.
    m.calm += ((openRef.current ? 1 : 0.15) - m.calm) * (1 - Math.exp(-dt * 5));

    let v = 0;
    if (m.mic > 0.002) v += clamp(micRef.current?.() ?? 0) * m.mic;
    if (m.tts > 0.002) {
      const tts = clamp(ttsRef.current?.() ?? 0);
      const pulse = clamp(pulseRef.current?.() ?? 0);
      // Amplitude leads; word boundaries add a tight accent on top.
      v += clamp(tts + pulse * 0.22 * (0.4 + tts)) * m.tts;
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
      Math.sin(now * 0.68) * 0.7 +
      Math.sin(now * 0.31 + 1.4) * 0.2 +
      Math.sin(now * 1.13 + 0.4) * 0.1;
    const breathing =
      Math.sin(now * 0.82) * 0.08 + Math.sin(now * 1.37) * 0.035;

    const target = thinking
      ? {
          gather: 0.26 + breathing * 1.4,
          offset: slowFlow * 0.7,
          stretch: 0.62 + Math.sin(now * 0.57) * 0.15,
          heldLevel: 0.7 + Math.sin(now * 0.91) * 0.09 + Math.sin(now * 0.43 + 2) * 0.05,
        }
      : { gather: 0, offset: 0, stretch: 0, heldLevel: 0 };

    // Slower ease out of thinking so the hand-off to listening/speaking is soft.
    const ease = 1 - Math.exp(-dt * 4.2);
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
  const horizontalScale = Math.min(5, Math.max(1, width / 390));
  const speaking = phase === "speaking";

  return createPortal(
    <div
      ref={hostRef}
      aria-hidden="true"
      className={
        "clyra-voice-glow" + (open ? " clyra-voice-glow--visible" : "")
      }
    >
      <div className="clyra-voice-glow__beam">
        <VoiceBeam
          type="mobile"
          borderRadius={0}
          theme="dark"
          active={beamActive}
          level={level}
          motion={motion}
          colorVariant="ice"
          colors={BLUE_COLORS}
          bandColors={{
            core: "#8CC8FF",
            above: "#B8DAFF",
            mid: "#338FFF",
            below: "#083DA8",
          }}
          staticColors={true}
          // Brightness stays low on purpose: >1.2 clips the blue channel and
          // pushes the light toward cyan/teal. Intensity comes from opacity.
          brightness={1.05}
          saturation={1.3}
          bloomOpacity={2.2}
          innerOpacity={2.0}
          strokeOpacity={1.2}
          strength={0.95}
          sensitivity={3.1}
          threshold={0.012}
          // Tighter response while speaking so syllables read; calmer otherwise.
          attack={speaking ? 0.06 : 0.09}
          release={speaking ? 0.22 : 0.3}
          idle={0.3}
          reach={2.4}
          spread={1.2}
          flow={38}
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
