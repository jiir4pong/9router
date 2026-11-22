// DOM-based reply capture for the de.aipass.net → vertexaisearch.cloud.google flow.
//
// The Gemini Enterprise web UI streams replies into the page DOM. We poll the
// last assistant message bubble and return its text once it stabilizes.

const POLL_INTERVAL_MS = 400;
const STABLE_POLLS_DONE = 5;
const STABLE_POLLS_FORCE = 20;
const FIRST_TOKEN_TIMEOUT_MS = 30000;
const REPLY_TIMEOUT_MS = 90000;

// Try common selectors for the assistant reply bubble on vertexaisearch.cloud.google
const ASSISTANT_SELECTOR =
  "[data-test-id='model-response'], .model-response, [role='assistant'] .message-content, .gd-rich-text";

const READ_REPLY_STATE = `(() => {
  const msgs = [...document.querySelectorAll(${JSON.stringify(ASSISTANT_SELECTOR)})];
  const last = msgs.length ? (msgs[msgs.length - 1].innerText || '').trim() : '';
  return {
    count: msgs.length,
    lastText: last,
    generating: !!document.querySelector('[data-test-id="thinking-overlay-content"], button[aria-label*="Stop" i], .generating')
  };
})()`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function readAipassReplyState(page) {
  try {
    return (await page.evaluate(READ_REPLY_STATE)) || { count: 0, lastText: "", generating: false };
  } catch {
    return { count: 0, lastText: "", generating: false };
  }
}

export async function waitForAipassReply({
  page,
  baseCount = 0,
  baseText = "",
  timeoutMs = REPLY_TIMEOUT_MS,
  firstTokenMs = FIRST_TOKEN_TIMEOUT_MS,
  signal,
  onDelta,
}) {
  const started = Date.now();
  let emitted = "";
  let last = null;
  let stable = 0;
  let gotFirst = false;

  while (true) {
    if (signal?.aborted) throw new Error("Request aborted");
    const elapsed = Date.now() - started;
    if (elapsed > timeoutMs) throw new Error("Aipass Enterprise reply timed out");
    if (!gotFirst && elapsed > firstTokenMs) throw new Error("no first token from Aipass Enterprise");
    await sleep(POLL_INTERVAL_MS);

    const st = await readAipassReplyState(page);
    const text = st.lastText || "";
    const isNew = st.count > baseCount || (text && text !== baseText);
    if (!isNew || !text) continue;

    gotFirst = true;
    if (text !== last) {
      last = text;
      stable = 0;
    } else {
      stable++;
    }

    if (!st.generating && text !== emitted) {
      const delta = text.startsWith(emitted) ? text.slice(emitted.length) : text;
      if (delta) {
        emitted = text;
        onDelta?.(delta);
      }
    }
    if (stable >= STABLE_POLLS_FORCE) return emitted || text;
    if (!st.generating && stable >= STABLE_POLLS_DONE && text === emitted) return emitted;
  }
}
