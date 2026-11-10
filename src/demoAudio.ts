/**
 * Demo audio for the blank harness page only. Clyra's real app supplies its own
 * microphone and TTS analysers; the glow component never imports this file.
 *
 * TTS: a small formant voice plays through  voice -> AnalyserNode -> speakers,
 * and createAudioLevelGetter reads that analyser, so levels come from the audio
 * actually being played. Before the browser allows sound (no user gesture yet)
 * the AudioContext is suspended, so we fall back to the same syllable schedule.
 *
 * Mic: real microphone if ?mic=1 is in the URL (analyser only, never routed
 * to the speakers); otherwise a simulated talker envelope.
 */
import { createAudioLevelGetter } from "./audioLevel";

type Syl = { start: number; dur: number; amp: number; word: boolean };

let ctx: AudioContext | null = null;
let ttsAnalyser: AnalyserNode | null = null;
let ttsGetter: (() => number) | null = null;
let micGetter: (() => number) | null = null;
let master: GainNode | null = null;
let voiceNodes: { osc: OscillatorNode; gain: GainNode } | null = null;

let sylls: Syl[] = [];
let utterStart = 0; // performance.now() ms
let speaking = false;

function ensureCtx() {
  if (ctx) return ctx;
  const AC = window.AudioContext || (window as any).webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.14;
  ttsAnalyser = ctx.createAnalyser();
  ttsAnalyser.fftSize = 1024;
  ttsAnalyser.smoothingTimeConstant = 0;
  ttsAnalyser.connect(master);
  master.connect(ctx.destination);
  ttsGetter = createAudioLevelGetter(ttsAnalyser, 8);
  return ctx;
}

export function unlockAudio() {
  ensureCtx()?.resume().catch(() => {});
}

for (const ev of ["pointerdown", "keydown", "touchstart"]) {
  window.addEventListener(ev, unlockAudio, { once: true, passive: true });
}

function makeSchedule(): Syl[] {
  const words = [3, 1, 2, 2, 1, 3, 2, 1, 2, 3, 1, 2];
  const out: Syl[] = [];
  let t = 0.15;
  words.forEach((n, wi) => {
    for (let s = 0; s < n; s++) {
      const dur = 0.11 + Math.random() * 0.1;
      out.push({
        start: t,
        dur,
        amp: 0.45 + Math.random() * 0.55,
        word: s === 0,
      });
      t += dur + 0.025;
    }
    t += wi % 4 === 3 ? 0.4 + Math.random() * 0.2 : 0.05 + Math.random() * 0.08;
  });
  return out;
}

export function startSpeech() {
  speaking = true;
  utterStart = performance.now();
  sylls = makeSchedule();
  const c = ensureCtx();
  if (!c || !ttsAnalyser) return;
  c.resume().catch(() => {});
  if (c.state !== "running") return; // visuals fall back to the schedule
  const osc = c.createOscillator();
  osc.type = "sawtooth";
  const gain = c.createGain();
  gain.gain.value = 0;
  const f1 = c.createBiquadFilter();
  f1.type = "bandpass";
  f1.frequency.value = 650;
  f1.Q.value = 2;
  const f2 = c.createBiquadFilter();
  f2.type = "bandpass";
  f2.frequency.value = 1500;
  f2.Q.value = 3;
  osc.connect(f1);
  osc.connect(f2);
  f1.connect(gain);
  f2.connect(gain);
  gain.connect(ttsAnalyser);
  const t0 = c.currentTime;
  osc.frequency.setValueAtTime(130, t0);
  for (const s of sylls) {
    const a = t0 + s.start;
    osc.frequency.setValueAtTime(115 + Math.random() * 40, a);
    gain.gain.setValueAtTime(0, a);
    gain.gain.linearRampToValueAtTime(s.amp, a + 0.035);
    gain.gain.exponentialRampToValueAtTime(0.0001, a + s.dur);
  }
  osc.start(t0);
  voiceNodes = { osc, gain };
}

/** Interrupt / finish: fade the voice out in ~60ms, never hard-cut. */
export function stopSpeech() {
  speaking = false;
  if (voiceNodes && ctx) {
    const { osc, gain } = voiceNodes;
    const t = ctx.currentTime;
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(gain.gain.value, t);
    gain.gain.linearRampToValueAtTime(0, t + 0.06);
    osc.stop(t + 0.08);
    voiceNodes = null;
  }
}

function scheduleEnvelope(now: number) {
  const t = (now - utterStart) / 1000;
  let v = 0;
  for (const s of sylls) {
    const x = t - s.start;
    if (x < 0 || x > s.dur) continue;
    v = Math.max(v, x < 0.035 ? (x / 0.035) * s.amp : s.amp * Math.exp(-(x - 0.035) * 18));
  }
  return v * 0.8;
}

export const getTtsLevel = () => {
  if (!speaking) return ttsGetter && ctx?.state === "running" ? ttsGetter() : 0;
  if (ctx?.state === "running" && ttsGetter && voiceNodes) return ttsGetter();
  return scheduleEnvelope(performance.now());
};

let lastWord = -1;
let pulse = 0;
/** Word-boundary pulse: spikes at each word onset, decays in ~120ms. */
export const getWordPulse = () => {
  const now = performance.now();
  if (speaking) {
    const t = (now - utterStart) / 1000;
    for (let i = 0; i < sylls.length; i++) {
      if (sylls[i].word && t >= sylls[i].start && i > lastWord) {
        lastWord = i;
        pulse = 1;
      }
    }
  } else lastWord = -1;
  pulse *= 0.9;
  return pulse;
};

// ---- microphone ----
let micAnalyserStarted = false;
function startRealMic() {
  if (micAnalyserStarted) return;
  micAnalyserStarted = true;
  const c = ensureCtx();
  if (!c) return;
  navigator.mediaDevices
    ?.getUserMedia({ audio: true })
    .then((stream) => {
      const an = c.createAnalyser();
      an.fftSize = 1024;
      c.createMediaStreamSource(stream).connect(an); // analysis only
      micGetter = createAudioLevelGetter(an, 3.8);
    })
    .catch(() => {});
}

export const getMicLevel = () => {
  if (new URLSearchParams(location.search).has("mic")) {
    startRealMic();
    if (micGetter) return micGetter();
  }
  // Simulated talker: bursts of speech with natural gaps.
  const t = performance.now() / 1000;
  const gate = Math.max(0, Math.sin(t * 1.3) * 0.8 + Math.sin(t * 0.37 + 1) * 0.5 + 0.1);
  const syll = Math.abs(Math.sin(t * 8.1)) * Math.abs(Math.sin(t * 3.3 + 0.7));
  return Math.min(1, Math.min(1, gate) * (0.15 + 0.6 * syll));
};
