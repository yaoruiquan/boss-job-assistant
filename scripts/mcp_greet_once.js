#!/usr/bin/env node
"use strict";

const { spawn } = require("child_process");
const path = require("path");

const SCRIPT_DIR = __dirname;
const WRAPPER = path.join(SCRIPT_DIR, "chrome-devtools-mcp-wrapper.sh");
const TARGET_URL = process.argv[2] || "https://www.zhipin.com/web/geek/jobs?query=%E5%AE%89%E5%85%A8%E5%AE%9E%E4%B9%A0&city=101280600";

function startServer() {
  const child = spawn(WRAPPER, [], {
    cwd: path.dirname(SCRIPT_DIR),
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env }
  });

  let nextId = 1;
  const pending = new Map();
  let buffer = "";
  const stderr = [];

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    while (true) {
      const index = buffer.indexOf("\n");
      if (index === -1) break;
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (message.id && pending.has(message.id)) {
        const { resolve, reject } = pending.get(message.id);
        pending.delete(message.id);
        message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result);
      }
    }
  });

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => stderr.push(chunk));

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

  return { child, request, notify, stop, stderr };
}

function textFromResult(result) {
  const content = result?.content || [];
  return content.map((item) => item.text || "").join("\n");
}

function findUidForImmediateChat(snapshotText) {
  const lines = snapshotText.split(/\n/);
  const candidates = lines.filter((line) => /立即沟通|继续沟通|打招呼/.test(line));
  for (const line of candidates) {
    const match = line.match(/uid=(["']?)([^"'\s\]]+)\1/) ||
      line.match(/\b([a-zA-Z0-9]+_\d+)\b/) ||
      line.match(/\[([a-zA-Z0-9_-]+)\]/);
    if (match) {
      return { uid: match[2] || match[1], line };
    }
  }
  return { uid: null, line: candidates[0] || "" };
}

function extractPageIds(listText) {
  const ids = [];
  for (const line of listText.split(/\n/)) {
    const match = line.match(/^(\d+):\s+(https?:\/\/\S+)/) || line.match(/pageId[=:]\s*(\d+)/);
    if (match) ids.push(Number(match[1]));
  }
  return ids;
}

async function callTool(client, name, args = {}) {
  return client.request("tools/call", { name, arguments: args });
}

async function takeSnapshotWithRetry(client) {
  let lastText = "";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const result = await callTool(client, "take_snapshot", {});
    const text = textFromResult(result);
    lastText = text;
    if (!/Protocol error|Cannot find context|Target closed/i.test(text)) {
      return { result, text, attempt };
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  return { result: null, text: lastText, attempt: 3 };
}

async function main() {
  const client = startServer();
  try {
    const initialized = await client.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "boss-job-assistant-mcp-smoke", version: "0.1.0" }
    });
    client.notify("notifications/initialized");

    const tools = await client.request("tools/list", {});
    const toolNames = (tools.tools || []).map((tool) => tool.name);
    for (const required of ["list_pages", "take_snapshot", "click"]) {
      if (!toolNames.includes(required)) {
        throw new Error(`required MCP tool not available: ${required}`);
      }
    }

    const pages = await callTool(client, "list_pages");
    const pagesText = textFromResult(pages);
    const pageIds = extractPageIds(pagesText);
    if (pageIds.length > 0) {
      await callTool(client, "select_page", { pageId: pageIds[0], bringToFront: true });
    }

    await callTool(client, "navigate_page", { type: "url", url: TARGET_URL, timeout: 10000 });
    await callTool(client, "wait_for", { text: ["立即沟通", "登录/注册", "验证码", "安全验证"], timeout: 10000 }).catch(() => null);

    const before = await takeSnapshotWithRetry(client);
    const beforeText = before.text;
    const hasVerify = /验证码|安全验证|滑块|登录\/注册/.test(beforeText);
    const target = findUidForImmediateChat(beforeText);

    if (hasVerify) {
      console.log(JSON.stringify({
        ok: false,
        stopped: true,
        reason: "login_or_verify_required_in_mcp_snapshot",
        initialized: initialized.serverInfo || null,
        tools: toolNames,
        pages: pagesText.slice(0, 1200),
        beforeSnapshotStart: beforeText.slice(0, 3000)
      }, null, 2));
      return;
    }

    if (!target.uid) {
      console.log(JSON.stringify({
        ok: false,
        stopped: true,
        reason: "immediate_chat_uid_not_found",
        initialized: initialized.serverInfo || null,
        tools: toolNames,
        pages: pagesText.slice(0, 1200),
        candidateLine: target.line,
        beforeSnapshotStart: beforeText.slice(0, 5000)
      }, null, 2));
      return;
    }

    const click = await callTool(client, "click", { uid: target.uid, includeSnapshot: true });
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const after = await takeSnapshotWithRetry(client);
    const afterText = after.text;
    const success = /继续沟通|已沟通|沟通过|刚刚沟通|发送消息|请输入|发送/.test(afterText) || /web\/geek\/chat/.test(afterText);

    console.log(JSON.stringify({
      ok: true,
      mcpFlow: ["initialize", "tools/list", "tools/call:list_pages", "tools/call:take_snapshot", "tools/call:click", "tools/call:take_snapshot"],
      targetUrl: TARGET_URL,
      initialized: initialized.serverInfo || null,
      clicked: {
        uid: target.uid,
        line: target.line,
        clickResponse: textFromResult(click).slice(0, 1200)
      },
      success,
      beforeSnapshotAttempt: before.attempt,
      beforeSnapshotStart: beforeText.slice(0, 3000),
      afterSnapshotAttempt: after.attempt,
      afterSnapshotStart: afterText.slice(0, 5000)
    }, null, 2));
  } finally {
    client.stop();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exit(1);
});
