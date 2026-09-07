import { NextRequest, NextResponse } from "next/server";
import { acceptVersion, BusinessError, createCapture, createDecision, createDeliverable, createDraft, createFeedback, createMethod, createProject, createTrial, createVersion, getContext, getDashboard, getEvents, getProjects, startTrial, updateTrial } from "@/lib/business";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ segments: string[] }> };

function respond(operation: () => { status: number; body: Record<string, unknown> }) {
  try {
    const result = operation();
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    if (error instanceof BusinessError) return NextResponse.json({ error: error.code, message: error.message, details: error.details }, { status: error.status });
    console.error(error);
    return NextResponse.json({ error: "internal_error", message: "服务暂时不可用" }, { status: 500 });
  }
}

export async function GET(request: NextRequest, context: Context) {
  const { segments } = await context.params;
  try {
    if (segments[0] === "health") return NextResponse.json({ status: "ok", persistence: "sqlite" });
    if (segments[0] === "dashboard") return NextResponse.json(getDashboard());
    if (segments[0] === "projects") return NextResponse.json(getProjects());
    if (segments[0] === "context") return NextResponse.json(getContext(request.nextUrl.searchParams.get("trial_id") || ""));
    if (segments[0] === "events") return NextResponse.json(getEvents(Number(request.nextUrl.searchParams.get("after") || 0)));
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  } catch (error) {
    if (error instanceof BusinessError) return NextResponse.json({ error: error.code, message: error.message }, { status: error.status });
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest, context: Context) {
  const { segments } = await context.params;
  const body = await request.json() as Record<string, unknown>;
  const requestId = request.headers.get("x-client-request-id") || undefined;
  const key = segments.join("/");
  return respond(() => {
    if (key === "captures") return createCapture(body, requestId);
    if (key === "starts") return startTrial(body, requestId);
    if (key === "methods") return createMethod(body, requestId);
    if (key === "projects") return createProject(body, requestId);
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
  const body = await request.json() as Record<string, unknown>;
  const requestId = request.headers.get("x-client-request-id") || undefined;
  return respond(() => {
    if (segments[0] === "trials" && segments[1]) return updateTrial(segments[1], body, requestId);
    throw new BusinessError(404, "not_found", "接口不存在");
  });
}
