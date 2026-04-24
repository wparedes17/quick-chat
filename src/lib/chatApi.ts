export const API_BASE = "http://localhost:8080";

export type Location = "us" | "eu";

export interface ScoreRequest {
  id: string;
  question: string;
  location: Location;
  sessionid: string;
  userid: string;
}

export const randomId = () =>
  (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36));

export async function scoreOnce(body: ScoreRequest, signal?: AbortSignal): Promise<string> {
  const res = await fetch(`${API_BASE}/score`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    const data = await res.json();
    return typeof data === "string"
      ? data
      : data.answer ?? data.response ?? data.content ?? data.message ?? JSON.stringify(data);
  }
  return await res.text();
}

export async function scoreStream(
  body: ScoreRequest,
  onToken: (chunk: string) => void,
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

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE: events separated by blank line; lines beginning with "data:"
    const parts = buffer.split(/\r?\n\r?\n/);
    buffer = parts.pop() ?? "";
    for (const evt of parts) {
      for (const line of evt.split(/\r?\n/)) {
        const trimmed = line.trimStart();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        try {
          const parsed = JSON.parse(data);
          const token =
            typeof parsed === "string"
              ? parsed
              : parsed.token ?? parsed.content ?? parsed.delta ?? parsed.text ?? "";
          if (token) onToken(token);
        } catch {
          onToken(data);
        }
      }
    }
  }
}
