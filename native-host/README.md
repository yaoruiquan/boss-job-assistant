# Native Host

Chrome 扩展通过 Native Messaging 调用本地 `host.js`。`host.js` 只调度仓库内已有脚本，不直接操作 BOSS 页面。

## 安装

1. 在 `chrome://extensions` 开启开发者模式。
2. 加载仓库里的 `extension/` 目录。
3. 复制扩展 ID。
4. 执行：

```bash
./native-host/install-host.sh <extension-id>
```

安装后，Chrome 会读取：

```text
~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.yao.boss_job_assistant.json
```

## 命令

- `status`：检查 `127.0.0.1:9335/json/version` 和最近日志。
- `start_chrome`：启动专用 Chrome profile。
- `snapshot`：运行 MCP 只读 snapshot。
- `greet_current`：运行一次当前列表页 MCP 打招呼流程。
- `greet_detail`：运行一次当前详情页 MCP 打招呼流程。
- `last_runs`：读取本地 JSONL 日志。
