import test from "node:test";
import assert from "node:assert/strict";
import { LightDetector, formatDuration, luminance } from "../static/detector.js";
const create = () => new LightDetector({ ambient: 20, illuminated: 220, startedAt: 0 });
test("sustained darkness stops at the first dark frame and completes only once", () => {
  const detector = create();
  assert.equal(detector.sample(220, 500), null);
  assert.equal(detector.sample(30, 1000), null);
  assert.equal(detector.sample(30, 1700), null);
  const result = detector.sample(30, 1800);
  assert.deepEqual(result, { outcome: "completed", elapsedMs: 1000 });
  assert.equal(detector.sample(220, 1900), result);
});
test("flicker does not stop a test and recovery resets confirmation", () => {
  const detector = create();
  detector.sample(30, 100);
  detector.sample(220, 700);
  assert.equal(detector.sample(30, 800), null);
  assert.equal(detector.sample(30, 1500), null);
  assert.deepEqual(detector.sample(30, 1600), { outcome: "completed", elapsedMs: 800 });
});
test("small noise above the off threshold uses hysteresis", () => {
  const detector = create();
  detector.sample(65, 100);
  assert.deepEqual(detector.sample(75, 900), { outcome: "completed", elapsedMs: 100 });
});
test("missing frames interrupt instead of reporting darkness during the gap", () => {
  const detector = create();
  detector.sample(220, 500);
  detector.sample(20, 600);
  assert.deepEqual(detector.sample(20, 3000), { outcome: "interrupted", elapsedMs: 600 });
});
test("requires meaningful contrast and valid samples", () => {
  assert.throws(() => new LightDetector({ ambient: 220, illuminated: 230, startedAt: 0 }));
  assert.throws(() => new LightDetector({ ambient: NaN, illuminated: 230, startedAt: 0 }));
  const detector = create();
  assert.throws(() => detector.sample(NaN, 100));
  detector.sample(220, 100);
  assert.throws(() => detector.sample(220, 90));
});
test("pixel luminance is weighted and averaged", () => {
  assert.equal(luminance([0, 0, 0, 255]), 0);
  assert.ok(Math.abs(luminance([255, 255, 255, 255]) - 255) < 1e-9);
  assert.ok(Math.abs(luminance([0, 0, 0, 255, 255, 255, 255, 255]) - 127.5) < 1e-9);
  assert.ok(luminance([0, 255, 0, 255]) > luminance([255, 0, 0, 255]));
});
test("duration supports subsecond results and runs longer than a day", () => {
  assert.equal(formatDuration(0), "00:00:00.0");
  assert.equal(formatDuration(3723456), "01:02:03.4");
  assert.equal(formatDuration(90000000), "25:00:00.0");
});
