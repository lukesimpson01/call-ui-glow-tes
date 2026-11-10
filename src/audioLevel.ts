/**
 * Reads the RMS level (0–1) of whatever an existing AnalyserNode is tapping.
 * The analyser must sit on the audio that is actually being played / recorded.
 */
export function createAudioLevelGetter(
  analyser: AnalyserNode,
  gain = 3.8
): () => number {
  const samples = new Uint8Array(analyser.fftSize);
  return () => {
    analyser.getByteTimeDomainData(samples);
    let sum = 0;
    for (let i = 0; i < samples.length; i++) {
      const s = (samples[i] - 128) / 128;
      sum += s * s;
    }
    return Math.min(1, Math.sqrt(sum / samples.length) * gain);
  };
}
