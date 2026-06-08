# Chrome DevTools MCP 工具流

浏览器交互必须使用 Chrome DevTools MCP 暴露的工具，不用直接 CDP 脚本模拟点击。

## 强制顺序

1. `list_pages`
   - 确认选中的是 `https://www.zhipin.com/...` 页面。
   - 如果没有 BOSS 页面，先用 MCP `navigate_page` 打开。

2. `take_snapshot`
   - 读取可访问性树。
   - 从 snapshot 中找岗位卡片、详情区、`立即沟通` 按钮的 `uid`。
   - 不允许凭 DOM selector 或坐标臆测按钮。

3. 规则判定
   - 从 snapshot 文本整理岗位字段。
   - 调用 `scripts/evaluate_job.py`。
   - 只有 `action=chat_only` 才继续。

4. `click`
   - 使用 snapshot 中 `立即沟通` 的 `uid`。
   - 只点击一次。
   - 不用 CDP `Input.dispatchMouseEvent`，不用 DOM `.click()`。

5. 再次 `take_snapshot`
   - 判断是否成功。
   - 成功必须有强信号：`继续沟通`、`已沟通`、聊天输入区、或 `/web/geek/chat`。
   - 如果进入 `/web/geek/chat` 后已经出现 `[送达]`、`[已读]`、`您正在与Boss...沟通` 等信号，说明点击沟通可能已经触发 BOSS 常用语/默认打招呼；默认立即停止，不再额外输入并发送第二条。
   - 失败信号：跳首页、仍显示 `立即沟通`、出现验证码/安全验证、无聊天输入区。

6. `take_screenshot`
   - 保存成功或失败证据。

## 成功判定

只能把以下情况记为成功：

- 按钮状态变成 `继续沟通` 或 `已沟通`。
- 页面跳转到 `/web/geek/chat`。
- snapshot 中出现聊天输入区或发送消息区域。
- snapshot 中出现 `沟通过`、`刚刚沟通` 等明确状态。
- 聊天页中出现 `[送达]`、`[已读]` 或 `您正在与Boss...沟通`，且本轮刚点击过 `立即沟通/继续沟通`。

不能把以下情况记为成功：

- 顶部导航里有 `消息`。
- 点击返回首页、推荐页、搜索页。
- 当前详情仍显示 `立即沟通`。
- 只是按钮 click 调用返回成功。
- MCP `click` 返回成功，但后续 snapshot 显示跳转到 BOSS 首页。
- 已出现送达/已读信号后，又额外发送第二条重复打招呼。

## 人工关口

遇到以下内容立即停止：

- `登录/注册`
- `验证码`
- `安全验证`
- `滑块`
- `账号异常`
- `请完善简历`
- `上传附件简历`

## 当前 Codex 会话限制

如果当前会话的工具列表没有暴露 `boss-chrome` 或 `chrome-devtools` MCP 工具，则不能声称已完成 MCP click/snapshot 验证。此时只能：

1. 检查 `.mcp.json` 和 Chrome 调试端口。
2. 提示需要在加载了该 MCP server 的会话中运行。
3. 不得用直接 CDP 点击结果代替 MCP 工具验证。
