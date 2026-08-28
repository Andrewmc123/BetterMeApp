const TOKEN_KEY = "betterme.token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 401) {
    setToken(null);
    throw new ApiError("Your session expired. Sign in again.", 401);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { error?: string });
    throw new ApiError(body.error ?? `Request failed (${res.status})`, res.status);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T,>(path: string) => request<T>(path),
  post: <T,>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) }),
  patch: <T,>(path: string, body: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  del: (path: string) => request<void>(path, { method: "DELETE" }),
};

/** Opens the chat SSE stream and invokes callbacks as frames arrive. */
export async function streamChat(
  threadId: string,
  content: string,
  handlers: {
    onText: (text: string) => void;
    onThinking?: (text: string) => void;
    onTool?: (name: string, phase: "start" | "result") => void;
    onError?: (message: string) => void;
    onDone?: () => void;
  },
): Promise<void> {
  const res = await fetch(`/api/chat/threads/${threadId}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${getToken() ?? ""}` },
    body: JSON.stringify({ content }),
  });
  if (!res.ok || !res.body) {
    handlers.onError?.(`Chat failed (${res.status})`);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      let isError = false;
      for (const line of frame.split("\n")) {
        if (line.startsWith("event: error")) isError = true;
        if (!line.startsWith("data:")) continue;
        try {
          const payload = JSON.parse(line.slice(5).trim());
          if (isError) handlers.onError?.(payload.message ?? "Something went wrong");
          else if (payload.type === "text") handlers.onText(payload.text);
          else if (payload.type === "thinking") handlers.onThinking?.(payload.text);
          else if (payload.type === "tool_start") handlers.onTool?.(payload.name, "start");
          else if (payload.type === "tool_result") handlers.onTool?.(payload.name, "result");
          else if (payload.type === "done") handlers.onDone?.();
        } catch {
          /* ignore keep-alives */
        }
      }
    }
  }
  handlers.onDone?.();
}

export const money = (n: number | null | undefined): string =>
  n === null || n === undefined ? "—" : `$${n.toFixed(2)}`;

export const todayISO = (): string => new Date().toISOString().slice(0, 10);
