// Request-contract guards for the Aipass Web executor.
//
// aipass-web drives the de.aipass.net → vertexaisearch.cloud.google web UI.
// There is no JSON request body on the wire, so controls like reasoning_effort
// and forced tool_choice cannot be honored natively.

export const AIPASS_WEB_UNSUPPORTED_CONTROL_CODE = "unsupported_control_for_provider";

const SATISFIED_EFFORT_LEVELS = new Set(["none", "minimal"]);
const FORCING_TOOL_CHOICE_STRINGS = new Set(["required", "any"]);
const FORCING_TOOL_CHOICE_TYPES = new Set(["function", "tool", "any"]);

function normalizeString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim().toLowerCase() : null;
}

export function isForcingToolChoice(toolChoice) {
  const asString = normalizeString(toolChoice);
  if (asString) return FORCING_TOOL_CHOICE_STRINGS.has(asString);
  if (toolChoice && typeof toolChoice === "object" && !Array.isArray(toolChoice)) {
    const type = normalizeString(toolChoice.type);
    return type !== null && FORCING_TOOL_CHOICE_TYPES.has(type);
  }
  return false;
}

export function requestsThinkingBudget(reasoningEffort) {
  const effort = normalizeString(reasoningEffort);
  if (effort === null) return false;
  return !SATISFIED_EFFORT_LEVELS.has(effort);
}

export function checkAipassWebUnsupportedControls(body) {
  if (!body || typeof body !== "object") return null;
  if (requestsThinkingBudget(body.reasoning_effort)) {
    return {
      param: "reasoning_effort",
      message:
        'Provider "aipass-web" does not support "reasoning_effort". It drives the de.aipass.net ' +
        "web UI through a typed prompt and has no thinking-budget control. Remove " +
        '"reasoning_effort" (or send "none"/"minimal").',
    };
  }
  if (isForcingToolChoice(body.tool_choice)) {
    return {
      param: "tool_choice",
      message:
        'Provider "aipass-web" cannot guarantee a forced tool call. Use "auto" or omit tool_choice.',
    };
  }
  return null;
}
