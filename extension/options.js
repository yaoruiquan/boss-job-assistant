const fields = [
  "city",
  "title",
  "employmentType",
  "companySize",
  "financingStage",
  "dailyLimit",
  "sessionLimit",
  "greeting"
];

function send(message) {
  return new Promise((resolve) => chrome.runtime.sendMessage(message, resolve));
}

function listToText(value) {
  return Array.isArray(value) ? value.join("\n") : String(value || "");
}

function textToList(value) {
  return String(value || "")
    .split(/\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

async function load() {
  const response = await send({ type: "get_rules" });
  const rules = response.rules || {};
  for (const field of fields) {
    const element = document.getElementById(field);
    if (!element) continue;
    if (field === "companySize" || field === "financingStage") {
      element.value = listToText(rules[field]);
    } else {
      element.value = rules[field] ?? "";
    }
  }
}

document.getElementById("form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const rules = {};
  for (const field of fields) {
    const value = document.getElementById(field).value;
    if (field === "companySize" || field === "financingStage") rules[field] = textToList(value);
    else if (field === "dailyLimit" || field === "sessionLimit") rules[field] = Number(value);
    else rules[field] = value;
  }
  await send({ type: "save_rules", rules });
  document.getElementById("saved").textContent = `已保存 ${new Date().toLocaleTimeString()}`;
});

load();
