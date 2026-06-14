#!/usr/bin/env node
"use strict";

const { spawn } = require("child_process");
const path = require("path");

const WRAPPER = path.join(__dirname, "chrome-devtools-mcp-wrapper.sh");
const WAIT_MS = Number(process.argv[2] || "8000");

function startServer() {
  const child = spawn(WRAPPER, [], {
    cwd: path.dirname(__dirname),
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env }
  });
  let nextId = 1;
  let buffer = "";
  const pending = new Map();
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    while (true) {
      const index = buffer.indexOf("\n");
      if (index < 0) break;
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      if (message.id && pending.has(message.id)) {
        const { resolve, reject } = pending.get(message.id);
        pending.delete(message.id);
        message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result);
      }
    }
  });
  function request(method, params = {}) {
    const id = nextId++;
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  }
  function notify(method, params = {}) {
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  }
  function stop() {
    child.stdin.end();
    child.kill("SIGTERM");
  }
  return { request, notify, stop };
}

function textFromResult(result) {
  return (result?.content || []).map((item) => item.text || "").join("\n");
}

function extractPages(text) {
  const pages = [];
  for (const line of text.split(/\n/)) {
    const match = line.match(/^(\d+):\s+(\S+)(.*)$/);
    if (!match) continue;
    pages.push({
      pageId: Number(match[1]),
      url: match[2],
      selected: /\[selected\]/.test(match[3] || "")
    });
  }
  return pages;
}

function selectPreferredPage(pagesText) {
  const pages = extractPages(pagesText);
  return (
    pages.find((page) => /zhipin\.com\/web\/geek\/jobs/.test(page.url)) ||
    pages.find((page) => /zhipin\.com\/job_detail\//.test(page.url)) ||
    pages.find((page) => /zhipin\.com\/web\/geek\/chat/.test(page.url)) ||
    pages.find((page) => /^https?:\/\//.test(page.url) && !/about:blank/.test(page.url)) ||
    pages.find((page) => page.selected) ||
    pages[0] ||
    null
  );
}

async function main() {
  const client = startServer();
  try {
    const initialized = await client.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "boss-job-assistant-mcp-snapshot", version: "0.1.0" }
    });
    client.notify("notifications/initialized");
    await new Promise((resolve) => setTimeout(resolve, WAIT_MS));
    const pages = await client.request("tools/call", { name: "list_pages", arguments: {} });
    const pagesText = textFromResult(pages);
    const preferredPage = selectPreferredPage(pagesText);
    if (preferredPage) {
      await client.request("tools/call", { name: "select_page", arguments: { pageId: preferredPage.pageId, bringToFront: true } });
    }
    let snapshotText = "";
    let snapshotAttempt = 0;
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      snapshotAttempt = attempt;
      const snapshot = await client.request("tools/call", { name: "take_snapshot", arguments: {} });
      snapshotText = textFromResult(snapshot);
      if (!/Protocol error|does not belong to the document|Cannot find context/i.test(snapshotText)) break;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    const success = /继续沟通|已沟通|沟通过|刚刚沟通|发送消息|请输入|发送/.test(snapshotText) || /web\/geek\/chat/.test(snapshotText);
    console.log(JSON.stringify({
      ok: true,
      waitMs: WAIT_MS,
      initialized: initialized.serverInfo || null,
      pages: pagesText.slice(0, 1200),
      selectedPage: preferredPage || null,
      snapshotAttempt,
      success,
      hasImmediateChat: /立即沟通/.test(snapshotText),
      hasVerify: /验证码|安全验证|滑块|登录\/注册/.test(snapshotText),
      snapshotStart: snapshotText.slice(0, 5000)
    }, null, 2));
  } finally {
    client.stop();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exit(1);
});
