"use client";

import { useState, useRef, useEffect, type KeyboardEvent } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/cn";
import { useSessionEvents } from "@/hooks/useSessionEvents";
import type { DashboardSession } from "@/lib/types";
import { projectSessionPath } from "@/lib/routes";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

function buildInitialMessages(session: DashboardSession): ChatMessage[] {
  const messages: ChatMessage[] = [];

  if (session.userPrompt) {
    messages.push({
      id: `${session.id}-user-prompt`,
      role: "user",
      content: session.userPrompt,
      timestamp: new Date(session.createdAt).getTime(),
    });
  }

  if (session.summary) {
    messages.push({
      id: `${session.id}-summary`,
      role: "assistant",
      content: session.summary,
      timestamp: new Date(session.lastActivityAt).getTime(),
    });
  }

  return messages;
}

interface ChatThreadProps {
  session: DashboardSession;
  projectId: string;
}

export function ChatThread({ session, projectId }: ChatThreadProps) {
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    buildInitialMessages(session),
  );
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [slashCommands, setSlashCommands] = useState<string[]>([]);
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(-1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listEndRef = useRef<HTMLDivElement>(null);

  const { sessions } = useSessionEvents({
    initialSessions: [session],
    disabled: true,
    attentionZones: "simple",
  });

  const currentSession = sessions[0] ?? session;

  useEffect(() => {
    const updated = buildInitialMessages(currentSession);
    setMessages((prev) => {
      if (prev.length === updated.length && prev.every((m, i) => m.id === updated[i]?.id)) {
        return prev;
      }
      return updated;
    });
  }, [currentSession.id, currentSession.userPrompt, currentSession.summary]);

  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed || sending) return;

    setSending(true);
    const userMessage: ChatMessage = {
      id: `${session.id}-user-${Date.now()}`,
      role: "user",
      content: trimmed,
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");

    try {
      const res = await fetch(
        `/api/sessions/${encodeURIComponent(session.id)}/send`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: trimmed }),
        },
      );

      if (!res.ok) {
        const text = await res.text().catch(() => "Send failed");
        throw new Error(text);
      }
    } catch (err) {
      console.error("Failed to send message:", err);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === userMessage.id
            ? {
                ...m,
                content: `${m.content}\n\n*(send failed: ${err instanceof Error ? err.message : "unknown error"})*`,
              }
            : m,
        ),
      );
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (slashCommands.length > 0 && selectedCommandIndex >= 0) {
        const cmd = slashCommands[selectedCommandIndex];
        setInput((_prev) => `${cmd} `);
        setSlashCommands([]);
        setSelectedCommandIndex(-1);
        return;
      }
      handleSend();
      return;
    }

    if (e.key === "ArrowUp" && slashCommands.length > 0) {
      e.preventDefault();
      setSelectedCommandIndex((prev) =>
        prev <= 0 ? slashCommands.length - 1 : prev - 1,
      );
      return;
    }

    if (e.key === "ArrowDown" && slashCommands.length > 0) {
      e.preventDefault();
      setSelectedCommandIndex((prev) =>
        prev >= slashCommands.length - 1 ? 0 : prev + 1,
      );
      return;
    }

    if (e.key === "Escape") {
      setSlashCommands([]);
      setSelectedCommandIndex(-1);
      return;
    }
  };

  const detectSlashCommands = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed.startsWith("/")) {
      setSlashCommands([]);
      setSelectedCommandIndex(-1);
      return;
    }

    const known = ["/help", "/status", "/summary", "/review", "/fix", "/retry", "/kill"];
    const query = trimmed.slice(1).toLowerCase();
    const matches = known.filter((cmd) => cmd.slice(1).startsWith(query));
    setSlashCommands(matches);
    setSelectedCommandIndex(matches.length > 0 ? 0 : -1);
  };

  const handleInputChange = (value: string) => {
    setInput(value);
    detectSlashCommands(value);
  };

  const insertChip = (chip: string) => {
    setInput((prev) => `${prev}${chip} `);
    inputRef.current?.focus();
  };

  return (
    <div className="chat-thread flex h-full flex-col">
      <div className="chat-thread__header">
        <Link
          href={projectSessionPath(projectId, session.id)}
          className="chat-thread__back"
        >
          <svg
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path d="M15 18l-6-6 6-6" />
          </svg>
          <span>Session</span>
        </Link>
        <span className="chat-thread__title">Chat</span>
      </div>

      <div ref={scrollRef} className="chat-thread__messages flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="chat-thread__empty">
            <p>No messages yet. Start the conversation below.</p>
          </div>
        ) : (
          <div className="chat-thread__list">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={cn(
                  "chat-thread__msg",
                  msg.role === "user" ? "chat-thread__msg--user" : "chat-thread__msg--assistant",
                )}
              >
                <div className="chat-thread__msg-role">
                  {msg.role === "user" ? "You" : "Agent"}
                </div>
                <div className="chat-thread__msg-content">
                  {msg.role === "assistant" ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {msg.content}
                    </ReactMarkdown>
                  ) : (
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                  )}
                </div>
                <div className="chat-thread__msg-time">
                  {new Date(msg.timestamp).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </div>
              </div>
            ))}
            <div ref={listEndRef} />
          </div>
        )}
      </div>

      <div className="chat-thread__composer">
        {slashCommands.length > 0 && (
          <div className="chat-thread__slash-menu" role="listbox">
            {slashCommands.map((cmd, idx) => (
              <button
                key={cmd}
                type="button"
                role="option"
                aria-selected={idx === selectedCommandIndex}
                className={cn(
                  "chat-thread__slash-item",
                  idx === selectedCommandIndex && "chat-thread__slash-item--active",
                )}
                onMouseDown={(e) => {
                  e.preventDefault();
                  setSlashCommands([]);
                  setSelectedCommandIndex(-1);
                  setInput(`${cmd} `);
                }}
              >
                {cmd}
              </button>
            ))}
          </div>
        )}

        <div className="chat-thread__chips">
          <button
            type="button"
            className="chat-thread__chip"
            onMouseDown={(e) => {
              e.preventDefault();
              insertChip("@file");
            }}
          >
            @file
          </button>
          <button
            type="button"
            className="chat-thread__chip"
            onMouseDown={(e) => {
              e.preventDefault();
              insertChip("@agent");
            }}
          >
            @agent
          </button>
        </div>

        <div className="chat-thread__input-row">
          <textarea
            ref={inputRef}
            className="chat-thread__input"
            value={input}
            onChange={(e) => handleInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Send a message… (Enter to send, Shift+Enter for new line)"
            rows={1}
            disabled={sending}
          />
          <button
            type="button"
            className="chat-thread__send"
            onClick={handleSend}
            disabled={sending || input.trim().length === 0}
            aria-label="Send message"
          >
            <svg
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
