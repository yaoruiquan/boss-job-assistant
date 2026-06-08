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

const child = spawn(process.execPath, [hostPath], {
  cwd: path.join(__dirname, ".."),
  stdio: ["pipe", "pipe", "inherit"]
});

const chunks = [];
child.stdout.on("data", (chunk) => chunks.push(chunk));
child.stdin.write(frame({ command: "ping" }));
child.stdin.end();

child.on("exit", (code) => {
  assert.strictEqual(code, 0);
  const response = parseFrame(Buffer.concat(chunks));
  assert.strictEqual(response.ok, true);
  assert.strictEqual(response.reason, "pong");
  console.log("native host tests passed");
});
