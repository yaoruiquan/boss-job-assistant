#!/usr/bin/env node
"use strict";

const { spawn } = require("child_process");
const path = require("path");

const SCRIPT_DIR = __dirname;
const WRAPPER = path.join(SCRIPT_DIR, "chrome-devtools-mcp-wrapper.sh");
const TARGET_URL = process.argv[2] || "https://www.zhipin.com/web/geek/jobs?query=%E5%AE%89%E5%85%A8%E5%AE%9E%E4%B9%A0&city=101280600";
const GREETING = process.argv[3] || "您好，我对这个岗位比较感兴趣，想进一步了解一下。";
const TARGET_QUERY = (() => {
  try {
    return new URL(TARGET_URL).searchParams.get("query") || "";
  } catch {
    return "";
  }
})();

function startServer() {
  const child = spawn(WRAPPER, [], {
    cwd: path.dirname(SCRIPT_DIR),
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env }
  });

  let nextId = 1;
  let buffer = "";
  const pending = new Map();
  const stderr = [];

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
  return { request, notify, stop, stderr };
}

function textFromResult(result) {
  return (result?.content || []).map((item) => item.text || "").join("\n");
}

async function callTool(client, name, args = {}) {
  return client.request("tools/call", { name, arguments: args });
}

function uidFromLine(line) {
  const match = line.match(/\buid=([a-zA-Z0-9_:-]+)\b/);
  return match ? match[1] : null;
}

function urlFromLine(line) {
  const match = line.match(/\burl="([^"]+)"/);
  return match ? match[1] : "";
}

function extractPages(listPagesText) {
  const pages = [];
  for (const line of listPagesText.split(/\n/)) {
    const match = line.match(/^(\d+):\s+(\S+)(.*)$/);
    if (match) {
      pages.push({ pageId: Number(match[1]), url: match[2], line });
    }
  }
  return pages;
}

function findLine(snapshotText, predicate) {
  return snapshotText.split(/\n/).find(predicate) || "";
}

function findJobLine(snapshotText) {
  const exclude = /BOSS直聘|首页|职位|公司|校园|海归|APP|消息|简历|求职者|推荐|添加求职期望|地图|搜索|清空|绿盟科技|华为|安恒信息|字节跳动|公司/;
  return findLine(snapshotText, (line) => {
    if (!/\blink\b/.test(line)) return false;
    if (!/安全|渗透|漏洞|实习/.test(line)) return false;
    if (exclude.test(line)) return false;
    return Boolean(uidFromLine(line));
  });
}

function findChatButtonLine(snapshotText) {
  return findLine(snapshotText, (line) =>
    /\b(link|button)\b/.test(line) &&
    /立即沟通|继续沟通|打招呼/.test(line) &&
    Boolean(uidFromLine(line))
  );
}

function findInputLine(snapshotText) {
  return findLine(snapshotText, (line) =>
    /uid=/.test(line) &&
    /(textbox|text area|textarea|editable|contenteditable|输入框|请输入|说点什么|聊一聊)/i.test(line) &&
    !/搜索职位|搜索/.test(line) &&
    !/\blink\b/.test(line) &&
    Boolean(uidFromLine(line))
  );
}

function findSendLine(snapshotText) {
  return findLine(snapshotText, (line) =>
    /uid=/.test(line) &&
    /\b(link|button)\b/.test(line) &&
    /发送|Send/.test(line) &&
    Boolean(uidFromLine(line))
  );
}

function findSearchInputLine(snapshotText) {
  return findLine(snapshotText, (line) =>
    /uid=/.test(line) &&
    /textbox/.test(line) &&
    /搜索职位、公司/.test(line) &&
    Boolean(uidFromLine(line))
  );
}

function findSearchButtonLine(snapshotText) {
  return findLine(snapshotText, (line) =>
    /uid=/.test(line) &&
    /\b(link|button)\b/.test(line) &&
    /搜索/.test(line) &&
    Boolean(uidFromLine(line))
  );
}

function findCommonPhraseLine(snapshotText) {
  return findLine(snapshotText, (line) =>
    /uid=/.test(line) &&
    /(常用语|打招呼|您好|感兴趣|方便聊|了解一下)/.test(line) &&
    Boolean(uidFromLine(line))
  );
}

function summarize(snapshotText, max = 3500) {
  return snapshotText.replace(/\n\s*\n/g, "\n").slice(0, max);
}

