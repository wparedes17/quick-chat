export const API_BASE = "http://localhost:8080";

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
    headers: { "Content-Type": "application/json" },
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
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
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

    if (typeof stage === "string" && stage.includes("answer")) {
      const message = parsed?.message;
      if (typeof message === "string" && message.length > 0) {
        try {
          const inner = JSON.parse(message);
          const chunk = inner?.chunk;
          if (typeof chunk === "string" && chunk.length > 0) {
            handlers.onChunk(chunk);
          }
        } catch {
          // message wasn't a JSON string — fall back to raw text
          handlers.onChunk(message);
        }
      }
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE: events separated by blank line; collect all "data:" lines per event.
    const parts = buffer.split(/\r?\n\r?\n/);
    buffer = parts.pop() ?? "";
    for (const evt of parts) {
      const dataLines: string[] = [];
      for (const line of evt.split(/\r?\n/)) {
        const trimmed = line.trimStart();
        if (trimmed.startsWith("data:")) dataLines.push(trimmed.slice(5).trim());
      }
      if (dataLines.length) handlePayload(dataLines.join("\n"));
    }
  }
}
