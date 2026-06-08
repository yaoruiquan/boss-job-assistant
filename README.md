# BOSS 求职助手 Skill

这是一个 Codex/Claude 风格的本地 skill，用 Chrome DevTools MCP 接管用户自己的真实 Chrome，辅助在 BOSS 直聘中按规则筛选岗位、低频打招呼，并在后续回复阶段辅助判断是否可以发简历。

## 目标

- 按城市、岗位名、工作类型、公司规模、融资阶段等条件筛选岗位。
- 命中规则后只打招呼，不主动投递简历。
- 只有对方回复后，先回答问题，再询问是否方便发简历。
- 只有对方回复命中关键词，例如“发我看看”“简历”“方便”“可以发”，才进入发简历流程。
- 默认发简历前需要人工确认。

## 安全边界

本 skill 不做验证码绕过、反检测、隐藏自动化痕迹、批量高速抓取或构造接口请求。默认前提是：

- 使用用户本人账号。
- 使用真实 Chrome 和人工登录。
- 使用独立 Chrome profile，避免影响主浏览器。
- 低频执行、可人工接管。
- 遇到验证码、风控、登录、账号异常、页面结构异常时立即停止。

不要把它当成批量群发工具。建议每日自动打招呼上限低于平台上限，例如 `20-120` 之间，并保留人工余量。

## 目录结构

```text
.
├── SKILL.md
├── README.md
├── .mcp.json
├── .env.example
├── agents/
├── assets/
├── extension/
├── native-host/
├── references/
└── scripts/
```

关键文件：

- `SKILL.md`：skill 入口说明。
- `references/runtime-rules.md`：运行边界和停止条件。
- `references/mcp-connection.md`：Chrome DevTools MCP 连接方式。
- `references/mcp-tool-flow.md`：真实 MCP `list_pages/take_snapshot/click` 流程。
- `references/filter-conditions.md`：筛选字段设计。
- `references/rule-schema.md`：规则 JSON 格式。
- `references/workflow.md`：岗位筛选、打招呼、回复处理流程。
- `references/failure-reasons.md`：统一失败原因分类。
- `references/chrome-extension.md`：Chrome 插件 + Native Host 模式。
- `scripts/start-chrome-debug.sh`：启动专用 Chrome。
- `scripts/chrome-devtools-mcp-wrapper.sh`：连接 `chrome-devtools-mcp`。
- `scripts/evaluate_job.py`：本地规则判定。
- `scripts/mcp_dump_snapshot.js`：MCP 只读快照，也包含当前页/详情页 smoke 辅助模式。
- `scripts/mcp_full_greet_flow.js`：单岗位完整沟通尝试脚本。
- `scripts/lib/boss_policy.js`：统一 MCP 异常、人工关口、沟通结果分类。
- `scripts/test_policy.js`：失败分类和强成功信号的回归测试。
- `extension/`：Chrome Manifest V3 插件。
- `native-host/`：Chrome Native Messaging 本地桥接。

## 安装依赖

需要本机安装：

- Google Chrome
- Node.js
- `chrome-devtools-mcp`
- Python 3

安装 MCP：

```bash
npm install -g chrome-devtools-mcp
```

确认 MCP 二进制路径：

```bash
which chrome-devtools-mcp
```

如路径不是 `/opt/homebrew/bin/chrome-devtools-mcp`，修改 `.env` 中的 `CHROME_DEVTOOLS_MCP_BIN`。

## 配置

复制环境变量模板：

```bash
cp .env.example .env
```

默认配置：

```bash
CHROME_DEBUG_PORT=9335
CHROME_PROFILE_NAME=boss-job-assistant
CHROME_DEVTOOLS_BOSS_HOST=127.0.0.1
CHROME_DEVTOOLS_BOSS_PORT=9335
CHROME_DEVTOOLS_MCP_BIN=/opt/homebrew/bin/chrome-devtools-mcp
```

默认使用独立 profile：

```text
~/.claude/skills/shared-chrome-devtools/profiles/boss-job-assistant
```

这不是主浏览器 profile。第一次使用时，需要在这个专用 Chrome 里人工登录 BOSS。

## 启动专用 Chrome

```bash
./scripts/start-chrome-debug.sh isolated
curl -sS http://127.0.0.1:9335/json/version
```

`isolated` 表示独立 profile。不要默认使用主浏览器 profile。

## MCP 配置

