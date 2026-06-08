"use strict";

const TRANSIENT_RE = /Could not connect to Chrome|Failed to fetch browser webSocket URL|Protocol error|Target closed|No page selected|Cannot find context|does not belong to the document|The selected page has been closed/i;
const STOP_GATE_RE = /验证码|安全验证|滑块|账号异常|登录\/注册|登录账号|请完善简历/;
const CHAT_URL_RE = /\/web\/geek\/chat/;
const STRONG_CHAT_RE = /(\[送达\]|\[已读\]|您正在与Boss|正在沟通|新沟通|继续沟通|已沟通|沟通过|刚刚沟通)/;

function classifyBrowserText(text) {
  const value = String(text || "");
  if (/Failed to fetch browser webSocket URL|Could not connect to Chrome/i.test(value)) {
    return "mcp_chrome_connect_failed";
  }
  if (/The selected page has been closed|Target closed|No page selected|Cannot find context|does not belong to the document/i.test(value)) {
    return "target_closed";
  }
  if (/验证码|安全验证|滑块/i.test(value)) return "verify_required";
  if (/登录\/注册|登录账号/i.test(value)) return "login_required";
  if (/请完善简历/i.test(value)) return "resume_profile_required";
  return "";
}

function isTransientBrowserText(text) {
  return TRANSIENT_RE.test(String(text || ""));
}

function hasStopGate(text) {
  return STOP_GATE_RE.test(String(text || ""));
}

function isStrongCommunicationEvidence(snapshotText, rootUrl = "") {
  const snapshot = String(snapshotText || "");
  const url = String(rootUrl || "");
  return (CHAT_URL_RE.test(url) || CHAT_URL_RE.test(snapshot)) && STRONG_CHAT_RE.test(snapshot);
}

function classifyAfterChatClick(snapshotText, rootUrl = "") {
  const failure = classifyBrowserText(snapshotText);
  if (failure === "target_closed") return "quota_or_rate_limit_suspected";
  if (failure) return failure;
  if (hasStopGate(snapshotText)) return classifyBrowserText(snapshotText) || "stop_gate";
  if (isStrongCommunicationEvidence(snapshotText, rootUrl)) return "communication_established";
  return "unknown_after_click";
}

module.exports = {
  classifyAfterChatClick,
  classifyBrowserText,
  hasStopGate,
  isStrongCommunicationEvidence,
  isTransientBrowserText
};
