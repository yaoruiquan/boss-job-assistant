# 执行流程

## 阶段 1：环境检查

1. 启动 Chrome：

```bash
./scripts/start-chrome-debug.sh isolated
```

2. 检查端口：

```bash
curl -sS http://127.0.0.1:9335/json/version
```

3. 在浏览器中人工登录 BOSS。

## 阶段 2：规则配置

1. 把用户自然语言规则转成 JSON。
2. 用 2-3 个样例岗位运行 `scripts/evaluate_job.py`。
3. 和用户确认 `chat_only/review/skip` 是否符合预期。

## 阶段 3：岗位筛选

浏览器阶段只读取当前页面可见卡片，不做高速翻页。

每个岗位抽取字段：

- title
- city
- company_name
- company_size
- employment_type
- financing_stage
- salary
- boss_active
- job_url

然后调用规则判定：

```bash
python3 scripts/evaluate_job.py rules.json job.json
```

## 阶段 4：打招呼

只有 `action=chat_only` 才允许打招呼。

打招呼必须使用 `references/mcp-tool-flow.md` 中的 MCP 工具流。禁止用直接 CDP 脚本、DOM `.click()` 或坐标鼠标事件替代 MCP `click`。

发送前检查：

- 是否超过每日上限。
- 岗位或公司是否已处理。
- 当前页面是否仍是同一岗位。
- 输入框和发送按钮是否高置信定位。
- 是否有登录、验证码、安全验证、异常弹窗。

发送后记录：

- 时间。
- 岗位字段。
- 使用的规则。
- 发送文案。
- 页面 URL。
- 截图路径或 DOM 摘要。

成功判定必须使用强信号：

- 详情页按钮从 `立即沟通` 变为 `继续沟通` 或 `已沟通`。
- 页面跳转到 `/web/geek/chat`。
- 出现可见聊天输入区或发送消息区域。
- 页面文字出现 `沟通过`、`刚刚沟通` 等状态。
- 聊天页出现 `[送达]`、`[已读]` 或 `您正在与Boss...沟通`，说明沟通已经建立；默认不再追加发送第二条打招呼。

以下情况不能算成功：

- 页面仅有顶部导航 `消息`。
- 点击后跳回首页、推荐页或搜索页。
- 详情页仍显示 `立即沟通`。
- 没有可见聊天输入区，也没有 `继续沟通/已沟通` 状态。
- 已经出现送达/已读/正在沟通信号后，继续发送重复问候。

单条 smoke test 使用：

1. MCP `list_pages`
2. MCP `take_snapshot`
3. MCP `click` 点击 snapshot 中对应岗位卡片/岗位标题的 `uid`
4. MCP `take_snapshot` 确认进入同一岗位详情
5. MCP `click` 点击岗位详情中的 `立即沟通` 的 `uid`
6. MCP `take_snapshot` 确认进入聊天/沟通状态
7. 如果 snapshot 已出现 `[送达]`、`[已读]` 或 `您正在与Boss...沟通`，记录成功并停止，避免重复发送
8. 只有未出现已发送信号且高置信定位到聊天输入框时，才 MCP `fill` / `type_text` 输入打招呼文案，或 MCP `click` 选择常用语
9. MCP `click` 点击发送按钮
10. MCP `take_snapshot`
11. MCP `take_screenshot`

当前本地可用脚本：

```bash
node scripts/mcp_greet_once.js
node scripts/mcp_full_greet_flow.js
node scripts/mcp_snapshot_status.js
```

如果 MCP `click` 返回 `Successfully clicked on the element`，但后续 snapshot 显示跳转到 `https://www.zhipin.com/shenzhen/` 或其他首页/推荐页，判定为 `clicked_but_not_greeted`，不要继续重复点击。

## 阶段 5：回复处理

只处理已回复会话。

1. 读取对方最近回复。
2. 如果是问题，按后续配置的话术模块生成答复。
3. 答复后询问“是否方便发简历”。
4. 只有对方回复命中 `resume_send_policy.require_keywords` 时，进入发简历。
5. MVP 默认发简历前必须人工确认。

## 阶段 6：降级策略

如果页面结构变化或定位失败：

1. 停止自动点击。
2. 输出候选岗位列表和建议动作。
3. 提供截图。
4. 等待用户人工接管或更新选择器。
