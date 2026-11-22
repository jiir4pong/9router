// One Chromium process, a fresh context per request.
// Two accounts never share a context — each request gets its own browser
// context so cookies/sessions never leak between users.

let slot = null;
let inflight = 0;
let idleTimer = null;

const AIPASS_WEB_BROWSER_IDLE_MS = 60000;

function alive(browser) {
  if (typeof browser.isConnected !== "function") return true;
  return browser.isConnected();
}

function clearIdle() {
  if (!idleTimer) return;
  clearTimeout(idleTimer);
  idleTimer = null;
}

export async function acquireAipassBrowser(launch, log) {
  clearIdle();
  if (slot && slot.launch === launch && alive(slot.browser)) {
    inflight += 1;
    return slot.browser;
  }
  if (slot) {
    const previous = slot.browser;
    slot = null;
    await previous.close().catch(() => undefined);
  }
  const browser = await launch({ headless: true });
  slot = { launch, browser };
  inflight += 1;
  return browser;
}

export async function releaseAipassBrowser(browser) {
  inflight = Math.max(0, inflight - 1);
  if (inflight > 0 || slot?.browser !== browser) return;
  clearIdle();
  idleTimer = setTimeout(() => {
    idleTimer = null;
    if (inflight === 0 && slot?.browser === browser) {
      slot = null;
      void browser.close().catch(() => undefined);
    }
  }, AIPASS_WEB_BROWSER_IDLE_MS);
  idleTimer.unref?.();
}

export async function resetAipassBrowserLeaseForTests() {
  clearIdle();
  inflight = 0;
  const previous = slot?.browser;
  slot = null;
  if (previous) await previous.close().catch(() => undefined);
}
