// 手动或定时同步知识仓库：先更新索引，再按需加工尚未生成阅读说明的条目。
// 用法：npx tsx scripts/knowledge-sync.ts [--no-process] [--force-entry <id>] [--limit 3]
import { getKnowledgeOverview, processKnowledgeNotes, syncKnowledge } from "../lib/knowledge/service";
import { generateKnowledgeNote } from "../lib/knowledge/service";

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] ?? null;
}

async function main() {
  const sync = syncKnowledge();
  console.log(JSON.stringify({
    sync: { status: sync.state.status, commit: sync.state.commit, branch: sync.state.branch, entries: sync.state.entryCount },
    summary: sync.summary,
    problems: sync.problems,
  }, null, 2));

  const entryId = argument("--force-entry");
  if (entryId) {
    const result = await generateKnowledgeNote(entryId, { force: true });
    console.log(JSON.stringify({ entry: result.entryId, status: result.status, model: result.model, reason: result.reason }, null, 2));
  }

  if (!process.argv.includes("--no-process")) {
    const limit = Number(argument("--limit") || 3);
    const processed = await processKnowledgeNotes(Number.isFinite(limit) && limit > 0 ? limit : 3);
    console.log(JSON.stringify({
      processed: processed.processed,
      remaining: processed.remaining,
      results: processed.results.map((item) => ({ entry: item.entryId, status: item.status, reason: item.reason })),
    }, null, 2));
  }

  const overview = getKnowledgeOverview();
  console.log(JSON.stringify({ pendingNotes: overview.pendingNotes, model: overview.model }, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
