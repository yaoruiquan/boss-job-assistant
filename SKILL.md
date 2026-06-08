---
name: boss-job-assistant
description: 使用 Chrome DevTools MCP 辅助 BOSS 直聘求职沟通；按城市、岗位名、公司规模、工作类型、融资阶段等规则筛选岗位，低频打招呼，记录跳过原因，并在对方回复且关键词命中后辅助发简历。适用于用户要配置自动打招呼、回复后再发简历、BOSS 求职自动化、岗位筛选规则、Chrome MCP 接管真实浏览器。
---

# boss-job-assistant

BOSS 求职沟通助手。目标是把用户给出的规则转换为可审计的浏览器半自动流程：筛岗位、打招呼、记录状态、回复后辅助判断是否发简历。

## 重要边界

本 skill 不设计验证码绕过、反检测、批量骚扰、隐藏自动化痕迹或平台数据抓取库。默认以真实 Chrome、人工登录、低频操作、人工可接管为前提。

MVP 默认动作：

1. 命中规则后只打招呼，不主动投递简历。
2. 只有对方回复后，先回答对方问题，再询问是否方便发简历。
3. 只有回复中出现规则关键词（如“发我看看”“简历”“方便”）时，才进入发简历步骤。
4. 发简历前默认要求用户确认；用户明确配置后才允许更自动的动作。

## 入口判断

- 规则配置：用户说明城市、岗位名、公司规模、工作类型、融资阶段等条件。
- 环境初始化：用户要求配置 Chrome DevTools MCP、启动 Chrome、检查连接。
- 半自动执行：用户要求在 BOSS 页面按规则筛选、打招呼、记录。
- 回复处理：用户要求检查已回复会话、判断是否可以发简历。

## 必读引用

- 运行强约束：`references/runtime-rules.md`
- MCP/Chrome 连接：`references/mcp-connection.md`
- MCP 工具流：`references/mcp-tool-flow.md`
- 筛选条件：`references/filter-conditions.md`
- 规则格式：`references/rule-schema.md`
- 执行流程：`references/workflow.md`

## 固定命令

环境初始化：

```bash
./scripts/start-chrome-debug.sh isolated
curl -sS http://127.0.0.1:9335/json/version
```

规则判定：

```bash
python3 scripts/evaluate_job.py assets/rules.example.json /tmp/job.json
```

MCP wrapper：

```bash
./scripts/chrome-devtools-mcp-wrapper.sh
```

## 最短执行骨架

1. 先读 `references/runtime-rules.md`，确认本次动作不越界。
2. 若是环境任务，再读 `references/mcp-connection.md`，启动或检查 Chrome 调试端口。
3. 若是规则任务，再读 `references/rule-schema.md`，把用户自然语言规则整理成 JSON。
4. 若涉及筛选条件，先读 `references/filter-conditions.md`。
5. 若是浏览器执行任务，再读 `references/workflow.md`。
6. 浏览器阶段只从当前 BOSS 页面读取可见岗位信息，不做跨页高速抓取。
7. 每个岗位先用规则判定，输出 `action` 和 `reason`。
8. 仅当 `action=chat_only` 时进入打招呼；其他动作记录并跳过。
9. 发送前检查每日上限、去重记录、当前页面状态和用户设置。
10. 回复处理阶段只在对方已回复后运行；关键词命中后进入“发简历前确认”。

## 关键脚本

- `scripts/start-chrome-debug.sh`：启动 skill 专用 Chrome，端口默认 `9335`。
- `scripts/chrome-devtools-mcp-wrapper.sh`：让 `chrome-devtools-mcp` attach 到 `9335`。
- `scripts/evaluate_job.py`：本地规则判定，输入规则和岗位 JSON，输出动作。
- `scripts/smoke_read_page.js`：只读诊断 BOSS 页面状态和可见岗位摘要；不能代替 MCP snapshot。
- `scripts/inspect_boss_actions.js`：只读诊断当前页面是否有可见 `立即沟通`、输入框、验证状态；不能代替 MCP snapshot。
- `scripts/mcp_greet_once.js`：启动 `chrome-devtools-mcp` stdio server，并通过 MCP `list_pages/take_snapshot/click/take_snapshot` 做单条打招呼验证。
- `scripts/mcp_snapshot_status.js`：启动 `chrome-devtools-mcp` stdio server，并通过 MCP 只读 snapshot 检查页面状态。

## 执行原则

1. 浏览器交互必须优先使用 Chrome DevTools MCP 的 `list_pages`、`take_snapshot`、`click`、`take_screenshot` 工具流；直接 CDP 脚本只允许做端口和只读诊断，不能用于打招呼成功验证。
2. 不声称“不会被检测”。只说明真实 Chrome 接管比新开自动化浏览器更自然，但账号风险仍取决于平台规则和行为模式。
3. 所有自动打招呼必须限速、去重、记录。
4. 任何验证码、登录、风控弹窗、异常页面，必须交给用户人工处理。
5. 页面选择器不稳定时，停止自动点击，改为截图和候选清单。
6. 不自动捏造个人经历、薪资、到岗时间或项目事实；回复内容规则后续单独配置。
7. 打招呼成功必须有强证据：`继续沟通`、`已沟通`、聊天输入区、或跳转 `/web/geek/chat`。点击后跳首页或仍无法确认时必须判为失败。