function rootUrlFromSnapshot(snapshotText) {
  const match = snapshotText.match(/RootWebArea[^\n]*\burl="([^"]+)"/);
  return match ? match[1] : "";
}

async function stopWithSnapshot(client, payload) {
  const screenshotPath = `/private/tmp/boss-job-assistant-stop-${Date.now()}.png`;
  await callTool(client, "take_screenshot", { format: "png", filePath: screenshotPath }).catch(() => null);
  console.log(JSON.stringify({ ok: false, stopped: true, screenshotPath, ...payload }, null, 2));
}

function hasStopGate(snapshotText) {
  if (/验证码|安全验证|滑块|账号异常/.test(snapshotText)) return "verify_required";
  if (/登录\/注册|登录账号/.test(snapshotText)) return "login_required";
  if (/请完善简历/.test(snapshotText)) return "resume_profile_required";
  return "";
}

async function snapshot(client, attempts = 4) {
  let text = "";
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = await callTool(client, "take_snapshot", {});
    text = textFromResult(result);
    if (!/Protocol error|Cannot find context|does not belong to the document|Target closed/i.test(text)) {
      return { text, attempt };
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  return { text, attempt: attempts };
}

async function stableSnapshot(client, attempts = 8) {
  let current = await snapshot(client);
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const bareRootOnly = /^## Latest page snapshot\nuid=\S+ RootWebArea/.test(current.text.trim()) && current.text.trim().split(/\n/).length <= 2;
    const busyRoot = /^## Latest page snapshot\nuid=\S+ RootWebArea .* busy url=/.test(current.text.trim());
    if (!bareRootOnly && !busyRoot && current.text.length > 500) return current;
    await new Promise((resolve) => setTimeout(resolve, 1500));
    current = await snapshot(client);
  }
  return current;
}

