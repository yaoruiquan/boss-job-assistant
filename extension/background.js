const NATIVE_HOST = "com.yao.boss_job_assistant";

const DEFAULT_RULES = {
  city: "杭州",
  title: "ai应用开发",
  employmentType: "实习",
  companySize: ["100-499人", "500-999人", "1000-9999人", "10000人以上"],
  financingStage: ["B轮", "C轮", "D轮及以上", "已上市"],
  dailyLimit: 20,
  sessionLimit: 10,
  greeting: "您好，我对这个岗位比较感兴趣，想进一步了解一下。"
};

function sendNative(payload) {
  return new Promise((resolve) => {
    chrome.runtime.sendNativeMessage(NATIVE_HOST, payload, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        resolve({ ok: false, reason: "native_host_unavailable", error: error.message });
        return;
      }
      resolve(response || { ok: false, reason: "empty_native_response" });
    });
  });
}

async function getRules() {
  const stored = await chrome.storage.local.get({ rules: DEFAULT_RULES });
  return { ...DEFAULT_RULES, ...(stored.rules || {}) };
}

async function saveRules(rules) {
  await chrome.storage.local.set({ rules: { ...DEFAULT_RULES, ...rules } });
  return getRules();
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    const type = message?.type;
    if (type === "get_rules") {
      sendResponse({ ok: true, rules: await getRules() });
      return;
    }
    if (type === "save_rules") {
      sendResponse({ ok: true, rules: await saveRules(message.rules || {}) });
      return;
    }
    if (type === "native") {
      const rules = await getRules();
      const result = await sendNative({ ...(message.payload || {}), rules });
      sendResponse(result);
      return;
    }
    sendResponse({ ok: false, reason: "unknown_extension_message" });
  })();
  return true;
});

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get("rules");
  if (!existing.rules) {
    await chrome.storage.local.set({ rules: DEFAULT_RULES });
  }
});
