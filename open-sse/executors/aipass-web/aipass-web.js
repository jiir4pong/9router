// AipassWebExecutor — de.aipass.net → vertexaisearch.cloud.google (Gemini Enterprise)
// Auth: Cookie-based (HttpOnly session cookie from de.aipass.net / Google)
// Method: Playwright browser automation
//
// Routes OpenAI chat/completions through the real browser session so the
// session cookie (set by de.aipass.net login) stays inside the browser where
// it belongs. Never reads or forwards raw cookie values out of the browser.
//
// Flow:
//   1. Open https://de.aipass.net (session cookie already present from login)
//   2. Open https://de.aipass.net/ge/open → redirects to vertexaisearch.cloud.google
//   3. Type prompt into the chat composer
//   4. Wait for assistant reply in the DOM
//   5. Return as OpenAI chat/completions format

import { BaseExecutor } from "../base.js";
import { SSE_HEADERS_NO_BUFFER } from "../../utils/sseConstants.js";
import { sseChunk } from "../../utils/sse.js";
import { loadRuntimeDep } from "../../services/lazyRuntime.js";
import {
  acquireAipassBrowser,
  releaseAipassBrowser,
} from "./browserLease.js";
import { waitForAipassReply } from "./domCapture.js";
import {
  checkAipassWebUnsupportedControls,
  AIPASS_WEB_UNSUPPORTED_CONTROL_CODE,
} from "./capabilities.js";
import { prepareToolMessages, buildToolAwareResult } from "../../translator/webTools.js";
import { buildToolModeResponse } from "../chatgptWebTools.js";

const AIPASS_URL = "https://de.aipass.net";
const AIPASS_GE_OPEN = `${AIPASS_URL}/ge/open`;
const DEFAULT_MODEL_ID = "ge/gemini-3.5-flash";

const AIPASS_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

function formatChatCompletion(content, model, finishReason = "stop") {
  return {
    id: `chatcmpl-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: finishReason, logprobs: null }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

function formatStreamChunk(content, model, finishReason = null) {
  return {
    id: `chatcmpl-${Date.now()}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta: content ? { content } : {}, finish_reason: finishReason }],
  };
}

/**
 * Flatten OpenAI-style multi-turn messages into a single plain-text prompt
 * typed into the Gemini Enterprise web UI. The web UI has no upstream
 * conversation id to thread across turns, so full history is flattened into
 * one prompt so the model still sees the conversation context.
 */
function buildPrompt(messages) {
  let prompt = "";
  for (const m of messages) {
    const role = m.role === "assistant" ? "Model" : m.role === "system" ? "System" : "User";
    prompt += `${role}: ${m.content ?? ""}\n\n`;
  }
  return prompt.trim();
}

/**
 * Navigate to de.aipass.net, then /ge/open (redirects to Vertex),
 * and return the Playwright page + context.
 * If the session cookie is expired the user will see a login page —
 * we fail fast with a clear message instead of hanging.
 */
