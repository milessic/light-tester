export const STORAGE_KEY = "light-tester.results.v1";

function isResult(value) {
  return value && typeof value.id === "string" && typeof value.name === "string"
    && typeof value.startedAt === "string" && Number.isFinite(Date.parse(value.startedAt))
    && Number.isFinite(value.elapsedMs) && value.elapsedMs >= 0
    && ["completed", "interrupted"].includes(value.outcome);
}

export function loadResults(storage) {
  const raw = storage.getItem(STORAGE_KEY);
  if (raw === null) return [];
  const results = JSON.parse(raw);
  if (!Array.isArray(results) || !results.every(isResult)) throw new Error("Invalid saved results");
  return results;
}

export function saveResults(storage, results) {
  if (!results.every(isResult)) throw new Error("Invalid results");
  storage.setItem(STORAGE_KEY, JSON.stringify(results));
}
