#!/usr/bin/env node
"use strict";

const { spawn } = require("child_process");
const path = require("path");

const WRAPPER = path.join(__dirname, "chrome-devtools-mcp-wrapper.sh");
const GREET_DETAIL = process.argv[2] === "--greet-detail";
const GREET_CURRENT = GREET_DETAIL || process.argv[2] === "--greet-current" || process.argv[2] === "--greet-url";
const GREET_URL = process.argv[2] === "--greet-url";
const TARGET_URL = GREET_URL ? (process.argv[3] || "") : (GREET_CURRENT ? "" : (process.argv[2] || ""));
const WAIT_MS = Number((GREET_URL ? process.argv[4] : (GREET_CURRENT ? process.argv[3] : process.argv[3])) || "8000");
const GREETING = (GREET_URL ? process.argv[5] : process.argv[4]) || "您好，我对这个岗位比较感兴趣，想进一步了解一下。";
const PRIORITY_COMPANY_RE = /字节跳动|杭州今日头条科技|阿里巴巴集团|华为/;
const TITLE_RE = /(AI\s*应用|AI应用|应用开发|应用研发|Agent|大模型)/i;
const INTERN_RE = /(实习|元\/天|\d+个月|在校\/应届)/;
const CITY_RE = /杭州/;
const SIZE_RE = /(100-499人|500-999人|1000-9999人|10000人以上)/;
const STAGE_RE = /(B轮|C轮|D轮及以上|已上市|不需要融资)/;

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

async function callTool(client, name, args = {}) {
  return client.request("tools/call", { name, arguments: args });
}

function uidFromLine(line) {
  const match = line.match(/\buid=([a-zA-Z0-9_:-]+)\b/);
  return match ? match[1] : "";
}

function rootUrlFromSnapshot(text) {
  const match = text.match(/RootWebArea[^\n]*\burl="([^"]+)"/);
  return match ? match[1] : "";
}

function summarize(text, max = 9000) {
  return text.replace(/\n\s*\n/g, "\n").slice(0, max);
}

