// End-to-end privacy invariant test in real browsers (DESIGN.md §31.1, §40).
//
//   npm run test:e2e                 # Firefox and Chrome
//   npm run test:e2e -- firefox      # one browser
//
// Types canary values into fixture forms, then asserts that none of them appear in:
//   - what the Jev mock received (via the real Go relay)
//   - the relay's access log
//   - the extension's storage.local / storage.session
// Chrome uses Playwright's bundled Chromium (branded Chrome no longer loads unpacked
// extensions from the command line); Firefox uses the installed Firefox via WebDriver BiDi.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const extensionDir = join(here, "../..");
const repo = join(extensionDir, "..");
const fixtures = join(repo, "fixtures");
const work = mkdtempSync(join(tmpdir(), "privacy-lint-e2e-"));
const record = join(work, "jev-received.jsonl");

const CANARIES = ["山田太郎", "taro@example.com", "4111111111111111", "super-secret-password", "09098765432", "東京都千代田区千代田1-1"];
const FIREFOX_ID = "privacy-lint@ieee0824.github.io";
const FIREFOX_UUID = "6d1d7a5e-9d7c-4c3e-9a55-5e2e2e000001";
const FIREFOX_BIN = process.env.FIREFOX_BIN ?? "/Applications/Firefox.app/Contents/MacOS/firefox";

const port = 22000 + Math.floor(Math.random() * 3000);
const sitePort = port;
const otherSitePort = port + 1;
const relayPort = port + 2;
const jevPort = port + 3;
const site = `http://127.0.0.1:${sitePort}`;
const relayUrl = `http://127.0.0.1:${relayPort}`;

const procs = [];
const relayLog = [];
const failures = [];

function check(name, ok, detail = "") {
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${!ok && detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(name);
}

function leaks(text) {
  return CANARIES.filter((c) => text.includes(c));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, timeoutMs, label) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const v = await fn();
    if (v) return v;
    await sleep(200);
  }
  throw new Error(`timeout: ${label}`);
}

function recordedLines() {
  return existsSync(record) ? readFileSync(record, "utf8").trim().split("\n").filter(Boolean).length : 0;
}

// ---------- infrastructure ----------

function serveFixtures(listenPort) {
  const server = createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${listenPort}`);
    const file = normalize(join(fixtures, decodeURIComponent(url.pathname)));
    if (!file.startsWith(fixtures) || !existsSync(file) || extname(file) !== ".html") {
      res.writeHead(404).end("not found");
      return;
    }
    let html = readFileSync(file, "utf8");
    // Fixture H: make the embedded form genuinely cross-origin.
    html = html.replace('src="frame.html"', `src="http://localhost:${otherSitePort}/ambiguous/h-iframe/frame.html"`);
    const extra = join(file, "..", "headers.json");
    const headers = existsSync(extra) ? JSON.parse(readFileSync(extra, "utf8")) : {};
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", ...headers }).end(html);
  });
  server.listen(listenPort, "127.0.0.1");
  return server;
}

async function startInfrastructure() {
  execFileSync("node", ["scripts/build.mjs", "--e2e", `--relay-url=${relayUrl}`], { cwd: extensionDir, stdio: "inherit" });
  const relayBin = join(tmpdir(), "privacy-lint-e2e-relay");
  const jevBin = join(tmpdir(), "privacy-lint-e2e-jevmock");
  execFileSync("go", ["build", "-o", relayBin, "./cmd/relay"], { cwd: join(repo, "relay") });
  execFileSync("go", ["build", "-o", jevBin, "./cmd/jevmock"], { cwd: join(repo, "relay") });

  procs.push(spawn(jevBin, ["-addr", `127.0.0.1:${jevPort}`, "-record", record], { stdio: "ignore" }));
  const relay = spawn(relayBin, ["-addr", `127.0.0.1:${relayPort}`, "-jev-endpoint", `http://127.0.0.1:${jevPort}/v1/systemone`, "-rate", "0"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  relay.stdout.on("data", (d) => relayLog.push(String(d)));
  relay.stderr.on("data", (d) => relayLog.push(String(d)));
  procs.push(relay);

  const servers = [serveFixtures(sitePort), serveFixtures(otherSitePort)];
  const up = async (u) => {
    try {
      return (await fetch(u)).ok;
    } catch {
      return false;
    }
  };
  await waitFor(() => up(`http://127.0.0.1:${jevPort}/healthz`), 10000, "jevmock");
  await waitFor(() => up(`${relayUrl}/healthz`), 10000, "relay");
  return servers;
}

