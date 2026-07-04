"use client";

import { useRef, useState } from "react";
import { PUBLIC_API_URL } from "@/lib/api";
import { Avatar } from "./Avatar";

interface Turn {
  role: "user" | "assistant";
  content: string;
}

export function Chat({ employeeId, employeeName }: { employeeId: string; employeeName: string }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const conversationId = useRef<string | undefined>(undefined);
  const scrollRef = useRef<HTMLDivElement>(null);

  function scrollToBottom() {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    });
  }

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setError(null);
    setInput("");
    setBusy(true);
    setTurns((t) => [...t, { role: "user", content: text }, { role: "assistant", content: "" }]);
    scrollToBottom();

    try {
      const res = await fetch(`${PUBLIC_API_URL}/v1/employees/${employeeId}/chat/stream`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: text, conversationId: conversationId.current }),
      });
      if (!res.ok || !res.body) throw new Error(`Request failed (${res.status})`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        for (const evt of events) {
          const eventType = /event:\s*(.*)/.exec(evt)?.[1]?.trim();
          const dataLine = /data:\s*(.*)/.exec(evt)?.[1];
          if (!dataLine) continue;
          const data = JSON.parse(dataLine);
          if (eventType === "start") {
            conversationId.current = data.conversationId;
          } else if (eventType === "delta") {
            setTurns((t) => {
              const copy = [...t];
              const last = copy[copy.length - 1];
              if (last?.role === "assistant") last.content += data.text;
              return copy;
            });
            scrollToBottom();
          }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setTurns((t) => t.filter((turn, i) => !(i === t.length - 1 && turn.content === "")));
    } finally {
      setBusy(false);
      scrollToBottom();
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-1">
        {turns.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-muted">
            <Avatar name={employeeName} size={56} />
            <div>
              <div className="font-medium text-text">Chat with {employeeName}</div>
              <div className="text-sm">Delegate a task or ask a question to get started.</div>
            </div>
          </div>
        )}
        {turns.map((turn, i) => (
          <div key={i} className={`flex gap-3 ${turn.role === "user" ? "flex-row-reverse" : ""}`}>
            {turn.role === "assistant" ? (
              <Avatar name={employeeName} size={32} />
            ) : (
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs text-muted">
                You
              </div>
            )}
            <div
              className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                turn.role === "user"
                  ? "bg-accent text-white"
                  : "border border-border bg-surface-2 text-text"
              }`}
            >
              {turn.content || (busy ? <span className="live-dot text-muted">▍</span> : "")}
            </div>
          </div>
        ))}
      </div>

      {error && <div className="px-1 py-2 text-xs text-danger">{error}</div>}

      <div className="mt-3 flex items-end gap-2 border-t border-border pt-3">
        <textarea
          className="input min-h-[44px] resize-none"
          rows={1}
          placeholder={`Message ${employeeName}…`}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          disabled={busy}
        />
        <button className="btn" onClick={() => void send()} disabled={busy || !input.trim()}>
          {busy ? "…" : "Send"}
        </button>
      </div>
    </div>
  );
}