`.mcp.json` 已包含 `boss-chrome` server：

```json
{
  "mcpServers": {
    "boss-chrome": {
      "command": "/bin/bash",
      "args": [
        "-lc",
        "for d in \"${BOSS_JOB_ASSISTANT_SKILL_ROOT:-}\" /Users/yao/.codex/skills/boss-job-assistant; do if [ -n \"$d\" ] && [ -x \"$d/scripts/chrome-devtools-mcp-wrapper.sh\" ]; then exec \"$d/scripts/chrome-devtools-mcp-wrapper.sh\"; fi; done; echo 'boss-job-assistant chrome-devtools-mcp-wrapper.sh not found' >&2; exit 1"
      ]
    }
  }
}
```

如果安装到其他路径，设置：

```bash
export BOSS_JOB_ASSISTANT_SKILL_ROOT=/path/to/boss-job-assistant
```

## 规则示例

示例：杭州、AI 应用开发、实习、100-499 人及以上、B 轮及以后。

```json
{
  "limits": {
    "daily_chat_limit": 20,
    "session_job_limit": 10
  },
  "default_action": "review",
  "greeting_template": "您好，我对这个岗位比较感兴趣，想进一步了解一下。",
  "resume_send_policy": {
    "require_reply": true,
    "require_keywords": ["发我看看", "简历", "方便", "可以发"],
    "require_manual_confirm": true
  },
  "rules": [
    {
      "name": "杭州 AI 应用开发实习",
      "action": "chat_only",
      "priority": 100,
      "match": {
        "cities_any": ["杭州"],
        "title_any": ["AI应用开发", "AI 应用开发", "应用开发", "应用研发", "AI Agent", "大模型应用"],
        "employment_types_any": ["实习"],
        "company_sizes_any": ["100-499人", "500-999人", "1000-9999人", "10000人以上"],
        "financing_stages_any": ["B轮", "C轮", "D轮及以上", "已上市", "不需要融资"]
      },
      "exclude": {
        "title_any": ["销售", "客服", "主播", "带货", "招聘专员", "课程顾问"]
      }
    }
  ]
}
```

规则判定：

```bash
python3 scripts/evaluate_job.py assets/rules.example.json assets/job.example.json
```

## 本地验证

```bash
node --check scripts/mcp_dump_snapshot.js
node --check scripts/mcp_boss_current_page_greet.js
node --check scripts/mcp_hangzhou_ai_smoke.js
node --check scripts/mcp_greet_once.js
node --check native-host/host.js
node scripts/test_policy.js
node scripts/test_native_host.js
python3 -m py_compile scripts/evaluate_job.py
```

## Chrome 插件模式

插件模式的职责是提供控制台和规则设置；真实页面动作仍由 Native Host 调用本地 MCP 脚本完成。

```text
extension/popup.js
  -> chrome.runtime.sendNativeMessage("com.yao.boss_job_assistant")
  -> native-host/host.js
  -> scripts/mcp_dump_snapshot.js / scripts/mcp_snapshot_status.js
  -> chrome-devtools-mcp
```

安装步骤：

1. 打开 `chrome://extensions`。
2. 开启开发者模式。
3. 点击“加载已解压的扩展程序”，选择本仓库的 `extension/` 目录。
4. 复制扩展 ID。
5. 注册 Native Host：

```bash
./native-host/install-host.sh <extension-id>
```

插件按钮：

- `开启助手`：允许执行沟通类动作；默认关闭。
- `暂停/继续`：暂停时会阻止 `列表沟通` 和 `详情沟通`。
- `检查连接`：检查专用 Chrome `127.0.0.1:9335` 和最近日志。
- `启动专用 Chrome`：启动 isolated profile。
- `只读扫描`：运行 MCP snapshot 状态检查。
- `列表沟通`：运行一次 `--greet-current`，失败会写入 JSONL 日志。
- `详情沟通`：运行一次 `--greet-detail`，适合当前已打开岗位详情页。

插件不直接用 content script 点击 BOSS 页面，也不把主流程改成 DOM `.click()`。content script 只显示一个本页已连接的小浮层。

测试顺序：

1. 先点 `开启助手`。
2. 点 `启动 Chrome`。
3. 在专用 Chrome 里人工登录 BOSS。
4. 回到插件点 `检查`。
5. 先点 `扫描` 验证 MCP 路径。
6. 确认页面和规则无误后，再点 `列表沟通` 或 `详情沟通`。

