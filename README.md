# Light tester

An iPhone-friendly bicycle-light runtime tester. Plain JavaScript reads the rear
camera locally, detects a sustained brightness drop, sounds an alert, and saves
results to localStorage. Python's `http.server` serves static files; no Python
packages, frontend build, accounts, or database are required.

## Run

```sh
python3 server.py
```

Open http://localhost:8000 on the same computer. Only `static/` is served, so
source files and TLS keys outside that directory are not exposed.

### Use on an iPhone

Camera access requires a secure context. A plain `http://192.168.…` address on
your LAN will **not** work. Serve behind an HTTPS reverse proxy, or provide a
certificate and private key trusted by the phone:

```sh
python3 server.py --host 0.0.0.0 --port 8443 --cert /path/to/cert.pem --key /path/to/key.pem
```

Connect the phone to the same network and open
`https://<certificate-hostname>:8443` in Safari. The certificate must cover that
hostname/IP and its issuing CA must be trusted on the phone; bypassing a
certificate warning is not a reliable camera setup. Keep private keys outside
`static/`. Alternatively, serve `static/` from an existing HTTPS web server.

## Test a light

1. Secure the phone and light so neither moves. Select a steady light mode.
2. Enable the camera. Align the light in the center rectangle.
3. Turn the bicycle light off, let exposure settle, then capture ambient.
4. Turn it on, wait for at least a second of brighter frames, and press Start test.
   Timing begins at this tap, not at the earlier physical switch-on.
5. Keep Safari visible and the phone unlocked. The app requests a screen wake
   lock when supported; otherwise disable Auto-Lock for the test. Use Test alert
   sound and check the phone volume before leaving it running.
6. When the light switches off, the timer stops and the app plays three beeps.
   Results appear immediately and are saved in this browser. Export JSON to keep
   a backup. Individual results can be deleted after confirmation.

The app measures average weighted RGB luminance in the center 30% of each frame.
Calibration averages roughly one second of frames. Starting requires at least
20 brightness levels of contrast above ambient. The off threshold is ambient
plus 25% of the initial contrast; 8% hysteresis rejects small threshold noise.
Darkness must persist for 750 ms, with the duration ending at the first dark
frame. Timing uses a monotonic clock. This is an approximate camera measurement,
not a calibrated photometer: auto-exposure, ambient changes, blinking and camera
frame rate affect results. Keep the beam large enough to fill the center box.

Hiding the page, locking the screen, releasing/losing the camera, or a frame gap
over 1.5 seconds marks an active test **interrupted**, using the last observed
frame as its partial duration. Interrupted tests are never labeled completed.
Cancel discards the active test. Force-quitting the browser can lose an active
test before lifecycle events run. Storage errors are shown explicitly; results
remain exportable in the current tab. Use one tab for measurements; history is
stored per browser origin, and concurrent tabs do not merge edits.

## Styling and privacy

The interface follows the [milessic-themes manifesto](https://mjthemes.mikrus.dev/manifesto):
shared layout/component classes, native controls, text-labeled states, and public
tokens for app widgets. It uses the fixed System theme (automatic light/dark),
vendored from contract version `1.12.0`, including picker previews imported by the
bundle. Attribution is visible in the app. See `static/themes/NOTICE.md`.
The app remains functional without styling. There are no remote runtime assets
or camera uploads. Camera frames are processed in memory, not saved. Results use
the `light-tester.results.v1` localStorage key until deleted or browser data is cleared.

Browser platform references: [camera secure-context requirements](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia),
[screen wake locks](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API),
and [audio user-gesture requirements](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices).

## Verify

Node.js 18+ is needed only for the dependency-free automated tests:

```sh
npm test
python3 -m py_compile server.py
```

Optional browser integration checks use Python Playwright with synthetic camera
frames (no physical camera required). Install Playwright and its Chromium/WebKit
browsers in a development environment, start `python3 server.py --port 8768`, then
run `python tests/browser_smoke.py` and
`python tests/browser_smoke.py --browser webkit`. Screenshots are written to `/tmp`.

On a real iPhone, verify camera permission/retry, ambient calibration, bright
start, brief flicker rejection, sustained darkness, audible alert, persistence
after reload, and interruption on app switching or screen locking. Synthetic
camera tests cannot verify real hardware exposure or iOS audio routing.