// ---------- browser drivers ----------
// Each driver exposes: open(url) → page, type(page, selector, text), focus(page, selector),
// pageEval(page, fn), storage() → { local, session }, close().

async function chromeDriver() {
  const { chromium } = await import("playwright");
  const dist = join(extensionDir, "dist/chrome-e2e");
  const context = await chromium.launchPersistentContext(join(work, "chrome-profile"), {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  const extensionId = new URL(worker.url()).host;
  // Static e2e host permissions: wait until the background has registered the content script.
  await waitFor(() => worker.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).length > 0), 10000, "content script registration");
  // Onboarding opens the options page on install and may reuse a blank tab; wait for it so it
  // cannot interrupt the scenario's first navigation.
  const onboarding = await waitFor(
    () => context.pages().some((p) => p.url() === `chrome-extension://${extensionId}/options.html`),
    10000,
    "onboarding options page",
  ).catch(() => false);
  check("chrome: options page opens on install (onboarding)", onboarding === true);
  return {
    name: "chrome",
    async open(url) {
      const page = await context.newPage();
      await page.goto(url);
      return page;
    },
    type: (page, selector, text) => page.fill(selector, text),
    focus: (page, selector) => page.focus(selector),
    pageEval: (page, fn) => page.evaluate(fn),
    async storage() {
      const page = await context.newPage();
      await page.goto(`chrome-extension://${extensionId}/options.html`);
      const data = await page.evaluate(async () => ({
        local: await chrome.storage.local.get(null),
        session: await chrome.storage.session.get(null),
      }));
      await page.close();
      return data;
    },
    close: () => context.close(),
  };
}

async function firefoxDriver() {
  const puppeteer = (await import("puppeteer-core")).default;
  const browser = await puppeteer.launch({
    browser: "firefox",
    executablePath: FIREFOX_BIN,
    headless: true,
    pipe: true,
    enableExtensions: true,
    userDataDir: join(work, "firefox-profile"),
    extraPrefsFirefox: {
      "extensions.webextensions.uuids": JSON.stringify({ [FIREFOX_ID]: FIREFOX_UUID }),
    },
  });
  await browser.installExtension(join(extensionDir, "dist/firefox-e2e"));
  await sleep(1500);
  return {
    name: "firefox",
    async open(url) {
      const page = await browser.newPage();
      await page.goto(url);
      return page;
    },
    async type(page, selector, text) {
      await page.focus(selector);
      await page.keyboard.type(text);
    },
    focus: (page, selector) => page.focus(selector),
    pageEval: (page, fn) => page.evaluate(fn),
    async storage() {
      // WebDriver BiDi does not expose moz-extension:// contexts, so the --e2e build's
      // content script relays a storage dump into the page DOM on request.
      const page = await browser.newPage();
      await page.goto(`${site}/good/a-ec/index.html`);
      await sleep(1500);
      await page.evaluate(() => document.dispatchEvent(new Event("privacy-lint-e2e-dump")));
      const dump = await waitFor(
        () => page.evaluate(() => document.documentElement.getAttribute("data-privacy-lint-e2e-dump")),
        5000,
        "storage dump",
      );
      await page.close();
      return JSON.parse(dump);
    },
    close: () => browser.close(),
  };
}

// ---------- scenario ----------

