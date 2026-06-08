const $ = (id) => document.getElementById(id);
const commandButtons = ["status", "startChrome", "snapshot", "greetDetail", "startAutomation", "options"];

let control = { enabled: false, paused: true, lastResult: null, updatedAt: "" };
let busy = false;

function send(message) {
  return new Promise((resolve) => chrome.runtime.sendMessage(message, resolve));
}

function compactReason(result) {
  return result?.reason || result?.error || (result?.ok ? "ok" : "unknown");
}

function setBusy(label) {
  busy = Boolean(label);
  $("connectionBadge").className = "badge neutral";
  $("connectionBadge").textContent = label || "就绪";
  for (const id of commandButtons) {
    const button = $(id);
    if (button) button.disabled = busy;
  }
  $("enableToggle").disabled = busy;
  $("pauseToggle").disabled = busy || !control.enabled;
}

function renderControl() {
  $("enableToggle").className = `switch ${control.enabled ? "on" : "off"}`;
  $("enableLabel").textContent = control.enabled ? "关闭助手" : "开启助手";
  $("pauseToggle").className = `switch ${control.paused ? "muted" : "on"}`;
  $("pauseLabel").textContent = control.paused ? "继续" : "暂停";
  $("pauseToggle").disabled = busy || !control.enabled;

  let text = "未开启";
  if (control.enabled && control.paused) text = "已暂停";
  if (control.enabled && !control.paused) text = "运行中";
  $("controlState").textContent = text;
}

function renderResult(result) {
  if (!result) {
    $("output").textContent = "";
    $("lastReason").textContent = "等待操作";
    return;
  }
  const ok = Boolean(result.ok);
  $("connectionBadge").className = `badge ${ok ? "ok" : "bad"}`;
  $("connectionBadge").textContent = ok ? "正常" : "停止";
  $("connectionState").textContent = compactReason(result);
  $("lastReason").textContent = compactReason(result);
  if (typeof result.runCount === "number") $("runCount").textContent = String(result.runCount);
  if (Array.isArray(result.runs)) $("runCount").textContent = String(result.runs.length);
  $("lastUpdated").textContent = new Date().toLocaleTimeString();
  $("output").textContent = JSON.stringify(result, null, 2);
}

async function loadState() {
  const state = await send({ type: "get_state" });
  control = state.control || control;
  renderControl();
  renderResult(control.lastResult);
}

async function native(command, label) {
  setBusy(label || "执行中");
  const result = await send({ type: "native", payload: { command } });
  const state = await send({ type: "get_state" });
  control = state.control || control;
  renderControl();
  renderResult(result);
  setBusy("");
  return result;
}

async function setEnabled(enabled) {
  setBusy(enabled ? "开启中" : "关闭中");
  const response = await send({ type: "set_enabled", enabled });
  control = response.control || control;
  renderControl();
  renderResult({ ok: true, reason: enabled ? "assistant_enabled" : "assistant_disabled" });
  setBusy("");
}

async function setPaused(paused) {
  setBusy(paused ? "暂停中" : "继续中");
  const response = await send({ type: "set_paused", paused });
  control = response.control || control;
  renderControl();
  renderResult({ ok: true, reason: paused ? "assistant_paused" : "assistant_resumed" });
  setBusy("");
}

$("enableToggle").addEventListener("click", () => setEnabled(!control.enabled));
$("pauseToggle").addEventListener("click", () => setPaused(!control.paused));
$("status").addEventListener("click", () => native("status", "检查中"));
$("startChrome").addEventListener("click", async () => {
  await native("start_chrome", "启动中");
  setBusy("等待 Chrome");
  setTimeout(() => native("status", "检查中"), 2500);
});
$("snapshot").addEventListener("click", () => native("snapshot", "扫描中"));
$("greetDetail").addEventListener("click", () => native("greet_detail", "沟通中"));
$("startAutomation").addEventListener("click", () => native("start_automation", "自动化中"));
$("options").addEventListener("click", () => chrome.runtime.openOptionsPage());

loadState();
