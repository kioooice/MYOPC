#!/bin/sh
# 服务器定时任务：拉取知识仓库，记录版本，让 OPC 重新索引并按需加工阅读说明。
# 安装：cp deploy/knowledge-sync.sh /usr/local/bin/opc-knowledge-sync && chmod 755 /usr/local/bin/opc-knowledge-sync
set -eu

REPO=/opt/data/knowledge/myopc
COMMIT_FILE=/opt/data/knowledge/commit.txt
APP=http://127.0.0.1:3011

git -C "$REPO" fetch --prune origin main
git -C "$REPO" reset --hard origin/main

# 容器内没有 git，用这个文件把来源版本传给同步接口；原地写入以保持挂载的文件 inode。
printf '%s\n%s\n' "$(git -C "$REPO" rev-parse HEAD)" "$(git -C "$REPO" rev-parse --abbrev-ref HEAD)" > "$COMMIT_FILE"

curl -fsS -m 120 -X POST "$APP/api/v1/knowledge/sync" -H 'content-type: application/json' -d '{}' > /dev/null
curl -fsS -m 900 -X POST "$APP/api/v1/knowledge/process" -H 'content-type: application/json' -d '{"limit":5}' > /dev/null

echo "knowledge sync ok: $(head -1 "$COMMIT_FILE")"
