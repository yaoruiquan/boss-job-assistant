#!/usr/bin/env node
"use strict";

const assert = require("assert");
const path = require("path");
const { spawn } = require("child_process");

const hostPath = path.join(__dirname, "..", "native-host", "host.js");

function frame(message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}

function parseFrame(buffer) {
  assert(buffer.length >= 4, "missing native message header");
  const length = buffer.readUInt32LE(0);
  assert(buffer.length >= length + 4, "truncated native message body");
  return JSON.parse(buffer.slice(4, length + 4).toString("utf8"));
}

function runHost(message) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [hostPath], {
      cwd: path.join(__dirname, ".."),
      stdio: ["pipe", "pipe", "inherit"]
    });
    const chunks = [];
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.stdin.write(frame(message));
    child.stdin.end();
    child.on("exit", (code) => {
      try {
        assert.strictEqual(code, 0);
        resolve(parseFrame(Buffer.concat(chunks)));
      } catch (error) {
        reject(error);
      }
    });
  });
}

(async () => {
  const ping = await runHost({ command: "ping" });
  assert.strictEqual(ping.ok, true);
  assert.strictEqual(ping.reason, "pong");

  const status = await runHost({ command: "status" });
  assert.strictEqual(typeof status.ok, "boolean");
  assert.ok(status.reason);
  assert.strictEqual(status.port, 9335);

  console.log("native host tests passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
