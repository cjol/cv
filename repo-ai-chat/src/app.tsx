import { useState, useRef, useEffect, useCallback } from "react";
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import type { UIMessage } from "ai";
import "./styles.css";

// ─── Types ────────────────────────────────────────────────────────────────────

type ImportState =
  | { status: "idle" }
  | { status: "importing" }
  | { status: "ready"; artifactId: string; gitUrl: string; repoName: string }
  | { status: "error"; message: string };

type CloneState = "pending" | "cloning" | "done" | "error";

// ─── Import screen ────────────────────────────────────────────────────────────

function ImportScreen({ onImport }: { onImport: (importState: Extract<ImportState, { status: "ready" }>) => void }) {
  const [url, setUrl] = useState("");
  const [state, setState] = useState<ImportState>({ status: "idle" });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    setState({ status: "importing" });

    try {
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoUrl: url.trim() }),
      });

      const data = await res.json<{ artifactId?: string; gitUrl?: string; repoName?: string; error?: string }>();
      if (!res.ok || data.error) {
        setState({ status: "error", message: data.error ?? "Import failed" });
        return;
      }

      onImport({
        status: "ready",
        artifactId: data.artifactId!,
        gitUrl: data.gitUrl!,
        repoName: data.repoName!,
      });
    } catch (err) {
      setState({ status: "error", message: String(err) });
    }
  }

  const isImporting = state.status === "importing";

  return (
    <div className="import-screen">
      <div className="import-card">
        <div className="import-header">
          <h1>Repo AI Chat</h1>
          <p>Import any public GitHub repository and chat with an AI that understands the code.</p>
        </div>

        <form className="import-form" onSubmit={handleSubmit}>
          <input
            className="input-field"
            type="url"
            placeholder="https://github.com/owner/repository"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              if (state.status === "error") setState({ status: "idle" });
            }}
            disabled={isImporting}
            autoFocus
          />
          <button className="btn-primary" type="submit" disabled={isImporting || !url.trim()}>
            {isImporting ? "Importing…" : "Import & Chat"}
          </button>
        </form>

        {state.status === "error" && (
          <p style={{ color: "#f87171", fontSize: "0.85rem", textAlign: "center" }}>{state.message}</p>
        )}

        <p className="import-hint">
          Example: <code>https://github.com/cloudflare/agents</code>
        </p>
      </div>
    </div>
  );
}

// ─── Chat screen ──────────────────────────────────────────────────────────────

const SUGGESTIONS = [
  "What does this project do?",
  "Show me the project structure",
  "Where is the main entry point?",
  "What are the key dependencies?",
];

function ChatScreen({ repo }: { repo: Extract<ImportState, { status: "ready" }> }) {
  const [cloneState, setCloneState] = useState<CloneState>("pending");
  const [cloneError, setCloneError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const setupCalledRef = useRef(false);

  // useAgent is typed with the instance type for state inference; callable methods
  // are accessed via `agent.call` at runtime (we use @ts-expect-error below).
  const agent = useAgent({
    agent: "RepoChatAgent",
    name: repo.artifactId,
  });

  const { messages, sendMessage, status } = useAgentChat({ agent });

  // Trigger the initial git clone via the @callable setup method
  useEffect(() => {
    if (setupCalledRef.current) return;
    setupCalledRef.current = true;
    setCloneState("cloning");

    // @ts-expect-error — callable methods are typed via Agent generic but TS needs the cast
    agent.setup(repo.gitUrl, repo.repoName)
      .then((result: { ok: boolean; error?: string }) => {
        if (result.ok) {
          setCloneState("done");
        } else {
          setCloneState("error");
          setCloneError(result.error ?? "Clone failed");
        }
      })
      .catch((err: unknown) => {
        setCloneState("error");
        setCloneError(String(err));
      });
  }, [agent, repo]);

  // Auto-scroll to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, status]);

  const handleSend = useCallback(
    (text: string) => {
      if (!text.trim() || status === "streaming" || cloneState !== "done") return;
      sendMessage({ role: "user", parts: [{ type: "text", text }] });
      setInput("");
    },
    [sendMessage, status, cloneState]
  );

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend(input);
    }
  }

  const isStreaming = status === "streaming";
  const canSend = cloneState === "done" && !isStreaming && input.trim().length > 0;

  return (
    <div className="chat-screen">
      {/* Header */}
      <div className="chat-header">
        <span className="chat-header-logo">Repo AI Chat</span>
        <span className="chat-header-sep">—</span>
        <span className="chat-header-repo">{repo.repoName}</span>
        {cloneState === "done" && <span className="chat-header-badge">Ready</span>}
      </div>

      {/* Clone status bar */}
      {cloneState === "cloning" && (
        <div className="clone-status">
          <div className="spinner" />
          Cloning repository… this may take a moment for large repos
        </div>
      )}
      {cloneState === "error" && (
        <div className="error-banner">
          <span>Clone failed: {cloneError}</span>
        </div>
      )}

      {/* Messages */}
      <div className="chat-messages">
        {messages.length === 0 && cloneState === "done" && (
          <div className="chat-empty">
            <h2>Repository loaded</h2>
            <p style={{ color: "var(--text-muted)", fontSize: "0.875rem" }}>
              Ask anything about <strong>{repo.repoName}</strong>
            </p>
            <div className="chat-empty-suggestions">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="suggestion-chip" onClick={() => handleSend(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg: UIMessage) => (
          <div key={msg.id} className={`message ${msg.role}`}>
            <div className="message-bubble">
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {(msg.parts as any[]).map((part: any, i: number) => {
                if (part.type === "text") {
                  return <span key={i}>{part.text}</span>;
                }
                if (part.type === "tool-invocation") {
                  return (
                    <div key={i} className="tool-call">
                      {part.toolInvocation.toolName}({JSON.stringify(part.toolInvocation.args).slice(0, 80)}…)
                    </div>
                  );
                }
                return null;
              })}
            </div>
          </div>
        ))}

        {isStreaming && (
          <div className="message assistant">
            <div className="typing-indicator">
              <div className="typing-dot" />
              <div className="typing-dot" />
              <div className="typing-dot" />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="chat-input-area">
        <div className="chat-input-row">
          <textarea
            className="chat-textarea"
            rows={1}
            placeholder={
              cloneState !== "done"
                ? "Waiting for repository to load…"
                : "Ask about the code… (Enter to send, Shift+Enter for newline)"
            }
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={cloneState !== "done" || isStreaming}
          />
          <button className="btn-send" onClick={() => handleSend(input)} disabled={!canSend}>
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export function App() {
  const [importState, setImportState] = useState<ImportState>({ status: "idle" });

  if (importState.status === "ready") {
    return <ChatScreen repo={importState} />;
  }

  return <ImportScreen onImport={setImportState} />;
}
