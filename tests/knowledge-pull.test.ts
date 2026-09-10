import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDbForTests } from "../lib/db";
import { pullKnowledgeRepository } from "../lib/knowledge/git";
import { getKnowledgeOverview, syncKnowledge } from "../lib/knowledge/service";

let work: string;
let dataDirectory: string;
let remote: string;
let clone: string;

function git(directory: string, args: string[]) {
  return execFileSync("git", ["-C", directory, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function commit(directory: string, message: string) {
  git(directory, ["add", "-A"]);
  git(directory, ["-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "-m", message]);
}

const entry = (id: string, title: string) => `---
id: ${id}
kind: note
title: ${title}
status: 进行中
summary: ${title} 的说明
updated: 2026-09-11
---

正文。
`;

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "myopc-pull-"));
  dataDirectory = join(work, "data");
  remote = join(work, "remote.git");
  clone = join(work, "clone");
  mkdirSync(dataDirectory, { recursive: true });
  execFileSync("git", ["init", "--bare", "--initial-branch=main", remote], { stdio: "ignore" });
  execFileSync("git", ["clone", remote, clone], { stdio: "ignore" });
  writeFileSync(join(clone, "README.md"), "# 知识仓库\n", "utf8");
  mkdirSync(join(clone, "notes"), { recursive: true });
  writeFileSync(join(clone, "notes", "first.md"), entry("first", "第一条"), "utf8");
  commit(clone, "first entry");
  git(clone, ["push", "-u", "origin", "main"]);
  process.env.MYOPC_DATA_DIR = dataDirectory;
  process.env.MYOPC_KNOWLEDGE_DIR = clone;
});

afterEach(() => {
  closeDbForTests();
  rmSync(work, { recursive: true, force: true });
  delete process.env.MYOPC_DATA_DIR;
  delete process.env.MYOPC_KNOWLEDGE_DIR;
});

describe("同步时拉取知识仓库", () => {
  it("并发贡献者推送新条目后，同步会快进到最新并索引新内容", () => {
    syncKnowledge();
    expect(getKnowledgeOverview().entries.map((item) => item.id)).toEqual(["first"]);

    // 模拟收集对话在另一处提交并推送
    const other = join(work, "other");
    execFileSync("git", ["clone", remote, other], { stdio: "ignore" });
    writeFileSync(join(other, "notes", "second.md"), entry("second", "第二条"), "utf8");
    commit(other, "second entry");
    git(other, ["push", "origin", "main"]);

    const result = syncKnowledge();
    expect(result.pull.performed).toBe(true);
    expect(result.pull.to).not.toBe(result.pull.from);
    expect(result.summary.added).toBe(1);
    expect(getKnowledgeOverview().entries.map((item) => item.id).sort()).toEqual(["first", "second"]);
  });

  it("没有新提交时不改动工作区，只报告已是最新", () => {
    syncKnowledge();
    const result = syncKnowledge();
    expect(result.pull.performed).toBe(true);
    expect(result.pull.message).toBe("内容已是最新");
    expect(result.summary.updated).toBe(0);
  });

  it("工作区有未提交改动时拒绝自动更新，但照常建立索引", () => {
    syncKnowledge();
    writeFileSync(join(clone, "notes", "draft.md"), entry("draft", "本地草稿"), "utf8");
    const result = syncKnowledge();
    expect(result.pull.performed).toBe(false);
    expect(result.pull.skipped).toBe("dirty_worktree");
    expect(result.summary.added).toBe(1);
  });

  it("不是 Git 目录时不影响索引", () => {
    const plain = join(work, "plain");
    mkdirSync(join(plain, "notes"), { recursive: true });
    writeFileSync(join(plain, "notes", "plain.md"), entry("plain", "普通目录"), "utf8");
    process.env.MYOPC_KNOWLEDGE_DIR = plain;
    const pull = pullKnowledgeRepository(plain);
    expect(pull.skipped).toBe("not_a_repository");
    const result = syncKnowledge();
    expect(result.summary.total).toBe(1);
  });
});
