# Chrome 插件模式

本项目的 Chrome 插件只做控制台、规则设置、状态展示和人工触发。主执行仍由本地 Native Host 调用 Chrome DevTools MCP 脚本完成。

## 架构

```text
Chrome extension popup/options
  -> chrome.runtime.sendNativeMessage
  -> native-host/host.js
  -> scripts/mcp_*.js
  -> chrome-devtools-mcp
  -> 专用 Chrome 9335 / isolated profile
```

## 边界

- content script 不直接点击 BOSS 页面。
- 插件不使用 DOM `.click()`、坐标点击或构造接口请求执行主流程。
- 插件不使用 `chrome.debugger` 作为主执行通道。
- 真实沟通动作仍必须经过 MCP `list_pages/take_snapshot/click/take_snapshot`。
- 遇到登录、验证码、风控、target/page closed、强证据不足时，Native Host 返回失败原因并停止。

## 文件

- `extension/manifest.json`：Manifest V3 扩展声明。
- `extension/popup.*`：手动操作面板。
- `extension/options.*`：规则配置。
- `extension/content.*`：只显示页面浮层，不做主流程点击。
- `native-host/host.js`：Native Messaging host。
- `native-host/install-host.sh`：根据扩展 ID 注册 macOS Native Host。

## 安装

1. 打开 `chrome://extensions`。
2. 开启开发者模式。
3. 加载 `extension/` 目录。
4. 复制扩展 ID。
5. 执行：

```bash
./native-host/install-host.sh <extension-id>
```

## 命令映射

- `assistant_enabled`：扩展本地状态，允许沟通类动作。
- `assistant_paused`：扩展本地状态，阻止沟通类动作。
- `status`：检查 `127.0.0.1:9335/json/version` 和最近运行日志。
- `start_chrome`：启动专用 Chrome profile。
- `snapshot`：运行 `scripts/mcp_snapshot_status.js`。
- `greet_current`：运行 `scripts/mcp_dump_snapshot.js --greet-current`。
- `greet_detail`：运行 `scripts/mcp_dump_snapshot.js --greet-detail`。
- `last_runs`：读取 `data/runs-YYYY-MM-DD.jsonl`。

`greet_current` 和 `greet_detail` 必须在扩展 popup 中先开启助手，且当前不是暂停状态。这个门禁只在扩展层生效，不改变本地 MCP 脚本的安全边界。
