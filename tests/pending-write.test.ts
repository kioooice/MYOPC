import { describe, expect, it } from "vitest";
import { assertPendingWriteCanSend, clearPendingWrite, loadPendingWrite, parsePendingWrite, samePendingWrite, storePendingWrite, type PendingWrite } from "../lib/pending-write";

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

const request: PendingWrite = {
  path: "/api/v1/drafts",
  body: { title: "待确认成果", nested: { second: 2, first: 1 } },
  requestId: "write-request-1",
  label: "成果保存",
};

describe("pending web writes", () => {
  it("rejects invalid persisted values", () => {
    expect(parsePendingWrite(null)).toBeNull();
    expect(parsePendingWrite("not-json")).toBeNull();
    expect(parsePendingWrite(JSON.stringify({ path: "/api/v1/drafts" }))).toBeNull();
  });

  it("keeps an unconfirmed request across reads and reloads until explicitly cleared", () => {
    const storage = new MemoryStorage();
    storePendingWrite(storage, request);

    // A successful state read does not acknowledge the earlier write response.
    const restoredAfterRead = loadPendingWrite(storage);
    expect(restoredAfterRead).toEqual(request);
    expect(samePendingWrite(restoredAfterRead!, { ...request, body: { nested: { first: 1, second: 2 }, title: "待确认成果" } })).toBe(true);
    expect(() => assertPendingWriteCanSend(restoredAfterRead, { ...request, requestId: "write-request-2" })).toThrowError(/请先重试该请求/);

    clearPendingWrite(storage);
    expect(loadPendingWrite(storage)).toBeNull();
  });
});
