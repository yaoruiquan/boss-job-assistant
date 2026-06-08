#!/usr/bin/env node
"use strict";

const http = require("http");

const HOST = process.env.CHROME_DEVTOOLS_BOSS_HOST || "127.0.0.1";
const PORT = process.env.CHROME_DEVTOOLS_BOSS_PORT || process.env.CHROME_DEBUG_PORT || "9335";
const TARGET_URL = process.argv[2] || "https://www.zhipin.com/";
const HAS_TARGET_ARG = Boolean(process.argv[2]);

function httpRequest(path, method = "GET") {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: HOST, port: PORT, path, method }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`${method} ${path} returned ${res.statusCode}: ${body.slice(0, 300)}`));
          return;
        }
        resolve(body);
      });
    });
    req.on("error", reject);
    req.end();
  });
}

async function jsonRequest(path, method = "GET") {
  return JSON.parse(await httpRequest(path, method));
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
      if (message.error) {
        reject(new Error(JSON.stringify(message.error)));
      } else {
        resolve(message.result);
      }
    }
  });

  function send(method, params = {}) {
    const id = nextId++;
    ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
    });
  }

  const opened = new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });

  return { ws, opened, send };
}

async function ensureBossPage() {
  const pages = await jsonRequest("/json/list");
  const existing = pages.find((page) => page.type === "page" && page.url.includes("zhipin.com"));
  if (existing) return existing;
  return jsonRequest(`/json/new?${encodeURIComponent(TARGET_URL)}`, "PUT");
}

async function main() {
  const version = await jsonRequest("/json/version");
  const page = await ensureBossPage();
  const session = cdpSession(page.webSocketDebuggerUrl);
  await session.opened;
  await session.send("Page.enable");
  await session.send("Runtime.enable");

  if (HAS_TARGET_ARG || !page.url.includes("zhipin.com")) {
    await session.send("Page.navigate", { url: TARGET_URL });
  }

  await new Promise((resolve) => setTimeout(resolve, 7000));

  const expression = `(() => {
    const body = document.body;
    const text = body ? body.innerText : "";
    const compact = text.replace(/\\s+/g, " ").trim();
    const jobLike = Array.from(document.querySelectorAll('[class*="job"], [class*="position"], [class*="card"], li, .item'))
      .map((el) => (el.innerText || "").replace(/\\s+/g, " ").trim())
      .filter((value) => value.length >= 12 && value.length <= 500)
      .map((value) => value.slice(0, 220))
      .slice(0, 12);
    const links = Array.from(document.querySelectorAll("a"))
      .map((a) => ({ text: (a.innerText || a.textContent || "").trim(), href: a.href }))
      .filter((item) => item.text || item.href)
      .slice(0, 20);
    const buttons = Array.from(document.querySelectorAll('button, [role="button"], .btn'))
      .map((button) => (button.innerText || button.textContent || button.getAttribute("aria-label") || "").trim())
      .filter(Boolean)
      .slice(0, 20);
    const textOf = (root, selectors) => {
      for (const selector of selectors) {
        const element = root.querySelector(selector);
        const value = element && (element.innerText || element.textContent || "").replace(/\\s+/g, " ").trim();
        if (value) return value;
      }
      return "";
    };
    const jobs = Array.from(document.querySelectorAll('.job-card-wrapper, .job-card-body, [class*="job-card"], li[class*="job"]'))
      .map((card) => {
        const rawText = (card.innerText || "").replace(/\\s+/g, " ").trim();
        return {
          title: textOf(card, ['.job-name', '[class*="job-name"]', '[class*="job-title"]']),
          salary: textOf(card, ['.salary', '[class*="salary"]']),
          company_name: textOf(card, ['.company-name', '[class*="company-name"]']),
          location: textOf(card, ['.job-area', '[class*="job-area"]', '[class*="location"]']),
          rawText: rawText.slice(0, 260)
        };
      })
      .filter((job) => job.title || job.company_name || /实习|安全|工程师|招聘/.test(job.rawText))
      .slice(0, 12);
    return {
      title: document.title,
      url: location.href,
      readyState: document.readyState,
      textLength: text.length,
      hasLoginOrVerifyText: /登录|注册|扫码|验证码|安全验证|滑块|验证/.test(compact),
      hasJobSignals: /职位|岗位|招聘|薪资|经验|学历|公司|Boss|直聘|沟通/.test(compact),
      visibleTextStart: compact.slice(0, 800),
      jobs,
      jobLike,
      links,
      buttons
    };
  })()`;

  const result = await session.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true
  });

  session.ws.close();
  console.log(JSON.stringify({
    ok: true,
    port: PORT,
    browser: version.Browser,
    page: result.result.value
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exit(1);
});
