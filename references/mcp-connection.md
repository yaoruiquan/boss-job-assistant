# Chrome DevTools MCP 连接方式

本 skill 参考 CNVD 上报 skill 的连接模式：启动一个 skill 专用真实 Chrome，并让 `chrome-devtools-mcp` 通过 `--browserUrl` attach 到该浏览器。

## 端口和 profile

- 默认端口：`9335`
- 默认 profile 名：`boss-job-assistant`
- 默认启动方式：`isolated`

`isolated` 使用独立空 profile，不复制主浏览器标签页、历史和登录态。BOSS 场景优先使用该模式，然后在专用 Chrome 里人工登录。

`seed-default` 会把日常 Chrome 的状态快照到 skill profile，可能带来主浏览器标签页、Cookie、历史记录和登录状态的副本。只有在用户明确要求复用主浏览器登录态时才使用。它仍然不是“不可检测”，只是比全新自动化浏览器更接近真实使用环境。

## 启动 Chrome

```bash
/Users/yao/.codex/skills/boss-job-assistant/scripts/start-chrome-debug.sh isolated
curl -sS http://127.0.0.1:9335/json/version
```

如果日常 Chrome profile 不是 `Default`，先在 `.env` 里设置：

```bash
CLAUDE_CHROME_PROFILE_DIRECTORY="Profile 1"
```

## MCP 配置

项目或 skill 根目录可使用 `.mcp.json`：

```json
{
  "mcpServers": {
    "boss-chrome": {
      "command": "/Users/yao/.codex/skills/boss-job-assistant/scripts/chrome-devtools-mcp-wrapper.sh",
      "args": []
    }
  }
}
```

如果 MCP 客户端需要从其他目录启动，使用绝对路径添加 wrapper。

## 验证连接

```bash
curl -sS http://127.0.0.1:9335/json/version
```

MCP 工具侧验证：

- `list_pages`
- `take_snapshot`
- `take_screenshot`

## 方案选择

- 首选：Chrome DevTools MCP attach 真实 Chrome。
- 备选：Playwright `connectOverCDP` attach 到同一端口，用于工程化测试或元素定位验证。
- 不推荐：Playwright 默认新开浏览器执行 BOSS 主流程。
