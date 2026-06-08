#!/usr/bin/env node
"use strict";

const http = require("http");

const HOST = process.env.CHROME_DEVTOOLS_BOSS_HOST || "127.0.0.1";
const PORT = process.env.CHROME_DEVTOOLS_BOSS_PORT || process.env.CHROME_DEBUG_PORT || "9335";

function httpRequest(path) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: HOST, port: PORT, path }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => resolve(body));
    });
    req.on("error", reject);
    req.end();
  });
}

function cdpSession(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map();
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result);
    }
  });
  const opened = new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  function send(method, params = {}) {
    const id = nextId++;
    ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  }
  return { ws, opened, send };
}

async function main() {
  const pages = JSON.parse(await httpRequest("/json/list"));
  const page = pages.find((item) => item.type === "page" && item.url.includes("zhipin.com"));
  if (!page) throw new Error("No zhipin page on DevTools port");
  const session = cdpSession(page.webSocketDebuggerUrl);
  await session.opened;
  await session.send("Runtime.enable");
  const expression = `(() => {
    const clickableSelector = 'a, button, [role="button"], .btn, [class*="btn"], [class*="chat"], [class*="contact"]';
    const clickables = Array.from(document.querySelectorAll(clickableSelector))
      .map((el, index) => {
        const rect = el.getBoundingClientRect();
        const text = (el.innerText || el.textContent || el.getAttribute("aria-label") || "").replace(/\\s+/g, " ").trim();
        return {
          index,
          tag: el.tagName,
          className: String(el.className || ""),
          text: text.slice(0, 80),
          href: el.href || "",
          visible: rect.width > 0 && rect.height > 0,
          rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
        };
      })
      .filter((item) => item.visible && (item.text || item.href))
      .filter((item) => /沟通|联系|打招呼|投递|简历|聊天|发送|登录|验证|搜索/.test(item.text + item.className + item.href))
      .slice(0, 80);
    const inputs = Array.from(document.querySelectorAll('input, textarea, [contenteditable="true"]'))
      .map((el, index) => {
        const rect = el.getBoundingClientRect();
        return {
          index,
          tag: el.tagName,
          type: el.getAttribute("type") || "",
          placeholder: el.getAttribute("placeholder") || "",
          className: String(el.className || ""),
          text: (el.innerText || el.value || "").slice(0, 80),
          visible: rect.width > 0 && rect.height > 0,
          rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
        };
      })
      .filter((item) => item.visible)
      .slice(0, 50);
    return {
      title: document.title,
      url: location.href,
      bodyHasVerify: /验证码|安全验证|滑块|登录/.test(document.body ? document.body.innerText : ""),
      clickables,
      inputs
    };
  })()`;
  const result = await session.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true
  });
  session.ws.close();
  console.log(JSON.stringify({ ok: true, page: result.result.value }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exit(1);
});