如果点击沟通类按钮返回 `assistant_disabled`，说明还没点 `开启助手`。如果返回 `assistant_paused`，点 `继续` 后再试。

## MCP 执行原则

浏览器阶段必须使用 Chrome DevTools MCP 工具流：

1. `list_pages`
2. `take_snapshot`
3. 从 snapshot 中提取岗位和按钮 `uid`
4. 规则判定
5. `click` 点击 snapshot 中的岗位或 `立即沟通`
6. 再次 `take_snapshot` 验证结果
7. 必要时 `take_screenshot` 保存证据

不要用 DOM `.click()`、CDP `Input.dispatchMouseEvent` 或坐标点击代替 MCP `click`。

## 常用命令

只读检查当前页面：

```bash
node scripts/mcp_dump_snapshot.js '' 8000
```

打开目标搜索页后读取：

```bash
node scripts/mcp_dump_snapshot.js 'https://www.zhipin.com/web/geek/jobs?query=ai%E5%BA%94%E7%94%A8%E5%BC%80%E5%8F%91&city=101210100' 12000
```

当前页 smoke 辅助：

```bash
node scripts/mcp_dump_snapshot.js --greet-current 1500
```

详情页 smoke 辅助：

```bash
node scripts/mcp_dump_snapshot.js --greet-detail 0
```

`--greet-current` 和 `--greet-detail` 会写入本地 JSONL 运行日志：

```text
data/runs-YYYY-MM-DD.jsonl
```

日志只保存在本地，默认不提交到 Git。每条记录包含时间、动作 trace、候选岗位、证据字段、失败原因和必要的 snapshot 摘要。

完整沟通尝试：

```bash
node scripts/mcp_full_greet_flow.js 'https://www.zhipin.com/job_detail/xxx.html'
```

## 成功判定

只有出现以下强信号，才记为成功：

- 详情页按钮变成 `继续沟通` 或 `已沟通`。
- 页面进入 `/web/geek/chat`。
- 聊天页出现输入区或发送区。
- 聊天页出现 `[送达]`、`[已读]`、`您正在与Boss...沟通`。

以下情况不能记为成功：

- 只看到顶部导航里的“消息”。
- MCP `click` 返回成功但后续 snapshot 没有强信号。
- 点击后页面关闭、跳首页、跳推荐页。
- 消息页没有明确出现对应新会话。

## Smoke Test 记录

一次真实测试使用条件：

- 城市：杭州
- 岗位：AI 应用开发
- 类型：实习
- 公司规模：100-499 人及以上
- 融资阶段：B 轮及以后

测试观察：

- MCP 能读取 BOSS 搜索页 snapshot。
- 能识别 `AI应用开发实习生 / 杭州今日头条科技` 等候选岗位。
- 能在详情页核验城市、标题、实习、规模和融资条件。
- 能用 MCP `click` 点击详情页 `立即沟通`。
- 点击后 BOSS 当前 page 可能关闭，消息页未必出现对应强成功信号。

因此此类情况应记录为 `quota_or_rate_limit_suspected` 或 `unknown_after_click`，不要重复点击同一岗位。

## 配额和频控处理

如果点击 `立即沟通` 后页面关闭，且没有聊天页强信号，默认处理：

- 停止当天自动打招呼。
- 不重复点击同一岗位。
- 标记为 `quota_or_rate_limit_suspected`；如果没有明确 target/page closed 证据，则标记为 `unknown_after_click`。
- 如消息页没有新会话，不计入成功。
- 后续只做只读筛选和记录。

脚本会优先把这种情况归类为：

```text
quota_or_rate_limit_suspected
```

这不是成功，也不是明确失败投递；它表示账号额度、平台频控或页面生命周期异常的可能性较高，应停止继续点击。

## 发简历策略

MVP 不主动投递简历。流程为：

1. 只打招呼。
2. 等待对方回复。
3. 先回答对方问题。
4. 再询问是否方便发简历。
5. 只有命中关键词后，进入发简历前确认。

关键词示例：

- `发我看看`
- `简历`
- `方便`
- `可以发`

## 免责声明

本项目仅用于个人求职辅助和本地自动化实验。使用者需要自行遵守 BOSS 直聘平台规则和账号使用限制。任何验证码、风控、登录异常或平台限制都应人工处理，不应尝试绕过。
