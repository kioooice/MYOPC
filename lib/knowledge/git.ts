import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

export type KnowledgePullResult = {
  performed: boolean;
  skipped: "not_a_repository" | "git_unavailable" | "dirty_worktree" | "pull_failed" | null;
  branch: string;
  from: string | null;
  to: string | null;
  message: string;
};

function git(directory: string, args: string[]) {
  return execFileSync("git", ["-C", directory, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 60000,
  }).trim();
}

export function getKnowledgeBranch() {
  return process.env.MYOPC_KNOWLEDGE_BRANCH?.trim() || "main";
}

// 同步按钮应该真的把知识仓库拉到最新，而不是只重读本地已有内容。
// 只做快进；工作区有改动或与远端分叉时不动它，只报告原因。
export function pullKnowledgeRepository(directory: string): KnowledgePullResult {
  const branch = getKnowledgeBranch();
  const base = { performed: false, branch, from: null, to: null };
  if (!existsSync(join(directory, ".git"))) {
    return { ...base, skipped: "not_a_repository", message: "知识目录不是 Git 检出，只重建索引" };
  }

  let from: string;
  try {
    from = git(directory, ["rev-parse", "HEAD"]);
  } catch {
    return { ...base, skipped: "git_unavailable", message: "环境里没有可用的 git，只重建索引" };
  }

  try {
    const dirty = git(directory, ["status", "--porcelain"]);
    if (dirty) {
      return { performed: false, skipped: "dirty_worktree", branch, from, to: from, message: "知识目录有未提交改动，未自动更新" };
    }
  } catch (error) {
    return { performed: false, skipped: "pull_failed", branch, from, to: from, message: `检查知识目录失败：${error instanceof Error ? error.message.split("\n")[0] : "未知原因"}` };
  }

  try {
    git(directory, ["fetch", "--prune", "origin", branch]);
    const remote = git(directory, ["rev-parse", `origin/${branch}`]);
    if (remote === from) return { performed: true, skipped: null, branch, from, to: from, message: "内容已是最新" };
    git(directory, ["merge", "--ff-only", `origin/${branch}`]);
    const to = git(directory, ["rev-parse", "HEAD"]);
    return { performed: true, skipped: null, branch, from, to, message: `知识仓库已更新到 ${to.slice(0, 8)}` };
  } catch (error) {
    const detail = error instanceof Error ? error.message.split("\n").filter(Boolean)[0] : "未知原因";
    return { performed: false, skipped: "pull_failed", branch, from, to: from, message: `拉取知识仓库失败：${detail}` };
  }
}
