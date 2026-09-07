import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BusinessError, createCapture, createTrial, updateTrial } from "../lib/business";
import { closeDbForTests } from "../lib/db";

let directory: string;
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), "myopc-test-")); process.env.MYOPC_DATA_DIR = directory; });
afterEach(() => { closeDbForTests(); rmSync(directory, { recursive: true, force: true }); delete process.env.MYOPC_DATA_DIR; });

describe("S0 business invariants", () => {
  it("replays an identical request without duplication", () => {
    const payload = { title: "test", content: "text" };
    const first = createCapture(payload, "same-key");
    const replay = createCapture(payload, "same-key");
    expect(replay.body.id).toBe(first.body.id);
  });

  it("rejects using an idempotency key for a different payload", () => {
    createCapture({ title: "a", content: "one" }, "same-key");
    expect(() => createCapture({ title: "b", content: "two" }, "same-key")).toThrowError(BusinessError);
  });

  it("rejects a stale mutable update", () => {
    const trial = createTrial({ title: "trial", goal: "goal" }, "trial-key").body;
    updateTrial(String(trial.id), { expected_revision: 1, status: "review" }, "update-key");
    expect(() => updateTrial(String(trial.id), { expected_revision: 1, status: "done" }, "stale-key")).toThrowError(/重新读取/);
  });
});