async function openAipassEnterprisePage(browser, log) {
  const context = await browser.newContext({
    userAgent: AIPASS_USER_AGENT,
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();

  // Step 1: open de.aipass.net so the existing session cookie is established
  await page.goto(AIPASS_URL, { waitUntil: "domcontentloaded", timeout: 30000 });

  // Step 2: open /ge/open which redirects to vertexaisearch.cloud.google
  await page.goto(AIPASS_GE_OPEN, { waitUntil: "domcontentloaded", timeout: 30000 });

  // Allow the Vertex page to initialize
  await page.waitForTimeout(2000);

  return { browser, context, page };
}

export class AipassWebExecutor extends BaseExecutor {
  constructor(provider, config) {
    super(provider, config);
    this.provider = provider;
  }

  async execute({ model, body, stream, credentials, signal, log, proxyOptions = null }) {
    // Reject controls the browser UI cannot honor
    const violation = checkAipassWebUnsupportedControls(body);
    if (violation) {
      return new Response(
        JSON.stringify({
          error: {
            message: violation.message,
            type: AIPASS_WEB_UNSUPPORTED_CONTROL_CODE,
            code: violation.param,
          },
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const messages = body.messages || [];
    const prompt = buildPrompt(messages);
    const hasTools = Array.isArray(body.tools) && body.tools.length > 0;
    let requestedTools = [];
    let effectiveMessages = messages;
    if (hasTools) {
      const prepared = prepareToolMessages(messages, body.tools);
      requestedTools = prepared.requestedTools;
      effectiveMessages = prepared.effectiveMessages;
    }

    let browser = null;
    let context = null;
    let page = null;

    try {
      browser = await acquireAipassBrowser(
        async (opts) => {
          const { chromium } = await loadRuntimeDep("playwright-core");
          return chromium.launch(opts);
        },
        log
      );

      const { page: p, context: ctx } = await openAipassEnterprisePage(browser, log);
      page = p;
      context = ctx;

      // Find the chat composer and type the prompt
      const composer = await page
        .waitForSelector('textarea, [contenteditable="true"], .ql-editor', {
          timeout: 15000,
        })
        .catch(() => null);

      if (!composer) {
        throw new Error(
          "Could not find chat composer on de.aipass.net / vertex page. " +
            "Make sure you are logged in to de.aipass.net and /ge/open loads the Vertex chat UI."
        );
      }

      await composer.click();
      await page.keyboard.insertText(prompt);
      await page.waitForTimeout(300);
      await page.keyboard.press("Enter");

      // Wait for and capture the assistant reply
      const replyText = await waitForAipassReply({ page, signal, onDelta: null });

      let content = replyText || "";
      let finishReason = "stop";
      let toolCalls = null;

      if (hasTools && requestedTools.length > 0) {
        const parsed = buildToolAwareResult(content, requestedTools, "aipass");
        content = parsed.content;
        toolCalls = parsed.toolCalls;
        finishReason = parsed.finishReason;
      }

      if (!stream) {
        return new Response(
          JSON.stringify(
            formatChatCompletion(content, model ?? DEFAULT_MODEL_ID, finishReason)
          ),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      // Streaming: replay buffered response as SSE
      const encoder = new TextEncoder();
      const created = Math.floor(Date.now() / 1000);
      const cid = `chatcmpl-${created}`;
      const chunk = (delta, fr) =>
        encoder.encode(
          sseChunk({
            id: cid,
            object: "chat.completion.chunk",
            created,
            model: model ?? DEFAULT_MODEL_ID,
            choices: [{ index: 0, delta, finish_reason: fr }],
          })
        );

      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(chunk({ role: "assistant" }, null));
            if (toolCalls && toolCalls.length > 0) {
              toolCalls.forEach((call, index) => {
                controller.enqueue(chunk({ tool_calls: [{ index, ...call }] }, null));
              });
              controller.enqueue(chunk({}, finishReason));
            } else {
              controller.enqueue(chunk({ content }, finishReason));
            }
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          },
        }),
        { status: 200, headers: SSE_HEADERS_NO_BUFFER }
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log?.error?.("AIPASS-WEB", `Execute failed: ${msg}`);
      if (err instanceof Error && err.name === "AbortError") {
        return new Response(
          JSON.stringify({
            error: { message: "Request cancelled", type: "upstream_error", code: "HTTP_499" },
          }),
          { status: 499, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({
          error: { message: `Aipass Enterprise error: ${msg}`, type: "upstream_error", code: "HTTP_502" },
        }),
        { status: 502, headers: { "Content-Type": "application/json" } }
      );
    } finally {
      try {
        if (page) await page.close().catch(() => undefined);
        if (context) await context.close().catch(() => undefined);
      } catch {
        /* ignore */
      }
      if (browser) {
        await releaseAipassBrowser(browser).catch(() => undefined);
      }
    }
  }

  async getModels() {
    return [
      { id: "ge/gemini-3.5-flash", name: "Gemini 3.5 Flash (Enterprise)" },
      { id: "ge/gemini-4-carbon", name: "Gemini 4 Carbon (Enterprise)" },
      { id: "ge/gemini-4-argon", name: "Gemini 4 Argon (Enterprise)" },
      { id: "ge/gemini-3.8-flash", name: "Gemini 3.8 Flash (Enterprise)" },
      { id: "ge/gemini-3.1-pro-preview", name: "Gemini 3.1 Pro Preview (Enterprise)" },
      { id: "ge/auto", name: "Auto (Enterprise)" },
    ];
  }
}

export const aipassWebExecutor = new AipassWebExecutor("aipass-web", {
  baseUrl: "https://de.aipass.net",
  headers: {},
});

export default aipassWebExecutor;
