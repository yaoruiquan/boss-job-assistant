#!/usr/bin/env node
"use strict";

const assert = require("assert");
const {
  classifyAfterChatClick,
  classifyBrowserText,
  hasStopGate,
  isStrongCommunicationEvidence
} = require("./lib/boss_policy");

assert.strictEqual(
  classifyBrowserText("Could not connect to Chrome. Failed to fetch browser webSocket URL"),
  "mcp_chrome_connect_failed"
);
assert.strictEqual(
  classifyBrowserText("The selected page has been closed. Call list_pages to see open pages."),
  "target_closed"
);
assert.strictEqual(
  classifyAfterChatClick("The selected page has been closed. Call list_pages to see open pages."),
  "quota_or_rate_limit_suspected"
);
assert.strictEqual(
  classifyAfterChatClick("RootWebArea url=\"https://www.zhipin.com/web/geek/chat\" StaticText \"消息\""),
  "unknown_after_click"
);
assert.strictEqual(
  classifyBrowserText("请先完成安全验证，再继续操作"),
  "verify_required"
);
assert.strictEqual(
  hasStopGate("账号异常，请稍后再试"),
  true
);
assert.strictEqual(
  isStrongCommunicationEvidence("uid=1 StaticText \"[送达]\"", "https://www.zhipin.com/web/geek/chat"),
  true
);
assert.strictEqual(
  isStrongCommunicationEvidence("uid=1 StaticText \"消息\"", "https://www.zhipin.com/web/geek/chat"),
  false
);

console.log("policy tests passed");
