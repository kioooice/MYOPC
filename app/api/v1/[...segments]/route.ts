import { NextRequest, NextResponse } from "next/server";
import { acceptVersion, BusinessError, createCapture, createDecision, createDeliverable, createDraft, createFeedback, createMethod, createProject, createProjectLocation, createTrial, createVersion, getAssets, getCapture, getCaptureFile, getCaptures, getContext, getDashboard, getEvents, getMethod, getMethods, getProject, getProjects, getLibrary, startTrial, updateCapture, updateProject, updateTrial } from "@/lib/business";
import { KnowledgeError } from "@/lib/knowledge/repo";
import { bootstrapAgent, generateKnowledgeNote, getKnowledgeDetail, getKnowledgeOverview, getKnowledgeReuseOverview, getProgressRecord, processKnowledgeNotes, queryAgentContext, resolveCandidate, submitAgentResult, syncKnowledge } from "@/lib/knowledge/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ segments: string[] }> };

function errorResponse(error: unknown) {
  if (error instanceof BusinessError) return NextResponse.json({ error: error.code, message: error.message, details: error.details }, { status: error.status });
  if (error instanceof KnowledgeError) {
    const notFound = ["knowledge_entry_not_found", "candidate_not_found", "progress_record_not_found"];
    const badRequest = ["knowledge_directory_missing", "task_required", "candidate_id_required", "candidate_status_invalid", "candidate_note_required"];
    const status = notFound.includes(error.code) ? 404 : badRequest.includes(error.code) ? 400 : 502;
    return NextResponse.json({ error: error.code, message: error.message }, { status });
  }
  console.error(error);
  return NextResponse.json({ error: "internal_error", message: "服务暂时不可用" }, { status: 500 });
}

function respond(operation: () => { status: number; body: Record<string, unknown> }) {
  try {
    const result = operation();
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    return errorResponse(error);
  }
}

async function readBody(request: NextRequest) {
  try { return await request.json() as Record<string, unknown>; }
  catch { return {} as Record<string, unknown>; }
}

