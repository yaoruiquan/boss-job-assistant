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

const DEFAULT_CONTROL = {
  enabled: false,
  paused: false,
  lastResult: null,
  updatedAt: ""
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

function nowIso() {
  return new Date().toISOString();
}

async function getRules() {
  const stored = await chrome.storage.local.get({ rules: DEFAULT_RULES });
  return { ...DEFAULT_RULES, ...(stored.rules || {}) };
}

async function saveRules(rules) {
  await chrome.storage.local.set({ rules: { ...DEFAULT_RULES, ...rules } });
  return getRules();
}

async function getControl() {
  const stored = await chrome.storage.local.get({ control: DEFAULT_CONTROL });
  return { ...DEFAULT_CONTROL, ...(stored.control || {}) };
}

async function saveControl(patch) {
  const current = await getControl();
  const control = { ...current, ...patch, updatedAt: nowIso() };
  await chrome.storage.local.set({ control });
  return control;
}

async function saveLastResult(result) {
  await saveControl({ lastResult: result || null });
}

function isGuardedCommand(command) {
  return command === "greet_current" || command === "greet_detail";
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    const type = message?.type;
    if (type === "get_state") {
      sendResponse({ ok: true, rules: await getRules(), control: await getControl() });
      return;
    }
    if (type === "set_enabled") {
      const enabled = Boolean(message.enabled);
      const control = await saveControl({ enabled, paused: enabled ? false : true });
      sendResponse({ ok: true, control });
      return;
    }
    if (type === "set_paused") {
      const control = await saveControl({ paused: Boolean(message.paused) });
      sendResponse({ ok: true, control });
      return;
    }
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
      const payload = message.payload || {};
      const control = await getControl();
      if (isGuardedCommand(payload.command) && !control.enabled) {
        const result = { ok: false, reason: "assistant_disabled" };
        await saveLastResult(result);
        sendResponse(result);
        return;
      }
      if (isGuardedCommand(payload.command) && control.paused) {
        const result = { ok: false, reason: "assistant_paused" };
        await saveLastResult(result);
        sendResponse(result);
        return;
      }
      const result = await sendNative({ ...payload, rules });
      await saveLastResult(result);
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
  const control = await chrome.storage.local.get("control");
  if (!control.control) {
    await chrome.storage.local.set({ control: DEFAULT_CONTROL });
  }
});
