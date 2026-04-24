export const API_BASE = "http://localhost:8080";
export const EVALUATE_BASE = "http://localhost:8081";

export interface EvaluateRequest {
  question: string;
  answer: string;
  criteria: string;
}

export interface EvaluateResult {
  score: number;
  reason: string;
}

export async function evaluate(body: EvaluateRequest): Promise<EvaluateResult> {
  const res = await fetch(`${EVALUATE_BASE}/evaluate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept-Language": "en" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Evaluation failed: ${res.status}`);
  const data = await res.json();
  return {
    score: typeof data?.score === "number" ? data.score : 0,
    reason: typeof data?.reason === "string" ? data.reason : "",
  };
}

export type Location = "us" | "eu";

export interface ScoreRequest {
  id: string;
  question: string;
  location: Location;
  sessionid: string;
  userid: string;
}

export interface ScoreResult {
  answer: string;
  intents: string[];
}

export const randomId = () =>
  (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36));

const parseIntents = (intent: unknown): string[] => {
  if (!intent || typeof intent !== "string") return [];
  return intent
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
};

export async function scoreOnce(body: ScoreRequest, signal?: AbortSignal): Promise<ScoreResult> {
  const res = await fetch(`${API_BASE}/score`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept-Language": "en" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  const data = await res.json();
  return {
    answer: typeof data?.answer === "string" ? data.answer : "",
    intents: parseIntents(data?.intent),
  };
}

export interface StreamHandlers {
  onChunk: (text: string) => void;
  onIntents?: (intents: string[]) => void;
  onStage?: (stage: string) => void;
}

export async function scoreStream(
  body: ScoreRequest,
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${API_BASE}/score/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/x-ndjson", "Accept-Language": "en" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`Stream failed: ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const handlePayload = (raw: string) => {
    const text = raw.trim();
    if (!text || text === "[DONE]") return;
    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch {
      return;
    }

    const stage: string | undefined = parsed?.stage;
    if (stage) handlers.onStage?.(stage);

    // Intents may arrive on any stage — surface them when present.
    if (parsed?.intent) {
      handlers.onIntents?.(parseIntents(parsed.intent));
    }

    if (stage === "answer" && parsed?.state === "streaming") {
      const message = parsed?.message;
      if (typeof message === "string" && message.length > 0) {
        try {
          const inner = JSON.parse(message);
          const chunk = inner?.chunk;
          if (typeof chunk === "string" && chunk.length > 0) {
            handlers.onChunk(chunk);
          }
        } catch {
          return;
        }
      }
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // NDJSON: one JSON object per line
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) handlePayload(line);
    }
  }
}
