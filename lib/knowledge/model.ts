import { KnowledgeError } from "./repo";

export type ModelConfig = { baseUrl: string; model: string; apiKey: string; timeoutMs: number; maxTokens: number };

export function getModelConfig(): ModelConfig | null {
  const apiKey = process.env.MYOPC_MODEL_API_KEY?.trim();
  if (!apiKey) return null;
  const baseUrl = (process.env.MYOPC_MODEL_BASE_URL?.trim() || "https://api.deepseek.com").replace(/\/+$/, "");
  const model = process.env.MYOPC_MODEL?.trim() || "deepseek-flash";
  const timeout = Number(process.env.MYOPC_MODEL_TIMEOUT_MS || 60000);
  const maxTokens = Number(process.env.MYOPC_MODEL_MAX_TOKENS || 8000);
  return { baseUrl, model, apiKey, timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : 60000, maxTokens: Number.isFinite(maxTokens) && maxTokens > 0 ? maxTokens : 8000 };
}

export function describeModelConfig(config: ModelConfig | null) {
  if (!config) return { configured: false as const, model: null, baseUrl: null };
  return { configured: true as const, model: config.model, baseUrl: config.baseUrl };
}

type ChatMessage = { role: "system" | "user"; content: string };

export async function callChatModel(config: ModelConfig, messages: ChatMessage[], maxTokens = config.maxTokens) {
  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({ model: config.model, messages, temperature: 0.2, max_tokens: maxTokens, stream: false }),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch (error) {
    const message = error instanceof Error && error.name === "TimeoutError" ? `模型请求超时（${config.timeoutMs}ms）` : error instanceof Error ? error.message : "模型请求失败";
    throw new KnowledgeError("model_request_failed", message);
  }
  const text = await response.text();
  if (!response.ok) throw new KnowledgeError("model_request_failed", `模型接口返回 ${response.status}：${text.slice(0, 300)}`);
  let payload: { choices?: Array<{ message?: { content?: string }; finish_reason?: string }>; usage?: { completion_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number } } };
  try { payload = JSON.parse(text) as typeof payload; }
  catch { throw new KnowledgeError("model_response_invalid", "模型返回不是有效 JSON"); }
  const choice = payload.choices?.[0];
  const content = choice?.message?.content?.trim();
  if (!content) {
    const reason = choice?.finish_reason ? `，结束原因 ${choice.finish_reason}` : "";
    const tokens = payload.usage?.completion_tokens !== undefined ? `，本次输出 ${payload.usage.completion_tokens} tokens（推理 ${payload.usage.completion_tokens_details?.reasoning_tokens ?? 0}）` : "";
    const code = choice?.finish_reason === "length" ? "model_response_truncated" : "model_response_empty";
    throw new KnowledgeError(code, `模型没有返回内容${reason}${tokens}`);
  }
  return { content, model: config.model };
}
