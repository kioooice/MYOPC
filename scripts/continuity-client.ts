import { readFileSync } from "node:fs";

type Json = Record<string, unknown>;

const base = process.env.MYOPC_BASE_URL || "http://127.0.0.1:3000";
const authHeaders: Record<string, string> = process.env.MYOPC_USERNAME && process.env.MYOPC_PASSWORD
  ? { authorization: `Basic ${Buffer.from(`${process.env.MYOPC_USERNAME}:${process.env.MYOPC_PASSWORD}`).toString("base64")}` }
  : {};

function option(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function options(name: string) {
  return process.argv.flatMap((value, index) => value === name && process.argv[index + 1] ? [process.argv[index + 1]] : []);
}

function required(name: string) {
  const value = option(name);
  if (!value) throw new Error(`缺少参数 ${name}`);
  return value;
}

function requestId(operation: string) {
  return process.env.MYOPC_REQUEST_ID || option("--request-id") || `${operation}-${crypto.randomUUID()}`;
}

function contentOption() {
  const file = option("--content-file");
  if (file) return readFileSync(file, "utf8");
  return required("--content");
}

async function request(path: string, method = "GET", body?: Json, id?: string) {
  const headers: Record<string, string> = { ...authHeaders };
  if (body) {
    headers["content-type"] = "application/json";
    headers["x-client-request-id"] = id || requestId(method.toLowerCase());
  }
  const response = await fetch(`${base}/api/v1${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json() as Json;
  if (!response.ok) throw new Error(`${response.status} ${JSON.stringify(data)}`);
  return data;
}

async function main() {
  const command = process.argv[2];
  if (command === "context") {
    const context = await request(`/context?trial_id=${encodeURIComponent(required("--trial-id"))}`);
    console.log(JSON.stringify({ operation: "context", ...context }, null, 2));
    return;
  }
  if (command === "start") {
    const id = requestId("start");
    const result = await request("/starts", "POST", {
      kind: option("--kind") || "need",
      title: required("--title"),
      content: required("--goal"),
      project_id: option("--project-id"),
      environment: option("--environment"),
      code_repository: option("--code-repository"),
      code_branch: option("--code-branch"),
      code_commit: option("--code-commit"),
      next_step: option("--next-step"),
    }, id);
    console.log(JSON.stringify({ operation: "start", request_id: id, ...result }, null, 2));
    return;
  }
  if (command === "draft") {
    const id = requestId("draft");
    const result = await request("/drafts", "POST", { trial_id: required("--trial-id"), title: required("--title"), content: contentOption(), type: option("--type") || "article" }, id);
    console.log(JSON.stringify({ operation: "draft", request_id: id, ...result }, null, 2));
    return;
  }
  if (command === "feedback") {
    const id = requestId("feedback");
    const result = await request("/feedback", "POST", { version_id: required("--version-id"), content: contentOption(), kind: option("--kind") || "revision", source: option("--source") || "user" }, id);
    console.log(JSON.stringify({ operation: "feedback", request_id: id, ...result }, null, 2));
    return;
  }
  if (command === "revise") {
    const id = requestId("revise");
    const result = await request(`/deliverables/${required("--deliverable-id")}/versions`, "POST", { content: contentOption(), handles_feedback_ids: options("--feedback-id") }, id);
    console.log(JSON.stringify({ operation: "revise", request_id: id, ...result }, null, 2));
    return;
  }
  if (command === "decision") {
    const id = requestId("decision");
    const result = await request("/decisions", "POST", { trial_id: required("--trial-id"), basis_feedback_id: option("--feedback-id"), rationale: required("--rationale"), adjustment: required("--adjustment"), next_step: required("--next-step"), execution_status: option("--status") || "proposed" }, id);
    console.log(JSON.stringify({ operation: "decision", request_id: id, ...result }, null, 2));
    return;
  }
  throw new Error("用法：context|start|draft|feedback|revise|decision；写入操作支持 --request-id 以安全重试，内容支持 --content 或 --content-file");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
