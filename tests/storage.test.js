import test from "node:test";
import assert from "node:assert/strict";
import { loadResults, saveResults, STORAGE_KEY } from "../static/storage.js";
const result = { id: "one", name: "Front light", startedAt: "2026-11-12T12:00:00.000Z", elapsedMs: 2500, outcome: "completed" };
const memory = () => {
  const data = new Map();
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
};
test("results survive saving and loading", () => {
  const storage = memory();
  assert.deepEqual(loadResults(storage), []);
  saveResults(storage, [result]);
  assert.deepEqual(loadResults(storage), [result]);
});
test("corrupt stored data is surfaced without overwriting it", () => {
  for (const raw of ["broken", "null", "{}", '[{"elapsedMs":-1}]']) {
    const storage = memory();
    storage.setItem(STORAGE_KEY, raw);
    assert.throws(() => loadResults(storage));
    assert.equal(storage.getItem(STORAGE_KEY), raw);
  }
});
test("storage permission and quota failures reach the UI caller", () => {
  const storage = { getItem() { throw new Error("Denied"); }, setItem() { throw new Error("Quota"); } };
  assert.throws(() => loadResults(storage), /Denied/);
  assert.throws(() => saveResults(storage, [result]), /Quota/);
});
