"""Optional integration checks: pip install playwright; playwright install chromium.

Start server.py on port 8768, then run this file. Pass --browser webkit to check
WebKit too. Synthetic camera frames exercise the real video/canvas pipeline.
"""

import argparse
from playwright.sync_api import sync_playwright, expect

FAKE_CAMERA = """(() => {
  window.testBrightness = 20;
  window.testBeeps = 0;
  window.denyCamera = false;
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = async function(...args) {
    try { return await play.apply(this, args); }
    catch (error) { window.testPlayError = `${error.name}: ${error.message}`; throw error; }
  };
  const Audio = window.AudioContext || window.webkitAudioContext;
  const original = Audio.prototype.createOscillator;
  Audio.prototype.createOscillator = function(...args) {
    window.testBeeps++;
    return original.apply(this, args);
  };
  navigator.mediaDevices.getUserMedia = async () => {
    if (window.denyCamera) throw new DOMException('Denied', 'NotAllowedError');
    const canvas = document.createElement('canvas');
    canvas.width = 640; canvas.height = 480;
    const ctx = canvas.getContext('2d');
    const paint = () => {
      ctx.fillStyle = `rgb(${window.testBrightness}, ${window.testBrightness}, ${window.testBrightness})`;
      ctx.fillRect(0, 0, 640, 480);
    };
    paint();
    window.paintTimer = setInterval(paint, 50);
    window.testStream = canvas.captureStream(20);
    return window.testStream;
  };
})();"""


def ready(page):
    page.locator("#enable-camera").click()
    try:
        expect(page.locator("#calibrate")).to_be_enabled()
    except AssertionError:
        print(page.evaluate("""({notice: document.querySelector('#notice').textContent,
          camera: document.querySelector('#camera-status').textContent,
          time: document.querySelector('video').currentTime,
          paused: document.querySelector('video').paused,
          ready: document.querySelector('video').readyState, hidden: document.hidden,
          muted: document.querySelector('video').muted, playError: window.testPlayError,
          deny: window.denyCamera, gum: navigator.mediaDevices.getUserMedia.toString()})"""))
        raise
    page.locator("#calibrate").click()
    page.evaluate("window.testBrightness = 220")
    page.wait_for_timeout(1200)
    page.locator("#start").click()
    expect(page.locator("#test-status")).to_have_text("Measuring")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--browser", default="chromium", choices=["chromium", "webkit"])
    args = parser.parse_args()
    with sync_playwright() as playwright:
        browser = getattr(playwright, args.browser).launch()
        context = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=1)
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        assert page.goto("http://127.0.0.1:8768").status == 200
        # WebKit may replace MediaDevices during navigation, after init scripts.
        # Install the synthetic camera once the document has finished loading.
        page.evaluate(FAKE_CAMERA)
        assert context.request.get("http://127.0.0.1:8768/server.py").status == 404
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
        page.screenshot(path=f"/tmp/light-tester-{args.browser}-mobile.png", full_page=True)
        page.locator("#enable-camera").click()
        expect(page.locator("#calibrate")).to_be_enabled()
        page.locator("#calibrate").click()
        page.locator("#start").click()
        expect(page.locator("#notice")).to_contain_text("brighter than ambient")
        page.locator("#light-name").fill("Front light <test>")
        page.evaluate("window.testBrightness = 220")
        page.wait_for_timeout(1200)
        page.locator("#start").click()
        expect(page.locator("#test-status")).to_have_text("Measuring")
        page.evaluate("window.testBrightness = 20")
        page.wait_for_timeout(250)
        page.evaluate("window.testBrightness = 220")
        page.wait_for_timeout(500)
        expect(page.locator("#test-status")).to_have_text("Measuring")
        page.evaluate("window.testBrightness = 20")
        expect(page.locator("#test-status")).to_have_text("Light off")
        expect(page.locator("#result-rows tr")).to_have_count(1)
        assert page.evaluate("window.testBeeps") == 3
        data = page.evaluate("JSON.parse(localStorage.getItem('light-tester.results.v1'))")
        assert data[0]["name"] == "Front light <test>"
        assert data[0]["outcome"] == "completed" and data[0]["elapsedMs"] >= 500
        frozen = page.locator("#timer").inner_text()
        page.wait_for_timeout(200)
        assert page.locator("#timer").inner_text() == frozen
        page.reload()
        page.evaluate(FAKE_CAMERA)
        expect(page.locator("#result-rows tr")).to_have_count(1)
        ready(page)
        page.locator("#cancel").click()
        expect(page.locator("#result-rows tr")).to_have_count(1)
        page.locator("#start").click()
        page.evaluate("window.testStream.getVideoTracks()[0].dispatchEvent(new Event('ended'))")
        expect(page.locator("#test-status")).to_have_text("Interrupted")
        expect(page.locator("#result-rows tr")).to_have_count(2)
        page.evaluate("window.denyCamera = true")
        page.locator("#enable-camera").click()
        expect(page.locator("#notice")).to_contain_text("permission was denied")
        expect(page.locator("#enable-camera")).to_be_enabled()
        with page.expect_download() as download:
            page.locator("#export").click()
        assert download.value.suggested_filename.endswith(".json")
        page.on("dialog", lambda dialog: dialog.accept())
        page.locator("#result-rows button").first.click()
        expect(page.locator("#result-rows tr")).to_have_count(1)
        page.evaluate("localStorage.setItem('light-tester.results.v1', 'broken')")
        page.reload()
        page.evaluate(FAKE_CAMERA)
        expect(page.locator("#storage-warning")).to_be_visible()
        ready(page)
        page.evaluate("window.testBrightness = 20")
        expect(page.locator("#test-status")).to_have_text("Light off")
        assert page.evaluate("localStorage.getItem('light-tester.results.v1')") == "broken"
        expect(page.locator("#notice")).to_contain_text("export")
        assert not errors, errors
        page.set_viewport_size({"width": 1280, "height": 900})
        page.evaluate("window.scrollTo(0, 0)")
        page.screenshot(path=f"/tmp/light-tester-{args.browser}-desktop.png", full_page=True)
        page.emulate_media(color_scheme="dark")
        page.screenshot(path=f"/tmp/light-tester-{args.browser}-dark.png", full_page=True)
        browser.close()
    print(f"{args.browser}: camera, timer, flicker, audio, history, errors, export, mobile layout passed")


if __name__ == "__main__":
    main()
