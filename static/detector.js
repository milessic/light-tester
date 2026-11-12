export const MIN_CONTRAST = 20;
export const MAX_FRAME_GAP_MS = 1500;

export function luminance(pixels) {
  if (!pixels.length || pixels.length % 4) throw new Error("Invalid camera pixels");
  let sum = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    sum += 0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2];
  }
  return sum / (pixels.length / 4);
}

export class LightDetector {
  constructor({ ambient, illuminated, startedAt, holdMs = 750 }) {
    if (![ambient, illuminated, startedAt, holdMs].every(Number.isFinite)
        || ambient < 0 || illuminated > 255 || illuminated - ambient < MIN_CONTRAST || holdMs <= 0) {
      throw new Error("The light is not bright enough above ambient. Reposition it and try again.");
    }
    this.startedAt = startedAt;
    this.threshold = ambient + (illuminated - ambient) * 0.25;
    this.recoveryThreshold = this.threshold + (illuminated - ambient) * 0.08;
    this.holdMs = holdMs;
    this.lastAt = startedAt;
    this.darkSince = null;
    this.result = null;
  }

  sample(brightness, at) {
    if (this.result) return this.result;
    if (!Number.isFinite(brightness) || brightness < 0 || brightness > 255 || !Number.isFinite(at) || at < this.lastAt) {
      throw new Error("Invalid camera sample");
    }
    if (at - this.lastAt > MAX_FRAME_GAP_MS) {
      this.result = { outcome: "interrupted", elapsedMs: this.lastAt - this.startedAt };
      return this.result;
    }
    this.lastAt = at;
    if (brightness <= this.threshold && this.darkSince === null) this.darkSince = at;
    if (brightness >= this.recoveryThreshold) this.darkSince = null;
    if (this.darkSince !== null && at - this.darkSince >= this.holdMs) {
      // Report the first dark frame, not the end of the confirmation period.
      this.result = { outcome: "completed", elapsedMs: this.darkSince - this.startedAt };
      return this.result;
    }
    return null;
  }
}

export function formatDuration(ms) {
  const ticks = Math.floor(Math.max(0, ms) / 100);
  const seconds = Math.floor(ticks / 10);
  const pad = n => String(n).padStart(2, "0");
  return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}.${ticks % 10}`;
}
