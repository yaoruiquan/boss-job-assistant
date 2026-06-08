# 规则格式

规则文件使用 JSON，避免额外依赖。

## 顶层字段

```json
{
  "limits": {
    "daily_chat_limit": 20,
    "session_job_limit": 10
  },
  "default_action": "review",
  "greeting_template": "您好，我对这个岗位比较感兴趣，我的背景和岗位方向比较匹配，想进一步了解一下。",
  "resume_send_policy": {
    "require_reply": true,
    "require_keywords": ["发我看看", "简历", "方便", "可以发"],
    "require_manual_confirm": true
  },
  "rules": []
}
```

## action

- `chat_only`：只打招呼，不发简历。
- `review`：加入待确认列表。
- `skip`：跳过并记录原因。

## 单条规则

```json
{
  "name": "北京安全实习",
  "action": "chat_only",
  "priority": 100,
  "match": {
    "cities_any": ["北京"],
    "title_any": ["安全", "渗透", "应急", "漏洞"],
    "employment_types_any": ["实习"],
    "company_sizes_any": ["100-499人", "500-999人", "1000-9999人"],
    "financing_stages_any": ["B轮", "C轮", "D轮及以上", "已上市"]
  },
  "exclude": {
    "title_any": ["销售", "客服"],
    "company_name_any": ["外包"]
  }
}
```

## 岗位输入格式

浏览器阶段抽取当前可见岗位后，整理为：

```json
{
  "title": "安全实习生",
  "city": "北京",
  "company_name": "某科技公司",
  "company_size": "500-999人",
  "employment_type": "实习",
  "financing_stage": "C轮",
  "salary": "200-300/天",
  "boss_active": "刚刚活跃"
}
```

## 匹配语义

- `*_any`：字段包含列表中任意一个字符串即命中。
- `*_none`：字段不能包含列表中任何字符串；命中则该规则不通过。
- `exclude` 先于 `match` 生效。
- 多个 `match` 字段之间是 AND。
- 规则按 `priority` 从大到小执行。
- 没有命中规则时返回 `default_action`。

更多字段和建议关键词见 `references/filter-conditions.md`。
