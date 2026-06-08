# 筛选条件设计

本 skill 的筛选条件分三层：硬过滤、排序加权、动作决策。

## 硬过滤字段

这些字段用于决定 `chat_only`、`review`、`skip`。

### 城市

字段：`city`

常见值：

- `北京`
- `上海`
- `深圳`
- `杭州`
- `广州`
- `成都`
- `南京`
- `武汉`
- `西安`
- `远程`

规则键：

- `cities_any`
- `cities_none`

### 岗位名

字段：`title`

正向关键词示例：

- 安全
- 网络安全
- 渗透
- 应急
- 漏洞
- 安全服务
- 安全运营
- 安全工程师
- 数据安全
- AI 安全
- Python
- 后端
- 自动化
- 实习

排除关键词示例：

- 销售
- 电话销售
- 客服
- 主播
- 带货
- 地推
- 招聘专员
- 外包驻场
- 课程顾问

规则键：

- `title_any`
- `title_none`

### 公司规模

字段：`company_size`

常见值：

- `0-20人`
- `20-99人`
- `100-499人`
- `500-999人`
- `1000-9999人`
- `10000人以上`

规则键：

- `company_sizes_any`
- `company_sizes_none`

### 工作类型

字段：`employment_type`

常见值：

- `实习`
- `兼职`
- `全职`
- `校招`
- `社招`

规则键：

- `employment_types_any`
- `employment_types_none`

### 融资阶段

字段：`financing_stage`

常见值：

- `未融资`
- `天使轮`
- `A轮`
- `B轮`
- `C轮`
- `D轮及以上`
- `已上市`
- `不需要融资`

规则键：

- `financing_stages_any`
- `financing_stages_none`

## 建议补充字段

这些字段不是第一版必需，但浏览器能读到时应记录。

- `salary`：薪资或日薪，用于排除过低薪资。
- `experience`：经验要求，用于排除 3-5 年以上岗位。
- `education`：学历要求。
- `work_days`：实习每周天数，如 `4天/周`、`5天/周`。
- `duration`：实习时长，如 `3个月`、`6个月`。
- `boss_active`：Boss 活跃状态。
- `company_name`：公司名，用于黑名单和去重。
- `industry`：行业，如 `信息安全`、`互联网`、`人工智能`。
- `job_url`：岗位 URL，用于去重。

## 动作决策

默认动作：

- 高置信符合：`chat_only`
- 信息缺失但可能合适：`review`
- 明确不合适：`skip`

第一版不自动发简历。简历发送只在对方回复后进入回复处理流程。

## 示例规则

```json
{
  "name": "深圳安全实习优先",
  "action": "chat_only",
  "priority": 100,
  "match": {
    "cities_any": ["深圳"],
    "title_any": ["安全", "网络安全", "渗透", "应急", "漏洞", "数据安全", "AI安全"],
    "employment_types_any": ["实习"],
    "company_sizes_any": ["100-499人", "500-999人", "1000-9999人", "10000人以上"],
    "financing_stages_any": ["A轮", "B轮", "C轮", "D轮及以上", "已上市", "不需要融资"]
  },
  "exclude": {
    "title_any": ["销售", "客服", "主播", "带货", "招聘专员", "课程顾问"],
    "company_name_any": ["外包", "人力资源"]
  }
}
```

## 缺字段处理

浏览器抽取不到公司规模、融资阶段时，不要把岗位判为高置信 `chat_only`。第一版应进入 `review`，除非用户明确允许缺字段也自动打招呼。
