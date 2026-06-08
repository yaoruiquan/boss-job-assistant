"use strict";

const fs = require("fs");
const path = require("path");

const DEFAULT_LOG_DIR = path.join(__dirname, "..", "..", "data");

function todayStamp(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function appendRunLog(event, options = {}) {
  const logDir = options.logDir || process.env.BOSS_JOB_ASSISTANT_LOG_DIR || DEFAULT_LOG_DIR;
  fs.mkdirSync(logDir, { recursive: true });
  const filePath = path.join(logDir, `runs-${todayStamp()}.jsonl`);
  const payload = {
    ts: new Date().toISOString(),
    ...event
  };
  fs.appendFileSync(filePath, `${JSON.stringify(payload)}\n`, "utf8");
  return filePath;
}

module.exports = {
  appendRunLog,
  todayStamp
};