async function main() {
  const client = startServer();
  const trace = [];
  try {
    const initialized = await client.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "boss-job-assistant-mcp-full-greet", version: "0.1.0" }
    });
    client.notify("notifications/initialized");

    const tools = await client.request("tools/list", {});
    const toolNames = (tools.tools || []).map((tool) => tool.name);
    for (const required of ["list_pages", "select_page", "navigate_page", "wait_for", "take_snapshot", "click", "fill", "type_text", "press_key"]) {
      if (!toolNames.includes(required)) throw new Error(`required MCP tool not available: ${required}`);
    }

    trace.push("list_pages");
    await callTool(client, "list_pages");
    trace.push("navigate_page:search");
    await callTool(client, "navigate_page", { type: "url", url: TARGET_URL, timeout: 15000 });
    await callTool(client, "wait_for", { text: ["立即沟通", "安全", "登录/注册", "验证码"], timeout: 12000 }).catch(() => null);

    trace.push("take_snapshot:search");
    let current = await snapshot(client);
    let stopReason = hasStopGate(current.text);
    if (stopReason) {
      await stopWithSnapshot(client, { reason: stopReason, trace, snapshotStart: summarize(current.text) });
      return;
    }

    let jobLine = `direct detail target url="${TARGET_URL}"`;
    if (/\/job_detail\//.test(TARGET_URL)) {
      trace.push("direct_job_detail_target");
    } else {
    if (TARGET_QUERY) {
      const searchInputLine = findSearchInputLine(current.text);
      const searchInputUid = uidFromLine(searchInputLine);
      if (searchInputUid) {
        trace.push(`fill:search:${searchInputUid}:${TARGET_QUERY}`);
        await callTool(client, "fill", { uid: searchInputUid, value: TARGET_QUERY, includeSnapshot: true }).catch(async () => {
          await callTool(client, "click", { uid: searchInputUid, includeSnapshot: false });
          await callTool(client, "press_key", { key: "Meta+A" }).catch(() => null);
          await callTool(client, "type_text", { text: TARGET_QUERY });
        });
        await new Promise((resolve) => setTimeout(resolve, 1000));
        trace.push("take_snapshot:after_search_fill");
        current = await snapshot(client);
        const searchButtonLine = findSearchButtonLine(current.text);
        const searchButtonUid = uidFromLine(searchButtonLine);
        if (!searchButtonUid) {
          await stopWithSnapshot(client, { reason: "search_button_uid_not_found_after_fill", trace, searchInputLine, snapshotStart: summarize(current.text, 6000) });
          return;
        }
        trace.push(`click:search:${searchButtonUid}`);
        await callTool(client, "click", { uid: searchButtonUid, includeSnapshot: true });
        await callTool(client, "wait_for", { text: ["立即沟通", TARGET_QUERY, "暂无", "没有找到", "搜索职位"], timeout: 20000 }).catch(() => null);
        await new Promise((resolve) => setTimeout(resolve, 5000));
        trace.push("take_snapshot:search_after_explicit_submit");
        current = await stableSnapshot(client);
        stopReason = hasStopGate(current.text);
        if (stopReason) {
          await stopWithSnapshot(client, { reason: stopReason, trace, snapshotStart: summarize(current.text) });
          return;
        }
      }
    }

    jobLine = findJobLine(current.text);
    const jobUid = uidFromLine(jobLine);
    if (!jobUid) {
      await stopWithSnapshot(client, { reason: "job_uid_not_found", trace, snapshotStart: summarize(current.text, 6000) });
      return;
    }

    trace.push(`click:job:${jobUid}`);
    await callTool(client, "click", { uid: jobUid, includeSnapshot: true });
    const jobUrl = urlFromLine(jobLine);
    const jobUrlBase = jobUrl.split("?")[0];
    let pagesAfterJobClick = "";
    let detailPage = null;
    for (let attempt = 1; attempt <= 8; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      trace.push(`list_pages:after_job_click:${attempt}`);
      pagesAfterJobClick = textFromResult(await callTool(client, "list_pages"));
      const pages = extractPages(pagesAfterJobClick);
      detailPage = pages.find((page) => jobUrlBase && page.url.startsWith(jobUrlBase)) ||
        pages.find((page) => /\/job_detail\//.test(page.url));
      if (detailPage) break;
    }
    if (detailPage) {
      trace.push(`select_page:job_detail:${detailPage.pageId}`);
      await callTool(client, "select_page", { pageId: detailPage.pageId, bringToFront: true });
      await callTool(client, "wait_for", { text: ["立即沟通", "继续沟通", "职位描述", "验证码", "安全验证"], timeout: 15000 }).catch(() => null);
    } else if (jobUrl) {
      trace.push("navigate_page:fallback_job_detail_after_click");
      await callTool(client, "navigate_page", { type: "url", url: jobUrl, timeout: 15000 });
      await callTool(client, "wait_for", { text: ["立即沟通", "继续沟通", "职位描述", "验证码", "安全验证"], timeout: 15000 }).catch(() => null);
    } else {
      await stopWithSnapshot(client, { reason: "job_detail_page_not_found_after_job_click", trace, jobLine, pagesAfterJobClickStart: pagesAfterJobClick.slice(0, 3000) });
      return;
    }
    }

    trace.push("take_snapshot:detail");
    current = await stableSnapshot(client);
    stopReason = hasStopGate(current.text);
    if (stopReason) {
      await stopWithSnapshot(client, { reason: stopReason, trace, jobLine, snapshotStart: summarize(current.text) });
      return;
    }

    const chatLine = findChatButtonLine(current.text);
    const chatUid = uidFromLine(chatLine);
    if (!chatUid) {
      await stopWithSnapshot(client, { reason: "chat_button_uid_not_found_after_job_click", trace, jobLine, detailSnapshotStart: summarize(current.text, 6000) });
      return;
    }

    trace.push(`click:chat:${chatUid}`);
    await callTool(client, "click", { uid: chatUid, includeSnapshot: true });
    let pagesAfterChatClick = "";
    let chatPage = null;
    let stillOpenDetailPage = null;
    for (let attempt = 1; attempt <= 8; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      trace.push(`list_pages:after_chat_click:${attempt}`);
      pagesAfterChatClick = textFromResult(await callTool(client, "list_pages"));
      const pages = extractPages(pagesAfterChatClick);
      chatPage = pages.find((page) => /\/web\/geek\/chat/.test(page.url));
      stillOpenDetailPage = pages.find((page) => /\/job_detail\//.test(page.url));
      if (chatPage || stillOpenDetailPage) break;
    }
    if (chatPage) {
      trace.push(`select_page:chat:${chatPage.pageId}`);
      await callTool(client, "select_page", { pageId: chatPage.pageId, bringToFront: true });
    } else if (stillOpenDetailPage) {
      trace.push(`select_page:detail_after_chat:${stillOpenDetailPage.pageId}`);
      await callTool(client, "select_page", { pageId: stillOpenDetailPage.pageId, bringToFront: true });
    } else {
      const firstPage = extractPages(pagesAfterChatClick).find((page) => /^https?:\/\//.test(page.url));
      if (firstPage) {
        trace.push(`select_page:fallback:${firstPage.pageId}`);
        await callTool(client, "select_page", { pageId: firstPage.pageId, bringToFront: true });
      }
    }
    await callTool(client, "wait_for", { text: ["发送", "常用语", "继续沟通", "已沟通", "验证码", "安全验证"], timeout: 10000 }).catch(() => null);

    trace.push("take_snapshot:chat");
    current = await stableSnapshot(client);
    stopReason = hasStopGate(current.text);
    if (stopReason) {
      await stopWithSnapshot(client, { reason: stopReason, trace, jobLine, chatLine, snapshotStart: summarize(current.text, 6000) });
      return;
    }
    const rootUrl = rootUrlFromSnapshot(current.text);
    if (/^https:\/\/www\.zhipin\.com\/shenzhen\//.test(rootUrl)) {
      await stopWithSnapshot(client, { reason: "clicked_but_returned_home", trace, jobLine, chatLine, snapshotStart: summarize(current.text, 6000) });
      return;
    }
    const alreadyCommunicated = /\/web\/geek\/chat/.test(rootUrl) && /(\[送达\]|\[已读\]|您正在与Boss|正在沟通)/.test(current.text);
    if (alreadyCommunicated && process.env.BOSS_FORCE_EXTRA_SEND !== "1") {
      const screenshotPath = `/private/tmp/boss-job-assistant-greet-${Date.now()}.png`;
      trace.push("take_screenshot");
      await callTool(client, "take_screenshot", { format: "png", filePath: screenshotPath }).catch(() => null);
      console.log(JSON.stringify({
        ok: true,
        reason: "communication_established_no_extra_send",
        success: true,
        sentExtraMessage: false,
        trace,
        targetUrl: TARGET_URL,
        initialized: initialized.serverInfo || null,
        jobLine,
        chatLine,
        screenshotPath,
        finalSnapshotStart: summarize(current.text, 7000)
      }, null, 2));
      return;
    }

    let inputLine = findInputLine(current.text);
    let inputUid = uidFromLine(inputLine);
    if (!inputUid) {
      const phraseLine = findCommonPhraseLine(current.text);
      const phraseUid = uidFromLine(phraseLine);
      if (phraseUid) {
        trace.push(`click:common_phrase:${phraseUid}`);
        await callTool(client, "click", { uid: phraseUid, includeSnapshot: true });
        await new Promise((resolve) => setTimeout(resolve, 1500));
        current = await snapshot(client);
        inputLine = findInputLine(current.text);
        inputUid = uidFromLine(inputLine);
      }
    }

    if (!inputUid) {
      await stopWithSnapshot(client, { reason: "chat_input_uid_not_found", trace, jobLine, chatLine, chatSnapshotStart: summarize(current.text, 7000) });
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
    const sendLine = findSendLine(current.text);
    const sendUid = uidFromLine(sendLine);
    if (!sendUid) {
      await stopWithSnapshot(client, { reason: "send_button_uid_not_found_after_fill", trace, jobLine, chatLine, inputLine, snapshotStart: summarize(current.text, 7000) });
      return;
    }

    trace.push(`click:send:${sendUid}`);
    await callTool(client, "click", { uid: sendUid, includeSnapshot: true });
    await new Promise((resolve) => setTimeout(resolve, 2500));

    trace.push("take_snapshot:after_send");
    current = await snapshot(client);
    const success = current.text.includes(GREETING) || /继续沟通|已沟通|沟通过|刚刚沟通|\/web\/geek\/chat/.test(current.text);
    const screenshotPath = `/private/tmp/boss-job-assistant-greet-${Date.now()}.png`;
    trace.push("take_screenshot");
    await callTool(client, "take_screenshot", { format: "png", filePath: screenshotPath }).catch(() => null);

    console.log(JSON.stringify({
      ok: success,
      reason: success ? "greeting_sent_with_strong_signal" : "greeting_sent_but_not_confirmed",
      success,
      trace,
      targetUrl: TARGET_URL,
      greeting: GREETING,
      initialized: initialized.serverInfo || null,
      jobLine,
      chatLine,
      inputLine,
      sendLine,
      screenshotPath,
      finalSnapshotStart: summarize(current.text, 7000)
    }, null, 2));
  } finally {
    client.stop();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exit(1);
});
