import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { api, streamChat } from "../api";
import { Markdown } from "../components/Markdown";

interface Message {
  id: string;
  role: string;
  content: string;
}
interface Thread {
  id: string;
  title: string;
  updatedAt: string;
}

const SUGGESTIONS = [
  "Where is most of my money going this week?",
  "Why am I broke right now?",
  "What should I cut to save $200 a month?",
  "Plan my dinners for the rest of the week under $12 each",
  "Am I on track against my budget?",
];

/** Live streaming chat with the coach — the same model, with tools over your data. */
export function Coach() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streamingText, setStreamingText] = useState("");
  const [thinking, setThinking] = useState("");
  const [tools, setTools] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void (async () => {
      const { threads } = await api.get<{ threads: Thread[] }>("/chat/threads");
      setThreads(threads);
      if (threads[0]) void openThread(threads[0].id);
      else await newThread();
    })();
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, streamingText, thinking]);

  async function newThread() {
    const { thread } = await api.post<{ thread: Thread }>("/chat/threads", {});
    setThreads((t) => [thread, ...t]);
    setThreadId(thread.id);
    setMessages([]);
  }

  async function openThread(id: string) {
    const { thread } = await api.get<{ thread: Thread & { messages: Message[] } }>(`/chat/threads/${id}`);
    setThreadId(thread.id);
    setMessages(thread.messages);
    setStreamingText("");
    setThinking("");
  }

  async function send(text?: string) {
    const content = (text ?? input).trim();
    if (!content || !threadId || busy) return;

    setInput("");
    setError(null);
    setBusy(true);
    setStreamingText("");
    setThinking("");
    setTools([]);
    setMessages((m) => [...m, { id: `local-${Date.now()}`, role: "user", content }]);

    let assembled = "";
    await streamChat(threadId, content, {
      onText: (t) => {
        assembled += t;
        setStreamingText(assembled);
      },
      onThinking: (t) => setThinking((prev) => prev + t),
      onTool: (name, phase) => {
        if (phase === "start") setTools((prev) => (prev.includes(name) ? prev : [...prev, name]));
      },
      onError: (message) => setError(message),
      onDone: () => undefined,
    });

    if (assembled.trim()) {
      setMessages((m) => [...m, { id: `local-a-${Date.now()}`, role: "assistant", content: assembled }]);
    }
    setStreamingText("");
    setThinking("");
    setBusy(false);
    api.get<{ threads: Thread[] }>("/chat/threads").then((r) => setThreads(r.threads)).catch(() => undefined);
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <div className="chat">
      <div className="taskbar">
        <span className="pill">Coach</span>
        <select
          style={{ width: 260 }}
          value={threadId ?? ""}
          onChange={(e) => void openThread(e.target.value)}
        >
          {threads.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
        </select>
        <button className="small ghost" onClick={() => void newThread()}>
          New chat
        </button>
        <span className="spacer" />
        {busy && <span className="muted small">working…</span>}
      </div>

      <div className="chat-scroll" ref={scrollRef}>
        {messages.length === 0 && !streamingText && (
          <div style={{ maxWidth: 760 }}>
            <h2>Ask me anything about your money or your week</h2>
            <p className="muted">
              I can pull your real numbers — spending by category, merchant patterns, budget status,
              time logs, savings projections — before I answer.
            </p>
            <div className="row">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="ghost small" onClick={() => void send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => (
          <div key={m.id} className={`msg ${m.role}`}>
            <div className="who">{m.role === "user" ? "You" : "Coach"}</div>
            <div className="body">{m.role === "user" ? m.content : <Markdown text={m.content} />}</div>
          </div>
        ))}

        {(thinking || tools.length > 0 || streamingText) && (
          <div className="msg assistant">
            <div className="who">Coach</div>
            {thinking && !streamingText && <div className="thinking">{thinking}</div>}
            {tools.length > 0 && (
              <div>
                {tools.map((t) => (
                  <span key={t} className="toolchip">
                    {t.replace(/_/g, " ")}
                  </span>
                ))}
              </div>
            )}
            {streamingText && (
              <div className="body">
                <Markdown text={streamingText} />
              </div>
            )}
          </div>
        )}

        {error && <div className="banner error">{error}</div>}
      </div>

      <div className="composer">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask your coach… (Enter to send, Shift+Enter for a new line)"
          disabled={busy}
        />
        <button onClick={() => void send()} disabled={busy || !input.trim()}>
          Send
        </button>
      </div>
    </div>
  );
}
