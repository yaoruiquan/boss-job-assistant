# Native Host

Chrome 扩展通过 Native Messaging 调用本地 `host.js`。`host.js` 只调度仓库内已有脚本，不直接操作 BOSS 页面。

## 安装

1. 在 `chrome://extensions` 开启开发者模式。
2. 加载仓库里的 `extension/` 目录。
3. 执行：

```bash
./native-host/install-host.sh auto
```

如果自动识别失败，再复制扩展 ID 后执行 `./native-host/install-host.sh <extension-id>`。

安装后，Chrome 会读取：

```text
~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.yao.boss_job_assistant.json
```

安装脚本还会生成：

```text
~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.yao.boss_job_assistant.sh
```

这个启动器会用安装时检测到的 Node.js 绝对路径执行 `host.js`，避免 Chrome GUI 环境找不到 `node`。

## 命令

- `status`：检查 `127.0.0.1:9335/json/version` 和最近日志。
- `start_chrome`：启动专用 Chrome profile。
- `snapshot`：运行 MCP 只读 snapshot。
- `start_automation`：从当前列表页运行一次受控 MCP 自动化流程。
- `greet_current`：运行一次当前列表页 MCP 打招呼流程。
- `greet_detail`：运行一次当前详情页 MCP 打招呼流程。
- `last_runs`：读取本地 JSONL 日志。
