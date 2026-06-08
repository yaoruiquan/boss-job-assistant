#!/usr/bin/env node
"use strict";

const { spawn } = require("child_process");
const path = require("path");
const { appendRunLog } = require("./lib/run_log");
const {
  classifyAfterChatClick,
  classifyBrowserText,
  hasStopGate,
  isStrongCommunicationEvidence,
  isTransientBrowserText
} = require("./lib/boss_policy");

const WRAPPER = path.join(__dirname, "chrome-devtools-mcp-wrapper.sh");
const SEARCH_URL = "https://www.zhipin.com/web/geek/jobs?query=ai%E5%BA%94%E7%94%A8%E5%BC%80%E5%8F%91&city=101210100";
const GREETING = process.argv[2] || "您好，我对这个岗位比较感兴趣，想进一步了解一下。";
const TITLE_RE = /(AI\s*应用开发|ai应用开发|应用开发|应用研发|Agent|大模型.*开发)/i;
const INTERN_RE = /(实习|元\/天|\d+个月|在校\/应届)/;
const CITY_RE = /杭州/;
const SIZE_RE = /(100-499人|500-999人|1000-9999人|10000人以上)/;
const STAGE_RE = /(B轮|C轮|D轮及以上|已上市)/;

function startServer() {
  const childEnv = { ...process.env };
  delete childEnv.BOSS_SKIP_NAV;
  delete childEnv.BOSS_FORCE_EXTRA_SEND;
  const child = spawn(WRAPPER, [], {
    cwd: path.dirname(__dirname),
    stdio: ["pipe", "pipe", "pipe"],
    env: childEnv
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

function urlFromLine(line) {
  const match = line.match(/\burl="([^"]+)"/);
  return match ? match[1] : "";
}

function rootUrlFromSnapshot(text) {
  const match = text.match(/RootWebArea[^\n]*\burl="([^"]+)"/);
  return match ? match[1] : "";
}

function summarize(text, max = 8000) {
  return text.replace(/\n\s*\n/g, "\n").slice(0, max);
}

function printAndLog(payload) {
  const logPath = appendRunLog({ script: path.basename(__filename), ...payload });
  console.log(JSON.stringify({ ...payload, logPath }, null, 2));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractPages(text) {
  const pages = [];
  for (const line of text.split(/\n/)) {
    const match = line.match(/^(\d+):\s+(\S+)(.*)$/);
    if (match) pages.push({ pageId: Number(match[1]), url: match[2], line });
  }
  return pages;
}

async function snapshot(client, attempts = 6) {
  let text = "";
  for (let i = 0; i < attempts; i += 1) {
    text = textFromResult(await callTool(client, "take_snapshot", {}));
    const lines = text.trim().split(/\n/).length;
    if (!isTransientBrowserText(text) && text.length > 1000 && lines > 20 && !/ busy url=/.test(text.split(/\n/)[1] || "")) return text;
    await sleep(2000);
  }
  return text;
}

async function listPages(client, attempts = 6) {
  let text = "";
  for (let i = 0; i < attempts; i += 1) {
    text = textFromResult(await callTool(client, "list_pages"));
    if (text && !/Could not connect to Chrome|Failed to fetch browser webSocket URL/i.test(text)) return text;
    await sleep(2000);
  }
  return text;
}

function findLine(text, predicate) {
  return text.split(/\n/).find(predicate) || "";
}

function findChatButtonLine(text) {
  return findLine(text, (line) =>
    /\b(link|button)\b/.test(line) &&
    /立即沟通|继续沟通|打招呼/.test(line) &&
    Boolean(uidFromLine(line))
  );
}

function findInputLine(text) {
  const rootUrl = rootUrlFromSnapshot(text);
  if (!/\/web\/geek\/chat/.test(rootUrl)) return "";
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

function extractCandidates(text) {
  const lines = text.split(/\n/);
  const candidates = [];
  for (let i = 0; i < lines.length; i += 1) {
    const jobLine = lines[i];
    if (!/\blink\b/.test(jobLine) || !/\/job_detail\//.test(jobLine) || !uidFromLine(jobLine)) continue;
    if (!TITLE_RE.test(jobLine) || !INTERN_RE.test(jobLine)) continue;
    const companyLine = lines.slice(i + 1, i + 8).find((line) => /\blink\b/.test(line) && /\/gongsi\//.test(line)) || "";
    const block = [jobLine, companyLine, ...lines.slice(i + 1, i + 8)].join("\n");
    if (!CITY_RE.test(block)) continue;
    candidates.push({
      uid: uidFromLine(jobLine),
      url: urlFromLine(jobLine),
      jobLine: jobLine.trim(),
      companyLine: companyLine.trim(),
      listBlock: block.trim()
    });
  }
  return candidates;
}

function detailMatches(text) {
  const evidence = {
    city: CITY_RE.test(text),
    title: TITLE_RE.test(text),
    intern: INTERN_RE.test(text),
    size: SIZE_RE.test(text),
    stage: STAGE_RE.test(text)
  };
  return { ok: Object.values(evidence).every(Boolean), evidence };
}

async function selectDetailPage(client, preferredUrl) {
  const preferredBase = preferredUrl.split("?")[0];
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const pagesText = textFromResult(await callTool(client, "list_pages"));
    const pages = extractPages(pagesText);
    const detail = pages.find((page) => preferredBase && page.url.startsWith(preferredBase)) ||
      pages.find((page) => /\/job_detail\//.test(page.url));
    if (detail) {
      await callTool(client, "select_page", { pageId: detail.pageId, bringToFront: true });
      return { detail, pagesText };
    }
  }
  return { detail: null, pagesText: textFromResult(await callTool(client, "list_pages")) };
}

async function main() {
  const client = startServer();
  const trace = [];
  try {
    const initialized = await client.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "boss-job-assistant-hangzhou-ai-smoke", version: "0.1.0" }
    });
    client.notify("notifications/initialized");
    await sleep(10000);
    trace.push("list_pages");
    const initialPages = await listPages(client, 8);
    const initialPagesFailure = classifyBrowserText(initialPages);
    if (initialPagesFailure) {
      printAndLog({ ok: false, reason: initialPagesFailure, trace, pages: initialPages });
      return;
    }
    if (process.env.BOSS_SKIP_NAV === "1") {
      trace.push("skip_navigate_page:use_current_page");
    } else {
      trace.push(`navigate_page:${SEARCH_URL}`);
      await callTool(client, "navigate_page", { type: "url", url: SEARCH_URL, timeout: 15000 });
      await sleep(6500);
    }

    trace.push("take_snapshot:list");
    let current = await snapshot(client);
    const stopReason = classifyBrowserText(current) || (hasStopGate(current) ? "stop_gate" : "");
    if (stopReason) {
      const screenshotPath = `/private/tmp/boss-job-assistant-stop-${Date.now()}.png`;
      await callTool(client, "take_screenshot", { format: "png", filePath: screenshotPath }).catch(() => null);
      printAndLog({ ok: false, reason: stopReason, trace, screenshotPath, listSnapshotStart: summarize(current) });
      return;
    }

    const candidates = extractCandidates(current);
    if (!candidates.length) {
      const screenshotPath = `/private/tmp/boss-job-assistant-no-candidate-${Date.now()}.png`;
      await callTool(client, "take_screenshot", { format: "png", filePath: screenshotPath }).catch(() => null);
      printAndLog({ ok: false, reason: "matching_list_candidate_not_found", trace, screenshotPath, listSnapshotStart: summarize(current) });
      return;
    }

    const candidate = candidates[0];
    trace.push(`click:job:${candidate.uid}`);
    await callTool(client, "click", { uid: candidate.uid, includeSnapshot: true });
    const { detail } = await selectDetailPage(client, candidate.url);
    if (detail) trace.push(`select_page:detail:${detail.pageId}`);
    else trace.push("detail_panel:on_current_search_page");
    await sleep(3500);

    trace.push("take_snapshot:detail");
    current = await snapshot(client);
    const detailStopReason = classifyBrowserText(current) || (hasStopGate(current) ? "stop_gate" : "");
    if (detailStopReason) {
      const screenshotPath = `/private/tmp/boss-job-assistant-stop-${Date.now()}.png`;
      await callTool(client, "take_screenshot", { format: "png", filePath: screenshotPath }).catch(() => null);
      printAndLog({ ok: false, reason: detailStopReason, trace, candidate, screenshotPath, detailSnapshotStart: summarize(current) });
      return;
    }
    const match = detailMatches(current);
    if (!match.ok) {
      const screenshotPath = `/private/tmp/boss-job-assistant-filter-miss-${Date.now()}.png`;
      await callTool(client, "take_screenshot", { format: "png", filePath: screenshotPath }).catch(() => null);
      printAndLog({
        ok: false,
        reason: "detail_filter_not_confirmed",
        trace,
        candidate,
        filterEvidence: match.evidence,
        screenshotPath,
        detailSnapshotStart: summarize(current)
      });
      return;
    }

    const chatLine = findChatButtonLine(current);
    const chatUid = uidFromLine(chatLine);
    if (!chatUid) {
      const screenshotPath = `/private/tmp/boss-job-assistant-no-chat-${Date.now()}.png`;
      await callTool(client, "take_screenshot", { format: "png", filePath: screenshotPath }).catch(() => null);
      printAndLog({ ok: false, reason: "chat_button_uid_not_found", trace, candidate, filterEvidence: match.evidence, screenshotPath, detailSnapshotStart: summarize(current) });
      return;
    }

    trace.push(`click:chat:${chatUid}`);
    await callTool(client, "click", { uid: chatUid, includeSnapshot: true });
    let chatPage = null;
    let pagesAfterChat = "";
    for (let attempt = 1; attempt <= 8; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      pagesAfterChat = textFromResult(await callTool(client, "list_pages"));
      chatPage = extractPages(pagesAfterChat).find((page) => /\/web\/geek\/chat/.test(page.url));
      if (chatPage) break;
    }
    if (chatPage) {
      trace.push(`select_page:chat:${chatPage.pageId}`);
      await callTool(client, "select_page", { pageId: chatPage.pageId, bringToFront: true });
    }
    await sleep(3500);

    trace.push("take_snapshot:chat");
    current = await snapshot(client);
    const rootUrl = rootUrlFromSnapshot(current);
    const afterChatReason = classifyAfterChatClick(current, rootUrl);
    if (afterChatReason !== "unknown_after_click" && afterChatReason !== "communication_established") {
      const screenshotPath = `/private/tmp/boss-job-assistant-stop-${Date.now()}.png`;
      await callTool(client, "take_screenshot", { format: "png", filePath: screenshotPath }).catch(() => null);
      printAndLog({ ok: false, reason: afterChatReason, trace, candidate, filterEvidence: match.evidence, chatLine, screenshotPath, chatSnapshotStart: summarize(current) });
      return;
    }
    if (afterChatReason === "communication_established" && process.env.BOSS_FORCE_EXTRA_SEND !== "1") {
      const screenshotPath = `/private/tmp/boss-job-assistant-greet-${Date.now()}.png`;
      trace.push("take_screenshot");
      await callTool(client, "take_screenshot", { format: "png", filePath: screenshotPath }).catch(() => null);
      printAndLog({
        ok: true,
        reason: "communication_established_no_extra_send",
        success: true,
        sentExtraMessage: false,
        trace,
        initialized: initialized.serverInfo || null,
        filters: {
          city: "杭州",
          title: "ai应用开发",
          employmentType: "实习",
          companySize: "100-499人及以上",
          financingStage: "B轮及以后"
        },
        candidate,
        filterEvidence: match.evidence,
        chatLine,
        screenshotPath,
        finalSnapshotStart: summarize(current)
      });
      return;
    }

    const inputLine = findInputLine(current);
    const inputUid = uidFromLine(inputLine);
    if (!inputUid) {
      const screenshotPath = `/private/tmp/boss-job-assistant-no-input-${Date.now()}.png`;
      await callTool(client, "take_screenshot", { format: "png", filePath: screenshotPath }).catch(() => null);
      printAndLog({ ok: false, reason: "chat_input_uid_not_found", trace, candidate, filterEvidence: match.evidence, chatLine, pagesAfterChat, screenshotPath, chatSnapshotStart: summarize(current) });
      return;
    }

    trace.push(`fill:greeting:${inputUid}`);
    await callTool(client, "fill", { uid: inputUid, value: GREETING, includeSnapshot: true }).catch(async () => {
      await callTool(client, "click", { uid: inputUid, includeSnapshot: false });
      await callTool(client, "type_text", { text: GREETING });
    });
    await new Promise((resolve) => setTimeout(resolve, 1000));
    trace.push("take_snapshot:before_send");
    current = await snapshot(client);
    const sendLine = findSendLine(current);
    const sendUid = uidFromLine(sendLine);
    if (!sendUid) {
      const screenshotPath = `/private/tmp/boss-job-assistant-no-send-${Date.now()}.png`;
      await callTool(client, "take_screenshot", { format: "png", filePath: screenshotPath }).catch(() => null);
      printAndLog({ ok: false, reason: "send_button_uid_not_found_after_fill", trace, candidate, filterEvidence: match.evidence, inputLine, screenshotPath, beforeSendSnapshotStart: summarize(current) });
      return;
    }

    trace.push(`click:send:${sendUid}`);
    await callTool(client, "click", { uid: sendUid, includeSnapshot: true });
    await new Promise((resolve) => setTimeout(resolve, 2500));
    trace.push("take_snapshot:after_send");
    current = await snapshot(client);
    const success = current.includes(GREETING) || isStrongCommunicationEvidence(current, rootUrlFromSnapshot(current));
    const screenshotPath = `/private/tmp/boss-job-assistant-greet-${Date.now()}.png`;
    trace.push("take_screenshot");
    await callTool(client, "take_screenshot", { format: "png", filePath: screenshotPath }).catch(() => null);
    printAndLog({
      ok: success,
      reason: success ? "greeting_sent_with_strong_signal" : "greeting_sent_but_not_confirmed",
      success,
      sentExtraMessage: true,
      trace,
      initialized: initialized.serverInfo || null,
      candidate,
      filterEvidence: match.evidence,
      chatLine,
      inputLine,
      sendLine,
      screenshotPath,
      finalSnapshotStart: summarize(current)
    });
  } finally {
    client.stop();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exit(1);
});
