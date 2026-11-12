import { LightDetector, luminance, formatDuration, MIN_CONTRAST, MAX_FRAME_GAP_MS } from "./detector.js";
import { loadResults, saveResults } from "./storage.js";

const $ = id => document.getElementById(id);
const video = $("camera");
const canvas = document.createElement("canvas");
canvas.width = canvas.height = 32;
const context = canvas.getContext("2d", { willReadFrequently: true });
let stream = null, cameraRequest = 0, opening = false, frameHandle = null;
let samples = [], ambient = null, detector = null, activeTest = null;
let lastFrameAt = 0, lastVideoTime = -1, audio = null, wakeLock = null;
let results = [], storageReadable = true;

function notice(message, kind = "info") {
  $("notice").textContent = message;
  $("notice").className = `flash ${kind}`;
}
function storageWarning(message) {
  $("storage-warning").hidden = false;
  $("storage-warning").textContent = message;
}
try {
  results = loadResults(window.localStorage);
} catch {
  storageReadable = false;
  storageWarning("Saved results could not be read. Existing storage will not be overwritten. New results remain in this tab; export them before closing it.");
}
function persist() {
  if (!storageReadable) return false;
  try {
    saveResults(window.localStorage, results);
    $("storage-warning").hidden = true;
    return true;
  } catch {
    storageWarning("Results could not be saved to this browser. They remain in this tab; export them before closing it.");
    return false;
  }
}
function renderResults() {
  $("empty-results").hidden = results.length > 0;
  $("results-table").hidden = !results.length;
  $("export").disabled = !results.length;
  $("result-rows").replaceChildren();
  for (const result of results) {
    const row = document.createElement("tr");
    const name = row.insertCell();
    name.textContent = result.name;
    const date = document.createElement("time");
    date.className = "muted small result-date";
    date.dateTime = result.startedAt;
    date.textContent = new Date(result.startedAt).toLocaleString();
    name.append(date);
    row.insertCell().textContent = formatDuration(result.elapsedMs);
    const badge = document.createElement("span");
    badge.className = `badge ${result.outcome === "completed" ? "tone-ok" : "tone-warn"}`;
    badge.textContent = result.outcome === "completed" ? "Light off" : "Interrupted";
    row.insertCell().append(badge);
    const remove = document.createElement("button");
    remove.className = "btn ghost small";
    remove.textContent = "Delete";
    remove.setAttribute("aria-label", `Delete result for ${result.name}`);
    remove.addEventListener("click", () => {
      if (!window.confirm(`Delete the result for “${result.name}”?`)) return;
      results = results.filter(item => item.id !== result.id);
      persist();
      renderResults();
    });
    row.insertCell().append(remove);
    $("result-rows").append(row);
  }
}
function stableSignal() {
  return samples.length >= 5 && samples.at(-1).at - samples[0].at >= 700
    && performance.now() - lastFrameAt < 500;
}
function updateControls() {
  const running = Boolean(detector);
  $("enable-camera").disabled = Boolean(stream) || opening;
  $("disable-camera").disabled = !stream && !opening;
  $("calibrate").disabled = !stream || running || !stableSignal();
  $("start").disabled = !stream || running || ambient === null || !stableSignal();
  $("cancel").disabled = !running;
  $("light-name").disabled = running;
}
function testStatus(label, tone = "neutral") {
  $("test-status").textContent = label;
  $("test-status").className = `badge tone-${tone}`;
}
async function unlockAudio() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) throw new Error("Audio is unavailable");
  if (!audio || audio.state === "closed") audio = new AudioContext();
  // Called directly from a tap so Safari can unlock audio for the later alert.
  await audio.resume();
  if (audio.state !== "running") throw new Error("Audio is suspended");
}
function beep() {
  if (!audio || audio.state !== "running") {
    $("sound-status").textContent = "Alert unavailable. Check sound permissions and test the alert again.";
    return;
  }
  for (let i = 0; i < 3; i++) {
    const start = audio.currentTime + i * 0.3;
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.25, start + 0.015);
    gain.gain.linearRampToValueAtTime(0, start + 0.22);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.23);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  }
}
async function requestWakeLock(test) {
  try {
    if (!navigator.wakeLock) throw new Error("Unavailable");
    const lock = await navigator.wakeLock.request("screen");
    if (activeTest !== test) { await lock.release(); return; }
    wakeLock = lock;
    $("wake-status").textContent = "Screen wake lock active. Keep this page visible.";
    lock.addEventListener("release", () => {
      if (wakeLock === lock) {
        wakeLock = null;
        $("wake-status").textContent = "Screen wake lock released. Keep your screen unlocked and this page visible.";
      }
    });
  } catch {
    if (activeTest === test) $("wake-status").textContent = "Automatic screen wake is unavailable. Disable Auto-Lock for this test and keep this page visible.";
  }
}
function releaseWakeLock() {
  const lock = wakeLock;
  wakeLock = null;
  if (lock) lock.release().catch(() => {});
  $("wake-status").textContent = "Keep this page visible and your screen unlocked throughout the test.";
}
function finish(outcome, elapsedMs, reason = "") {
  if (!detector) return;
  const result = { ...activeTest, outcome, elapsedMs: Math.max(0, elapsedMs) };
  detector = null;
  activeTest = null;
  releaseWakeLock();
  $("timer").textContent = formatDuration(result.elapsedMs);
  results.unshift(result);
  const saved = persist();
  renderResults();
  testStatus(outcome === "completed" ? "Light off" : "Interrupted", outcome === "completed" ? "ok" : "warn");
  $("timer-detail").textContent = outcome === "completed" ? "Stopped at the first confirmed dark frame." : "Time until the last observed frame; this is not a completed runtime.";
  notice(outcome === "completed"
    ? `Light off detected. ${saved ? "Result saved on this device." : "Result is in this tab; export it to keep it."}`
    : `${reason} Test interrupted. ${saved ? "Partial result saved." : "Export the partial result to keep it."}`, outcome === "completed" ? "success" : "error");
  if (outcome === "completed") beep();
  updateControls();
}
function interrupt(reason) {
  if (detector) finish("interrupted", detector.lastAt - detector.startedAt, reason);
}
function stopCamera() {
  cameraRequest++;
  opening = false;
  if (frameHandle !== null) {
    if (video.cancelVideoFrameCallback) video.cancelVideoFrameCallback(frameHandle);
    else cancelAnimationFrame(frameHandle);
    frameHandle = null;
  }
  const previous = stream;
  stream = null;
  previous?.getTracks().forEach(track => track.stop());
  video.srcObject = null;
  video.hidden = true;
  $("target").hidden = true;
  $("camera-placeholder").hidden = false;
  $("camera-status").textContent = "Camera off";
  $("camera-status").className = "badge tone-neutral";
  samples = [];
  ambient = null;
  lastFrameAt = 0;
  lastVideoTime = -1;
  $("brightness").value = 0;
  $("brightness-value").textContent = "—";
  $("calibration-status").textContent = "Enable the camera, then switch the bicycle light off.";
  updateControls();
}
function scheduleFrame() {
  if (!stream) return;
  frameHandle = video.requestVideoFrameCallback
    ? video.requestVideoFrameCallback(readFrame) : requestAnimationFrame(readFrame);
}
function readFrame() {
  if (!stream) return;
  try {
    if (video.readyState >= 2 && video.videoWidth && video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime;
      const at = performance.now();
      // Matches the central 30% rectangle over the uncropped video.
      context.drawImage(video, video.videoWidth * 0.35, video.videoHeight * 0.35,
        video.videoWidth * 0.3, video.videoHeight * 0.3, 0, 0, 32, 32);
      const brightness = luminance(context.getImageData(0, 0, 32, 32).data);
      lastFrameAt = at;
      samples.push({ at, brightness });
      samples = samples.filter(sample => at - sample.at <= 1000);
      $("brightness").value = brightness;
      $("brightness-value").textContent = `${Math.round(brightness)} / 255`;
      if (detector) {
        const result = detector.sample(brightness, at);
        if (result) finish(result.outcome, result.elapsedMs, "Camera frames were interrupted.");
      }
      updateControls();
    }
  } catch {
    interrupt("Camera frames could not be read.");
    stopCamera();
    notice("Camera frames could not be read. Enable the camera again to retry.", "error");
  }
  scheduleFrame();
}
$("enable-camera").addEventListener("click", async () => {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    notice("Camera access requires HTTPS on iPhone (or localhost on this computer). Open the secure address and try again.", "error");
    return;
  }
  const request = ++cameraRequest;
  opening = true;
  updateControls();
  notice("Allow camera access when your browser asks. No microphone access is requested.");
  let acquired;
  try {
    acquired = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: "environment" }, width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15, max: 30 } },
    });
    if (request !== cameraRequest || document.hidden) { acquired.getTracks().forEach(track => track.stop()); return; }
    stream = acquired;
    video.srcObject = stream;
    video.hidden = false;
    await video.play();
    if (request !== cameraRequest) return;
    opening = false;
    $("camera-placeholder").hidden = true;
    $("target").hidden = false;
    $("camera-status").textContent = "Camera live";
    $("camera-status").className = "badge tone-ok";
    for (const track of stream.getVideoTracks()) {
      for (const event of ["ended", "mute"]) track.addEventListener(event, () => {
        if (stream !== acquired) return;
        interrupt("Camera access was interrupted.");
        stopCamera();
        notice("Camera access was interrupted. Enable it again and recalibrate before another test.", "error");
      });
    }
    lastFrameAt = performance.now();
    scheduleFrame();
    notice("Switch the bicycle light off, wait for the preview to settle, then capture ambient brightness.");
    updateControls();
  } catch (error) {
    acquired?.getTracks().forEach(track => track.stop());
    if (request !== cameraRequest) return;
    stopCamera();
    const messages = {
      NotAllowedError: "Camera permission was denied. Allow camera access in Safari’s website settings, then try again.",
      NotFoundError: "No camera was found. Open this app on a device with a camera.",
      NotReadableError: "The camera is busy or unavailable. Close other camera apps and try again.",
    };
    notice(messages[error.name] || "Could not open the camera. Check camera permissions and try again.", "error");
  }
});
$("disable-camera").addEventListener("click", () => {
  const running = Boolean(detector);
  interrupt("Camera released.");
  stopCamera();
  if (!running) notice("Camera released. Enable it when you are ready for another test.");
});
$("calibrate").addEventListener("click", () => {
  if (!stableSignal() || detector) return;
  ambient = samples.reduce((sum, sample) => sum + sample.brightness, 0) / samples.length;
  $("calibration-status").textContent = `Ambient captured: ${Math.round(ambient)} / 255. Switch the light on and let the preview settle.`;
  notice("Switch the bicycle light on, keep it in the center box, then press Start test.");
  updateControls();
});
$("start").addEventListener("click", () => {
  if (detector || ambient === null || !stableSignal()) return;
  if (samples.some(sample => sample.brightness - ambient < MIN_CONTRAST)) {
    notice("The light needs to be brighter than ambient for one second. Turn it on, center it, or dim the room, then try again.", "error");
    return;
  }
  const illuminated = samples.reduce((sum, sample) => sum + sample.brightness, 0) / samples.length;
  detector = new LightDetector({ ambient, illuminated, startedAt: performance.now() });
  activeTest = {
    id: crypto.randomUUID(), name: $("light-name").value.trim() || "Unnamed light",
    startedAt: new Date().toISOString(), ambient, illuminated, threshold: detector.threshold,
  };
  const test = activeTest;
  unlockAudio().then(() => {
    if (activeTest === test) $("sound-status").textContent = "Alert ready. Keep your volume turned up.";
  }).catch(() => {
    $("sound-status").textContent = "Sound could not be enabled. Use Test alert sound to retry; the timer still works.";
  });
  requestWakeLock(test);
  testStatus("Measuring", "ok");
  $("timer").textContent = "00:00:00.0";
  $("timer-detail").textContent = `Stops after 0.75 s below the off threshold (${Math.round(detector.threshold)} / 255).`;
  notice("Test running. Keep this page visible, the screen unlocked, and the light in the center box.");
  updateControls();
});
$("cancel").addEventListener("click", () => {
  if (!detector) return;
  $("timer").textContent = formatDuration(performance.now() - detector.startedAt);
  detector = null;
  activeTest = null;
  releaseWakeLock();
  testStatus("Cancelled", "neutral");
  $("timer-detail").textContent = "Cancelled tests are not saved.";
  notice("Test cancelled. No result was saved. You can start another test.");
  updateControls();
});
$("sound-test").addEventListener("click", async () => {
  try {
    await unlockAudio();
    beep();
    $("sound-status").textContent = "Alert played. Check that you heard three beeps.";
  } catch {
    $("sound-status").textContent = "Sound is unavailable. Check your volume and browser sound permissions.";
  }
});
$("export").addEventListener("click", () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(results, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `light-tests-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
});
setInterval(() => {
  if (stream && !opening && performance.now() - lastFrameAt > MAX_FRAME_GAP_MS) {
    interrupt("No fresh camera frames arrived.");
    stopCamera();
    notice("The camera stopped sending frames. Enable it again to start a new test; any active test was marked interrupted.", "error");
  }
  if (detector) $("timer").textContent = formatDuration(performance.now() - detector.startedAt);
}, 100);
function leavePage() {
  interrupt("The page was hidden or the screen was locked.");
  stopCamera();
}
document.addEventListener("visibilitychange", () => { if (document.hidden) leavePage(); });
window.addEventListener("pagehide", leavePage);
window.addEventListener("beforeunload", event => {
  if (detector) { event.preventDefault(); event.returnValue = ""; }
});
renderResults();
updateControls();
