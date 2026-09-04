"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import clsx from "clsx";
import { UnauthorizedError, sendChat, type ChatMessage } from "@/lib/api";

// The board flag rides along with the turn that caused it, so the confirmation
// stays attached to the right message as the conversation grows.
type Turn = ChatMessage & { boardUpdated?: boolean };

type ChatSidebarProps = {
  isOpen: boolean;
  onToggle: () => void;
  onBoardUpdated: () => void;
  onUnauthorized: () => void;
};

export const ChatSidebar = ({
  isOpen,
  onToggle,
  onBoardUpdated,
  onUnauthorized,
}: ChatSidebarProps) => {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const feedEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    // jsdom has no scrollIntoView, hence the optional call.
    feedEndRef.current?.scrollIntoView?.({ block: "end" });
  }, [turns, isSending]);

  const send = async () => {
    const message = draft.trim();
    if (!message || isSending) {
      return;
    }

    const history = turns.map(({ role, content }) => ({ role, content }));
    setTurns((previous) => [...previous, { role: "user", content: message }]);
    setDraft("");
    setError(null);
    setIsSending(true);

    try {
      const { reply, boardUpdated } = await sendChat(message, history);
      setTurns((previous) => [
        ...previous,
        { role: "assistant", content: reply, boardUpdated },
      ]);
      if (boardUpdated) {
        onBoardUpdated();
      }
    } catch (caught) {
      if (caught instanceof UnauthorizedError) {
        onUnauthorized();
        return;
      }
      setError("The assistant did not reply. Try again.");
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  };

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={onToggle}
        data-testid="chat-toggle"
        className="fixed bottom-6 right-6 z-40 rounded-full bg-[var(--secondary-purple)] px-5 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-white shadow-[var(--shadow)] transition hover:brightness-110"
      >
        Ask AI
      </button>
    );
  }

  return (
    <aside
      aria-label="AI assistant"
      data-testid="chat-sidebar"
      className="fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l border-[var(--stroke)] bg-white/95 shadow-[var(--shadow)] backdrop-blur sm:w-[400px]"
    >
      <header className="flex items-center justify-between border-b border-[var(--stroke)] px-6 py-5">
        <div>
          <div className="h-1 w-10 rounded-full bg-[var(--accent-yellow)]" />
          <h2 className="mt-3 font-display text-lg font-semibold text-[var(--navy-dark)]">
            AI assistant
          </h2>
        </div>
        <button
          type="button"
          onClick={onToggle}
          aria-label="Close assistant"
          className="rounded-full border border-[var(--stroke)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--navy-dark)] transition hover:border-[var(--primary-blue)] hover:text-[var(--primary-blue)]"
        >
          Close
        </button>
      </header>

      <div
        data-testid="chat-feed"
        className="flex-1 space-y-4 overflow-y-auto px-6 py-6"
      >
        {turns.length === 0 && (
          <p className="text-sm leading-6 text-[var(--gray-text)]">
            Ask about the board, or tell me to add, edit, or move a card.
          </p>
        )}

        {turns.map((turn, index) => (
          <div
            key={index}
            data-testid={`chat-${turn.role}`}
            className={clsx(
              "max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-6 whitespace-pre-wrap",
              turn.role === "user"
                ? "ml-auto bg-[var(--primary-blue-soft)] text-[var(--navy-dark)]"
                : "border border-[var(--stroke)] bg-[var(--surface)] text-[var(--navy-dark)]"
            )}
          >
            {turn.content}
            {turn.boardUpdated && (
              <span
                data-testid="chat-board-updated"
                className="mt-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--primary-blue)]"
              >
                <span className="h-2 w-2 rounded-full bg-[var(--accent-yellow)]" />
                Board updated
              </span>
            )}
          </div>
        ))}

        {isSending && (
          <div data-testid="chat-thinking" aria-live="polite">
            <p className="thinking text-xs font-semibold uppercase tracking-[0.3em] text-[var(--gray-text)]">
              Thinking
            </p>
            <p className="mt-2 text-xs leading-5 text-[var(--gray-text)]">
              Board changes can take a minute or two.
            </p>
          </div>
        )}

        {error && (
          <p
            data-testid="chat-error"
            className="rounded-xl bg-[var(--secondary-purple-soft)] px-3 py-2 text-sm font-medium text-[var(--secondary-purple)]"
          >
            {error}
          </p>
        )}

        <div ref={feedEndRef} />
      </div>

      <div className="border-t border-[var(--stroke)] px-6 py-5">
        <textarea
          ref={inputRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          aria-label="Message"
          placeholder="Ask the assistant"
          rows={3}
          className="w-full resize-none rounded-xl border border-[var(--stroke)] bg-white px-3 py-2 text-sm text-[var(--navy-dark)] outline-none transition focus:border-[var(--primary-blue)]"
        />
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="text-xs text-[var(--gray-text)]">
            Enter sends, Shift+Enter for a new line
          </span>
          <button
            type="button"
            onClick={send}
            disabled={isSending || !draft.trim()}
            className="rounded-full bg-[var(--secondary-purple)] px-5 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white transition hover:brightness-110 disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </div>
    </aside>
  );
};
