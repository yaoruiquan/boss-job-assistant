# 失败原因分类

本 skill 统一使用可审计的 `reason` 字段记录浏览器和业务结果。

## 浏览器/MCP 层

- `mcp_chrome_connect_failed`：MCP server 无法通过 `127.0.0.1:9335/json/version` 连接专用 Chrome。
- `target_closed`：MCP 目标页关闭、上下文失效或没有选中页面。
- `verify_required`：出现验证码、安全验证、滑块等人工关口。
- `login_required`：需要登录或重新登录。
- `resume_profile_required`：BOSS 要求完善简历。

## 岗位筛选层

- `matching_candidate_not_found`：当前 snapshot 没有符合规则的候选岗位。
- `detail_filter_not_confirmed`：详情页没有同时确认城市、岗位、类型、规模和融资条件。
- `chat_button_uid_not_found`：详情页无法高置信定位 `立即沟通/继续沟通`。

## 点击沟通后

- `communication_established`：聊天页出现 `/web/geek/chat` 且有 `[送达]`、`[已读]`、`您正在与Boss...沟通` 等强信号。
- `quota_or_rate_limit_suspected`：点击 `立即沟通` 后页面关闭或 target closed，没有聊天页强信号。通常按额度/频控疑似处理。
- `unknown_after_click`：点击后未出现强成功信号，也没有明确验证码、登录或 target closed。

## 默认处理

`quota_or_rate_limit_suspected` 和 `unknown_after_click` 都不能计为成功。默认停止本轮打招呼，不重复点击同一岗位，只允许继续只读筛选和记录。