async function runScenario(driver) {
  console.log(`\n[${driver.name}]`);
  const before = recordedLines();

  // Fixture A: type canaries into every sensitive field.
  const a = await driver.open(`${site}/good/a-ec/index.html`);
  await waitFor(() => recordedLines() > before, 20000, "assessment request for fixture A");
  check("fixture A: assessment reached the relay", true);
  await driver.type(a, "#name", "山田太郎");
  await driver.type(a, "#email", "taro@example.com");
  await driver.type(a, "#tel", "09098765432");
  await driver.type(a, "#addr", "東京都千代田区千代田1-1");
  await driver.type(a, "#cc", "4111111111111111");
  const notice = await waitFor(
    () => driver.pageEval(a, () => document.getElementById("privacy-lint-notice-host") !== null),
    8000,
    "in-page notice",
  ).catch(() => false);
  // Served over plain http, so the assessment floors at VERIFY_BEFORE_INPUT and the notice must appear.
  check("fixture A: non-blocking notice shown after focusing a sensitive field", notice === true);

  // Fixture G: form rendered later by the page's own script.
  const beforeG = recordedLines();
  await driver.open(`${site}/good/g-spa/index.html`);
  const spa = await waitFor(() => recordedLines() > beforeG, 15000, "SPA assessment").catch(() => false);
  check("fixture G: late-rendered form is detected", spa !== false);

  // Fixture H: the form lives in a cross-origin iframe; the top frame has none.
  const beforeH = recordedLines();
  await driver.open(`${site}/ambiguous/h-iframe/index.html`);
  await sleep(3000);
  check("fixture H: cross-origin iframe form is not read", recordedLines() === beforeH);

  // Adversarial fixture: canaries plus a hostile page script.
  const x = await driver.open(`${site}/caution/x-adversarial/index.html`);
  await driver.type(x, 'input[name="email"]', "taro@example.com");
  await driver.type(x, 'input[type="password"]', "super-secret-password");
  await sleep(4000);

  const { local, session } = await driver.storage();
  const stored = JSON.stringify({ local, session });
  check("extension storage holds no canary", leaks(stored).length === 0, leaks(stored).join(", "));
  check("extension storage holds no plain origins in cache keys", !/127\.0\.0\.1/.test(Object.keys(local).join(" ")));
  const doneTabs = Object.values(session).filter((v) => v && v.kind === "done").length;
  check("tab status recorded in storage.session", doneTabs >= 1, `done tabs: ${doneTabs}`);

  await driver.close();
}

async function main() {
  const only = process.argv[2];
  const servers = await startInfrastructure();
  try {
    for (const make of [firefoxDriver, chromeDriver]) {
      const driver = await make().catch((e) => {
        check(`launch ${make.name}`, false, e.message);
        return null;
      });
      if (!driver) continue;
      if (only && driver.name !== only) {
        await driver.close();
        continue;
      }
      await runScenario(driver).catch(async (e) => {
        check(`${driver.name} scenario`, false, e.message);
        await driver.close().catch(() => {});
      });
    }
  } finally {
    await sleep(500);
    const received = existsSync(record) ? readFileSync(record, "utf8") : "";
    const log = relayLog.join("");
    console.log("\n[relay / Jev mock]");
    check("Jev mock received requests", received.length > 0);
    check("Jev mock received no canary", leaks(received).length === 0, leaks(received).join(", "));
    check("Jev mock received no hidden/prefilled values", !/HIDDEN-SESSION-CANARY|prefilled-victim|QUERY-CANARY/.test(received));
    check("relay log holds no canary or page content", leaks(log).length === 0 && !log.includes(site) && !/Ignore all/.test(log));
    writeFileSync(join(work, "relay.log"), log);
    procs.forEach((p) => p.kill());
    servers.forEach((s) => s.close());
    console.log(`\nartifacts: ${work}`);
    if (failures.length) {
      console.log(`\n${failures.length} check(s) failed`);
      process.exit(1);
    }
    console.log("\nall checks passed");
  }
}

main().catch((e) => {
  console.error(e);
  procs.forEach((p) => p.kill());
  process.exit(1);
});
