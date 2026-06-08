const $ = (id) => document.getElementById(id);

function send(message) {
  return new Promise((resolve) => chrome.runtime.sendMessage(message, resolve));
}

function setBusy(label) {
  $("state").className = "state";
  $("state").textContent = label;
}

function render(result) {
  const ok = Boolean(result?.ok);
  $("state").className = `state ${ok ? "ok" : "bad"}`;
  $("state").textContent = ok ? "正常" : "停止";
  $("lastReason").textContent = result?.reason || result?.error || "-";
  if (typeof result?.runCount === "number") $("runCount").textContent = String(result.runCount);
  if (Array.isArray(result?.runs)) $("runCount").textContent = String(result.runs.length);
  $("output").textContent = JSON.stringify(result, null, 2);
}

async function native(command, extra = {}) {
  setBusy("执行中");
  const result = await send({ type: "native", payload: { command, ...extra } });
  render(result);
}

async function refresh() {
  const result = await send({ type: "native", payload: { command: "status" } });
  render(result);
}

$("status").addEventListener("click", () => native("status"));
$("startChrome").addEventListener("click", () => native("start_chrome"));
$("snapshot").addEventListener("click", () => native("snapshot"));
$("greetCurrent").addEventListener("click", () => native("greet_current"));
$("options").addEventListener("click", () => chrome.runtime.openOptionsPage());

refresh();
