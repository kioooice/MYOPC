export type PendingWrite = {
  path: string;
  body: Record<string, unknown>;
  requestId: string;
  label: string;
};

export const PENDING_WRITE_STORAGE_KEY = "myopc.pending-write.v1";

type PendingWriteStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function parsePendingWrite(value: string | null): PendingWrite | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<PendingWrite>;
    if (typeof parsed.path !== "string" || typeof parsed.requestId !== "string" || typeof parsed.label !== "string" || !parsed.body || typeof parsed.body !== "object" || Array.isArray(parsed.body)) return null;
    return parsed as PendingWrite;
  } catch {
    return null;
  }
}

export function samePendingWrite(left: PendingWrite, right: PendingWrite) {
  return left.requestId === right.requestId && left.path === right.path && stable(left.body) === stable(right.body);
}

export function assertPendingWriteCanSend(existing: PendingWrite | null, request: PendingWrite) {
  if (existing && !samePendingWrite(existing, request)) {
    throw new Error(`“${existing.label}”尚未确认，请先重试该请求`);
  }
}

export function loadPendingWrite(storage: PendingWriteStorage) {
  return parsePendingWrite(storage.getItem(PENDING_WRITE_STORAGE_KEY));
}

export function storePendingWrite(storage: PendingWriteStorage, request: PendingWrite) {
  storage.setItem(PENDING_WRITE_STORAGE_KEY, JSON.stringify(request));
}

export function clearPendingWrite(storage: PendingWriteStorage) {
  storage.removeItem(PENDING_WRITE_STORAGE_KEY);
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