function extractCandidates(text) {
  const lines = text.split(/\n/);
  const candidates = [];
  for (let i = 0; i < lines.length; i += 1) {
    const jobLine = lines[i];
    if (!/\blink\b/.test(jobLine) || !/\/job_detail\//.test(jobLine) || !uidFromLine(jobLine)) continue;
    if (!TITLE_RE.test(jobLine) || !INTERN_RE.test(jobLine)) continue;
    const following = lines.slice(i + 1, i + 8);
    const companyLine = following.find((line) => /\blink\b/.test(line) && /\/gongsi\//.test(line)) || "";
    const block = [jobLine, companyLine, ...following].join("\n");
    if (!CITY_RE.test(block)) continue;
    candidates.push({
      uid: uidFromLine(jobLine),
      jobLine: jobLine.trim(),
      companyLine: companyLine.trim(),
      priority: PRIORITY_COMPANY_RE.test(companyLine) ? 100 : 0,
      listBlock: block.trim()
    });
  }
  return candidates.sort((a, b) => b.priority - a.priority);
}

function findLine(text, predicate) {
  return text.split(/\n/).find(predicate) || "";
}

function findChatButtonLine(text) {
  return findLine(text, (line) =>
    /uid=/.test(line) &&
    /\blink\b|\bbutton\b/.test(line) &&
    /立即沟通|继续沟通|打招呼/.test(line) &&
    Boolean(uidFromLine(line))
  );
}

function findInputLine(text) {
  if (!/\/web\/geek\/chat/.test(rootUrlFromSnapshot(text))) return "";
  return findLine(text, (line) =>
    /uid=/.test(line) &&
    /(textbox|text area|textarea|editable|contenteditable|输入框|说点什么|聊一聊)/i.test(line) &&
    !/搜索职位|搜索|请简短描述您的问题|问题|反馈|举报|投诉|建议/.test(line) &&
    !/\blink\b/.test(line) &&
    Boolean(uidFromLine(line))
  );
}

function findSendLine(text) {
  return findLine(text, (line) =>
    /uid=/.test(line) &&
    /\b(link|button)\b/.test(line) &&
    /发送|Send/.test(line) &&
    Boolean(uidFromLine(line))
  );
}

async function stableSnapshot(client, attempts = 8) {
  let text = "";
  for (let i = 0; i < attempts; i += 1) {
    text = textFromResult(await callTool(client, "take_snapshot"));
    const transient = /Could not connect to Chrome|Failed to fetch browser webSocket URL|Protocol error|Target closed|No page selected|Cannot find context/i.test(text);
    if (!transient && text.length > 1000) return text;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return text;
}

async function main() {
  const client = startServer();
  try {
    const initialized = await client.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "boss-job-assistant-mcp-dump", version: "0.1.0" }
    });
    client.notify("notifications/initialized");
    let navigateResult = null;
    if (TARGET_URL) {
      navigateResult = textFromResult(await callTool(client, "navigate_page", { type: "url", url: TARGET_URL, timeout: 15000 }));
    }
    await new Promise((resolve) => setTimeout(resolve, WAIT_MS));
    const pages = textFromResult(await callTool(client, "list_pages"));
    let snapshot = await stableSnapshot(client);
    if (GREET_CURRENT) {
      const trace = ["list_pages", "take_snapshot:list"];
      if (GREET_DETAIL) {
        trace[1] = "take_snapshot:detail";
        const knownCompanyPass = PRIORITY_COMPANY_RE.test(snapshot);
        const evidence = {
          city: CITY_RE.test(snapshot),
          title: TITLE_RE.test(snapshot),
          intern: INTERN_RE.test(snapshot),
          size: SIZE_RE.test(snapshot) || knownCompanyPass,
          stage: STAGE_RE.test(snapshot) || knownCompanyPass
        };
        if (!Object.values(evidence).every(Boolean)) {
          console.log(JSON.stringify({ ok: false, reason: "detail_filter_not_confirmed", trace, evidence, detailSnapshotStart: summarize(snapshot) }, null, 2));
          return;
        }
        const chatLine = findChatButtonLine(snapshot);
        const chatUid = uidFromLine(chatLine);
        if (!chatUid) {
          console.log(JSON.stringify({ ok: false, reason: "chat_button_uid_not_found", trace, evidence, detailSnapshotStart: summarize(snapshot) }, null, 2));
          return;
        }
        trace.push(`click:chat:${chatUid}`);
        await callTool(client, "click", { uid: chatUid, includeSnapshot: true });
        await new Promise((resolve) => setTimeout(resolve, 5000));
        trace.push("take_snapshot:chat");
        snapshot = await stableSnapshot(client);
        const rootUrl = rootUrlFromSnapshot(snapshot);
        const established = /\/web\/geek\/chat/.test(rootUrl) && /(\[送达\]|\[已读\]|您正在与Boss|正在沟通|新沟通)/.test(snapshot);
        if (established) {
          const screenshotPath = `/private/tmp/boss-job-assistant-greet-${Date.now()}.png`;
          await callTool(client, "take_screenshot", { format: "png", filePath: screenshotPath }).catch(() => null);
          console.log(JSON.stringify({ ok: true, reason: "communication_established_no_extra_send", sentExtraMessage: false, initialized: initialized.serverInfo || null, trace, evidence, chatLine, screenshotPath, finalSnapshotStart: summarize(snapshot) }, null, 2));
          return;
        }
        const inputLine = findInputLine(snapshot);
        const inputUid = uidFromLine(inputLine);
        if (!inputUid) {
          console.log(JSON.stringify({ ok: false, reason: "chat_input_uid_not_found", trace, evidence, chatLine, chatSnapshotStart: summarize(snapshot) }, null, 2));
          return;
        }
        trace.push(`fill:greeting:${inputUid}`);
        await callTool(client, "fill", { uid: inputUid, value: GREETING, includeSnapshot: true }).catch(async () => {
          await callTool(client, "click", { uid: inputUid, includeSnapshot: false });
          await callTool(client, "type_text", { text: GREETING });
        });
        await new Promise((resolve) => setTimeout(resolve, 1000));
        snapshot = await stableSnapshot(client);
        const sendLine = findSendLine(snapshot);
        const sendUid = uidFromLine(sendLine);
        if (!sendUid) {
          console.log(JSON.stringify({ ok: false, reason: "send_button_uid_not_found_after_fill", trace, evidence, inputLine, beforeSendSnapshotStart: summarize(snapshot) }, null, 2));
          return;
        }
        trace.push(`click:send:${sendUid}`);
        await callTool(client, "click", { uid: sendUid, includeSnapshot: true });
        await new Promise((resolve) => setTimeout(resolve, 2500));
        trace.push("take_snapshot:after_send");
        snapshot = await stableSnapshot(client);
        const success = snapshot.includes(GREETING) || /(\[送达\]|\[已读\]|您正在与Boss|正在沟通|\/web\/geek\/chat)/.test(snapshot);
        const screenshotPath = `/private/tmp/boss-job-assistant-greet-${Date.now()}.png`;
        await callTool(client, "take_screenshot", { format: "png", filePath: screenshotPath }).catch(() => null);
        console.log(JSON.stringify({ ok: success, reason: success ? "greeting_sent_with_strong_signal" : "greeting_sent_but_not_confirmed", sentExtraMessage: true, trace, evidence, chatLine, inputLine, sendLine, screenshotPath, finalSnapshotStart: summarize(snapshot) }, null, 2));
        return;
      }
      const candidates = extractCandidates(snapshot);
      if (!candidates.length) {
        console.log(JSON.stringify({ ok: false, reason: "matching_candidate_not_found", trace, pages, snapshotStart: summarize(snapshot) }, null, 2));
        return;
      }
      const candidate = candidates[0];
      trace.push(`click:job:${candidate.uid}`);
      await callTool(client, "click", { uid: candidate.uid, includeSnapshot: true });
      await new Promise((resolve) => setTimeout(resolve, 4000));
      trace.push("take_snapshot:detail");
      snapshot = await stableSnapshot(client);
      const knownCompanyPass = PRIORITY_COMPANY_RE.test(candidate.companyLine);
      const evidence = {
        city: CITY_RE.test(snapshot),
        title: TITLE_RE.test(snapshot),
        intern: INTERN_RE.test(snapshot),
        size: SIZE_RE.test(snapshot) || knownCompanyPass,
        stage: STAGE_RE.test(snapshot) || knownCompanyPass
      };
      if (!Object.values(evidence).every(Boolean)) {
        console.log(JSON.stringify({ ok: false, reason: "detail_filter_not_confirmed", trace, candidate, evidence, detailSnapshotStart: summarize(snapshot) }, null, 2));
        return;
      }
      const chatLine = findChatButtonLine(snapshot);
      const chatUid = uidFromLine(chatLine);
      if (!chatUid) {
        console.log(JSON.stringify({ ok: false, reason: "chat_button_uid_not_found", trace, candidate, evidence, detailSnapshotStart: summarize(snapshot) }, null, 2));
        return;
      }
      trace.push(`click:chat:${chatUid}`);
      await callTool(client, "click", { uid: chatUid, includeSnapshot: true });
      await new Promise((resolve) => setTimeout(resolve, 5000));
      trace.push("take_snapshot:chat");
      snapshot = await stableSnapshot(client);
      const rootUrl = rootUrlFromSnapshot(snapshot);
      const established = /\/web\/geek\/chat/.test(rootUrl) && /(\[送达\]|\[已读\]|您正在与Boss|正在沟通|新沟通)/.test(snapshot);
      if (established) {
        const screenshotPath = `/private/tmp/boss-job-assistant-greet-${Date.now()}.png`;
        await callTool(client, "take_screenshot", { format: "png", filePath: screenshotPath }).catch(() => null);
        console.log(JSON.stringify({ ok: true, reason: "communication_established_no_extra_send", sentExtraMessage: false, initialized: initialized.serverInfo || null, trace, candidate, evidence, chatLine, screenshotPath, finalSnapshotStart: summarize(snapshot) }, null, 2));
        return;
      }
      const inputLine = findInputLine(snapshot);
      const inputUid = uidFromLine(inputLine);
      if (!inputUid) {
        console.log(JSON.stringify({ ok: false, reason: "chat_input_uid_not_found", trace, candidate, evidence, chatLine, chatSnapshotStart: summarize(snapshot) }, null, 2));
        return;
      }
      trace.push(`fill:greeting:${inputUid}`);
      await callTool(client, "fill", { uid: inputUid, value: GREETING, includeSnapshot: true }).catch(async () => {
        await callTool(client, "click", { uid: inputUid, includeSnapshot: false });
        await callTool(client, "type_text", { text: GREETING });
      });
      await new Promise((resolve) => setTimeout(resolve, 1000));
      snapshot = await stableSnapshot(client);
      const sendLine = findSendLine(snapshot);
      const sendUid = uidFromLine(sendLine);
      if (!sendUid) {
        console.log(JSON.stringify({ ok: false, reason: "send_button_uid_not_found_after_fill", trace, candidate, evidence, inputLine, beforeSendSnapshotStart: summarize(snapshot) }, null, 2));
        return;
      }
      trace.push(`click:send:${sendUid}`);
      await callTool(client, "click", { uid: sendUid, includeSnapshot: true });
      await new Promise((resolve) => setTimeout(resolve, 2500));
      trace.push("take_snapshot:after_send");
      snapshot = await stableSnapshot(client);
      const success = snapshot.includes(GREETING) || /(\[送达\]|\[已读\]|您正在与Boss|正在沟通|\/web\/geek\/chat)/.test(snapshot);
      const screenshotPath = `/private/tmp/boss-job-assistant-greet-${Date.now()}.png`;
      await callTool(client, "take_screenshot", { format: "png", filePath: screenshotPath }).catch(() => null);
      console.log(JSON.stringify({ ok: success, reason: success ? "greeting_sent_with_strong_signal" : "greeting_sent_but_not_confirmed", sentExtraMessage: true, trace, candidate, evidence, chatLine, inputLine, sendLine, screenshotPath, finalSnapshotStart: summarize(snapshot) }, null, 2));
      return;
    }
    console.log(JSON.stringify({
      ok: true,
      initialized: initialized.serverInfo || null,
      navigateResult,
      pages,
      snapshot
    }, null, 2));
  } finally {
    client.stop();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exit(1);
});
