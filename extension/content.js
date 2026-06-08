const PANEL_ID = "boss-job-assistant-panel";

function ensurePanel() {
  let panel = document.getElementById(PANEL_ID);
  if (panel) return panel;
  panel = document.createElement("div");
  panel.id = PANEL_ID;
  panel.textContent = "BOSS Assistant 已连接";
  document.documentElement.appendChild(panel);
  return panel;
}

function updatePanel() {
  const panel = ensurePanel();
  const isBoss = location.hostname.endsWith("zhipin.com");
  panel.hidden = !isBoss;
}

updatePanel();
window.addEventListener("popstate", updatePanel);
