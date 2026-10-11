# 每日精选服务

独立的服务器研究与阅读入口，不接入 OPC 数据库。三个任务原指令存放在运行目录 `tasks.json`，不纳入 Git；日报、证据与去重历史存 SQLite。

运行：Python 3.10+，无第三方依赖。

```sh
BRIEFS_DATA_DIR=/opt/data/briefs python3 services/briefs/server.py serve --port 3031
BRIEFS_DATA_DIR=/opt/data/briefs python3 services/briefs/server.py run --all
```

每天北京时间 09:00 由 systemd timer 触发，串行运行三项任务。同任务同日期不会重复生成，手动重跑使用 `--force`。中断的运行在下次启动时标记失败，不当成完成。只提供公开网页搜索、读取和 GitHub 查询工具；模型无安装、发消息、作品生成或发布工具。

运行目录包含 `tasks.json`（原指令、标题和 slug）、`model.json`（base_url、model、api_key），权限 600。模型使用官方 DeepSeek `deepseek-flash`。服务内部监听回环地址，通过 OpenResty 3030 和既有 Basic Auth 对外访问。

研究能力：Bing 公开搜索 RSS、公开网页内容读取、GitHub API。搜索结果只作为线索，正文须实际读取后才能引用。动态平台、登录内容及外部视频无法保证访问/观看；明确标注限制，视频片段不会被宣称已观看。外部页面视为不可信资料，不作为执行指令。保存已读取来源和失败原因，前沿日报对不符合昨天/今晨日期的条目降级或剔除。

页面提供三种独立阅读入口、日期历史、正文目录、文字大小/夜间阅读、阅读位置和真实来源。运行失败不覆盖上一期成功内容。
