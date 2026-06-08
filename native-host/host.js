#!/usr/bin/env node
"use strict";

const fs = require("fs");
const http = require("http");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const HOST_DIR = __dirname;
const SKILL_ROOT = path.dirname(HOST_DIR);
const DATA_DIR = path.join(SKILL_ROOT, "data");
const CHROME_PORT = Number(process.env.CHROME_DEBUG_PORT || "9335");

function sendMessage(message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  return new Promise((resolve) => process.stdout.write(Buffer.concat([header, body]), resolve));
}

function readMessages(onMessage) {
  let buffer = Buffer.alloc(0);
  let ended = false;
  let pending = 0;

  function maybeExit() {
    if (ended && pending === 0) process.exit(0);
  }

  function dispatch(message) {
    pending += 1;
    Promise.resolve(onMessage(message))
      .catch((error) => sendMessage({ ok: false, reason: "native_host_error", error: error.message }))
      .finally(() => {
        pending -= 1;
        maybeExit();
      });
  }

  process.stdin.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4) {
      const length = buffer.readUInt32LE(0);
      if (buffer.length < length + 4) break;
      const raw = buffer.slice(4, length + 4).toString("utf8");
      buffer = buffer.slice(length + 4);
      try {
        dispatch(JSON.parse(raw));
      } catch (error) {
        dispatch({ command: "__parse_error__", error: error.message });
      }
    }
  });
  process.stdin.on("end", () => {
    ended = true;
    maybeExit();
  });
}

function chromeVersion() {
  return new Promise((resolve) => {
    const req = http.get({
      hostname: "127.0.0.1",
      port: CHROME_PORT,
      path: "/json/version",
      timeout: 1500
    }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        try {
          resolve({ ok: true, chrome: JSON.parse(body) });
        } catch (error) {
          resolve({ ok: false, reason: "chrome_version_parse_failed", error: error.message });
        }
      });
    });
    req.on("timeout", () => {
      req.destroy();
      resolve({ ok: false, reason: "chrome_debug_port_timeout", port: CHROME_PORT });
    });
    req.on("error", (error) => {
      resolve({ ok: false, reason: "chrome_debug_port_unavailable", port: CHROME_PORT, error: error.message });
    });
  });
}

function spawnDetached(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd || SKILL_ROOT,
    env: { ...process.env, ...(options.env || {}) },
    detached: true,
    stdio: "ignore"
  });
  child.unref();
  return child.pid;
}

function runJson(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || SKILL_ROOT,
    env: { ...process.env, ...(options.env || {}) },
    encoding: "utf8",
    timeout: options.timeout || 90000,
    maxBuffer: 12 * 1024 * 1024
  });
  const output = (result.stdout || "").trim();
  if (result.error) {
    return { ok: false, reason: "command_failed", error: result.error.message, command, args };
  }
  if (result.status !== 0) {
    return {
      ok: false,
      reason: "command_exited_nonzero",
      status: result.status,
      stderr: (result.stderr || "").slice(0, 4000),
      stdout: output.slice(0, 4000),
      command,
      args
    };
  }
  try {
    return JSON.parse(output);
  } catch (error) {
    return {
      ok: false,
      reason: "command_json_parse_failed",
      error: error.message,
      stdout: output.slice(0, 4000),
      command,
      args
    };
  }
}

function latestRunFile() {
  if (!fs.existsSync(DATA_DIR)) return "";
  const files = fs.readdirSync(DATA_DIR)
    .filter((name) => /^runs-\d{4}-\d{2}-\d{2}\.jsonl$/.test(name))
    .sort();
  return files.length ? path.join(DATA_DIR, files[files.length - 1]) : "";
}

function lastRuns(limit = 20) {
  const filePath = latestRunFile();
  if (!filePath) return { ok: true, runCount: 0, runs: [] };
  const lines = fs.readFileSync(filePath, "utf8").trim().split(/\n/).filter(Boolean);
  const runs = lines.slice(-limit).map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return { ok: false, reason: "bad_log_line", raw: line.slice(0, 500) };
    }
  });
  return { ok: true, runCount: lines.length, logPath: filePath, runs };
}

async function handle(message) {
  const command = message?.command;
  if (command === "__parse_error__") {
    return { ok: false, reason: "native_message_parse_failed", error: message.error };
  }
  if (command === "ping") return { ok: true, reason: "pong" };
  if (command === "status") {
    const chrome = await chromeVersion();
    const runs = lastRuns(10);
    return {
      ok: chrome.ok,
      reason: chrome.ok ? "chrome_debug_port_ready" : chrome.reason,
      port: CHROME_PORT,
      profile: "boss-job-assistant",
      chrome: chrome.chrome || null,
      runCount: runs.runCount,
      lastRun: runs.runs?.[runs.runs.length - 1] || null,
      error: chrome.error
    };
  }
  if (command === "start_chrome") {
    const pid = spawnDetached(path.join(SKILL_ROOT, "scripts/start-chrome-debug.sh"), ["isolated"]);
    return { ok: true, reason: "chrome_start_requested", pid, port: CHROME_PORT, profile: "boss-job-assistant" };
  }
  if (command === "snapshot") {
    return runJson(process.execPath, [path.join(SKILL_ROOT, "scripts/mcp_snapshot_status.js"), "1500"]);
  }
  if (command === "greet_current") {
    return runJson(process.execPath, [path.join(SKILL_ROOT, "scripts/mcp_dump_snapshot.js"), "--greet-current", "1500", message.rules?.greeting || ""], { timeout: 150000 });
  }
  if (command === "greet_detail") {
    return runJson(process.execPath, [path.join(SKILL_ROOT, "scripts/mcp_dump_snapshot.js"), "--greet-detail", "0", message.rules?.greeting || ""], { timeout: 150000 });
  }
  if (command === "last_runs") {
    return lastRuns(Number(message.limit || 20));
  }
  return { ok: false, reason: "unknown_native_command", command };
}

readMessages(async (message) => {
  const result = await handle(message);
  await sendMessage(result);
});