export async function GET(request: NextRequest, context: Context) {
  const { segments } = await context.params;
  try {
    if (segments[0] === "health") return NextResponse.json({ status: "ok", persistence: "sqlite", release: process.env.MYOPC_RELEASE || "unknown" });
    if (segments[0] === "dashboard") return NextResponse.json(getDashboard());
    if (segments[0] === "library") return NextResponse.json(getLibrary(request.nextUrl.searchParams.get("q") || ""));
    if (segments[0] === "assets") return NextResponse.json(getAssets(request.nextUrl.searchParams.get("q") || ""));
    if (segments[0] === "knowledge" && segments[1] === "entries" && segments[2]) {
      const detail = getKnowledgeDetail(segments[2]);
      if (!detail) return NextResponse.json({ error: "not_found", message: "知识条目不存在" }, { status: 404 });
      return NextResponse.json(detail);
    }
    if (segments[0] === "knowledge" && segments[1] === "reuse") return NextResponse.json(getKnowledgeReuseOverview());
    if (segments[0] === "agent" && segments[1] === "events" && segments[2]) {
      const record = getProgressRecord(segments[2]);
      if (!record) return NextResponse.json({ error: "progress_record_not_found", message: "进展记录不存在" }, { status: 404 });
      return NextResponse.json(record);
    }
    if (segments[0] === "knowledge") {
      return NextResponse.json(getKnowledgeOverview({
        kind: request.nextUrl.searchParams.get("kind") || undefined,
        query: request.nextUrl.searchParams.get("q") || undefined,
      }));
    }
    if (segments[0] === "captures" && segments[1] && segments[2] === "file") {
      const file = getCaptureFile(segments[1]);
      return new NextResponse(new Uint8Array(file.content), { headers: { "content-type": file.mimeType, "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.fileName)}` } });
    }
    if (segments[0] === "captures" && segments[1]) return NextResponse.json(getCapture(segments[1]));
    if (segments[0] === "captures") return NextResponse.json(getCaptures(request.nextUrl.searchParams.get("q") || "", request.nextUrl.searchParams.get("read_status") || ""));
    if (segments[0] === "methods" && segments[1]) return NextResponse.json(getMethod(segments[1]));
    if (segments[0] === "methods") return NextResponse.json(getMethods(request.nextUrl.searchParams.get("q") || ""));
    if (segments[0] === "projects" && segments[1]) return NextResponse.json(getProject(segments[1]));
    if (segments[0] === "projects") return NextResponse.json(getProjects());
    if (segments[0] === "context") return NextResponse.json(getContext(request.nextUrl.searchParams.get("trial_id") || ""));
    if (segments[0] === "events") return NextResponse.json(getEvents(Number(request.nextUrl.searchParams.get("after") || 0)));
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest, context: Context) {
  const { segments } = await context.params;
  const body = await readBody(request);
  const requestId = request.headers.get("x-client-request-id") || undefined;
  const key = segments.join("/");
  try {
    if (key === "knowledge/sync") {
      const result = syncKnowledge();
      return NextResponse.json({ sync: result.state, summary: result.summary, problems: result.problems, pull: result.pull, pendingNotes: getKnowledgeOverview().pendingNotes }, { status: 200 });
    }
    if (key === "knowledge/notes") {
      const entryId = typeof body.entry_id === "string" ? body.entry_id.trim() : "";
      if (!entryId) throw new BusinessError(400, "entry_id_required", "缺少 entry_id");
      const result = await generateKnowledgeNote(entryId, { force: body.force === true });
      return NextResponse.json(result, { status: 200 });
    }
    if (key === "knowledge/process") {
      const limit = Number(body.limit);
      const result = await processKnowledgeNotes(Number.isFinite(limit) && limit > 0 ? limit : 3);
      return NextResponse.json(result, { status: 200 });
    }
    if (key === "agent/context") {
      const result = await queryAgentContext(body);
      return NextResponse.json(result, { status: 200 });
    }
    if (key === "agent/result") {
      const result = await submitAgentResult(body);
      return NextResponse.json(result, { status: 200 });
    }
    if (key === "agent/bootstrap") {
      const result = bootstrapAgent(body);
      return NextResponse.json(result, { status: 200 });
    }
    if (segments[0] === "knowledge" && segments[1] === "candidates" && segments[2] && segments[3] === "resolve") {
      const result = resolveCandidate({ ...body, candidate_id: body.candidate_id ?? segments[2] });
      return NextResponse.json(result, { status: 200 });
    }
  } catch (error) {
    return errorResponse(error);
  }
  return respond(() => {
    if (key === "captures") return createCapture(body, requestId);
    if (key === "starts") return startTrial(body, requestId);
    if (key === "methods") return createMethod(body, requestId);
    if (key === "projects") return createProject(body, requestId);
    if (segments[0] === "projects" && segments[1] && segments[2] === "locations") return createProjectLocation(segments[1], body, requestId);
    if (key === "trials") return createTrial(body, requestId);
    if (key === "deliverables") return createDeliverable(body, requestId);
    if (key === "drafts") return createDraft(body, requestId);
    if (key === "feedback") return createFeedback(body, requestId);
    if (key === "decisions") return createDecision(body, requestId);
    if (segments[0] === "deliverables" && segments[2] === "versions") return createVersion(segments[1], body, requestId);
    if (segments[0] === "deliverables" && segments[2] === "accept") return acceptVersion(segments[1], body, requestId);
    throw new BusinessError(404, "not_found", "接口不存在");
  });
}

export async function PATCH(request: NextRequest, context: Context) {
  const { segments } = await context.params;
  const body = await readBody(request);
  const requestId = request.headers.get("x-client-request-id") || undefined;
  return respond(() => {
    if (segments[0] === "captures" && segments[1]) return updateCapture(segments[1], body, requestId);
    if (segments[0] === "projects" && segments[1]) return updateProject(segments[1], body, requestId);
    if (segments[0] === "trials" && segments[1]) return updateTrial(segments[1], body, requestId);
    throw new BusinessError(404, "not_found", "接口不存在");
  });
}
