export default {
  id: "aipass-web",
  priority: 230,
  alias: "aipass-web",
  aliases: ["aipass"],
  uiAlias: "aipass-web",
  display: {
    name: "Aipass Enterprise",
    icon: "smart_tool",
    color: "#6A1B9A",
    textIcon: "AE",
    website: "https://de.aipass.net",
  },
  category: "webCookie",
  authType: "cookie",
  serviceKinds: ["chat"],
  authHint:
    "Log in to https://de.aipass.net first. The executor opens de.aipass.net/ge/open in a real browser " +
    "so your existing session cookie stays inside the browser — nothing is read or forwarded out.",
  transport: {
    baseUrl: "https://de.aipass.net",
    format: "openai",
    authType: "cookie",
  },
  models: [
    { id: "ge/gemini-3.5-flash", name: "Gemini 3.5 Flash (Enterprise)" },
    { id: "ge/gemini-4-carbon", name: "Gemini 4 Carbon (Enterprise)" },
    { id: "ge/gemini-4-argon", name: "Gemini 4 Argon (Enterprise)" },
    { id: "ge/gemini-3.8-flash", name: "Gemini 3.8 Flash (Enterprise)" },
    { id: "ge/gemini-3.1-pro-preview", name: "Gemini 3.1 Pro Preview (Enterprise)" },
    { id: "ge/auto", name: "Auto (Enterprise)" },
  ],
};
