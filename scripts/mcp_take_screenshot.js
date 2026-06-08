#!/usr/bin/env node
"use strict";

const { spawn } = require("child_process");
const path = require("path");

const WRAPPER = path.join(__dirname, "chrome-devtools-mcp-wrapper.sh");
const filePath = process.argv[2] || `/private/tmp/boss-job-assistant-current-${Date.now()}.png`;

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

async function main() {
  const client = startServer();
  try {
    const initialized = await client.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "boss-job-assistant-screenshot", version: "0.1.0" }
    });
    client.notify("notifications/initialized");
    const pages = textFromResult(await client.request("tools/call", { name: "list_pages", arguments: {} }));
    await client.request("tools/call", { name: "take_screenshot", arguments: { format: "png", filePath } });
    console.log(JSON.stringify({ ok: true, initialized: initialized.serverInfo || null, pages, filePath }, null, 2));
  } finally {
    client.stop();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exit(1);
});
