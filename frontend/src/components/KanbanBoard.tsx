"use client";

import { useEffect, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { KanbanColumn } from "@/components/KanbanColumn";
import { KanbanCardPreview } from "@/components/KanbanCardPreview";
import { createId, moveCard, type BoardData } from "@/lib/kanban";
import { UnauthorizedError, getBoard, saveBoard } from "@/lib/api";

// Saves are debounced rather than fired per mutation, because renaming a column
// calls its handler on every keystroke.
const SAVE_DELAY_MS = 300;

type KanbanBoardProps = {
  username: string;
  onSignOut: () => void;
  onUnauthorized: () => void;
};

export const KanbanBoard = ({
  username,
  onSignOut,
  onUnauthorized,
}: KanbanBoardProps) => {
  const [board, setBoard] = useState<BoardData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const hasPendingSave = useRef(false);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    })
  );

  useEffect(() => {
    getBoard()
      .then(setBoard)
      .catch((caught) => {
        if (caught instanceof UnauthorizedError) {
          onUnauthorized();
          return;
        }
        setLoadError("Could not load your board.");
      });
  }, [onUnauthorized]);

  useEffect(() => {
    if (!board || !hasPendingSave.current) {
      return;
    }

    const timer = setTimeout(async () => {
      hasPendingSave.current = false;
      try {
        await saveBoard(board);
        setSaveError(null);
      } catch (caught) {
        if (caught instanceof UnauthorizedError) {
          onUnauthorized();
          return;
        }
        setSaveError("Could not save that change. Reloading from the server.");
        try {
          setBoard(await getBoard());
        } catch (reloadFailed) {
          if (reloadFailed instanceof UnauthorizedError) {
            onUnauthorized();
          }
        }
      }
    }, SAVE_DELAY_MS);

    return () => clearTimeout(timer);
  }, [board, onUnauthorized]);

  // Applies the change locally straight away, then lets the effect above persist
  // it. The UI never waits for the server.
  const mutate = (updater: (previous: BoardData) => BoardData) => {
    hasPendingSave.current = true;
    setBoard((previous) => (previous ? updater(previous) : previous));
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveCardId(event.active.id as string);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveCardId(null);

    if (!over || active.id === over.id) {
      return;
    }

    mutate((previous) => ({
      ...previous,
      columns: moveCard(previous.columns, active.id as string, over.id as string),
    }));
  };

  const handleRenameColumn = (columnId: string, title: string) => {
    mutate((previous) => ({
      ...previous,
      columns: previous.columns.map((column) =>
        column.id === columnId ? { ...column, title } : column
      ),
    }));
  };

  const handleAddCard = (columnId: string, title: string, details: string) => {
    const id = createId("card");
    mutate((previous) => ({
      ...previous,
      cards: {
        ...previous.cards,
        [id]: { id, title, details: details || "No details yet." },
      },
      columns: previous.columns.map((column) =>
        column.id === columnId
          ? { ...column, cardIds: [...column.cardIds, id] }
          : column
      ),
    }));
  };

  const handleEditCard = (cardId: string, title: string, details: string) => {
    mutate((previous) => ({
      ...previous,
      cards: {
        ...previous.cards,
        [cardId]: { ...previous.cards[cardId], title, details },
      },
    }));
  };

  const handleDeleteCard = (columnId: string, cardId: string) => {
    mutate((previous) => ({
      ...previous,
      cards: Object.fromEntries(
        Object.entries(previous.cards).filter(([id]) => id !== cardId)
      ),
      columns: previous.columns.map((column) =>
        column.id === columnId
          ? {
              ...column,
              cardIds: column.cardIds.filter((id) => id !== cardId),
            }
          : column
      ),
    }));
  };

  if (loadError) {
    return (
      <div
        data-testid="board-error"
        className="grid min-h-screen place-items-center px-6 text-center text-sm font-medium text-[var(--secondary-purple)]"
      >
        {loadError}
      </div>
    );
  }

  if (!board) {
    return (
      <div
        data-testid="board-loading"
        className="grid min-h-screen place-items-center text-xs font-semibold uppercase tracking-[0.35em] text-[var(--gray-text)]"
      >
        Loading board
      </div>
    );
  }

  const activeCard = activeCardId ? board.cards[activeCardId] : null;

  return (
    <div className="relative overflow-hidden">
      <div className="pointer-events-none absolute left-0 top-0 h-[420px] w-[420px] -translate-x-1/3 -translate-y-1/3 rounded-full bg-[radial-gradient(circle,_rgba(32,157,215,0.25)_0%,_rgba(32,157,215,0.05)_55%,_transparent_70%)]" />
      <div className="pointer-events-none absolute bottom-0 right-0 h-[520px] w-[520px] translate-x-1/4 translate-y-1/4 rounded-full bg-[radial-gradient(circle,_rgba(117,57,145,0.18)_0%,_rgba(117,57,145,0.05)_55%,_transparent_75%)]" />

      <main className="relative mx-auto flex min-h-screen max-w-[1500px] flex-col gap-10 px-6 pb-16 pt-12">
        {saveError && (
          <p
            data-testid="save-error"
            className="rounded-2xl border border-[var(--stroke)] bg-[rgba(117,57,145,0.08)] px-5 py-3 text-sm font-medium text-[var(--secondary-purple)]"
          >
            {saveError}
          </p>
        )}

        <header className="flex flex-col gap-6 rounded-[32px] border border-[var(--stroke)] bg-white/80 p-8 shadow-[var(--shadow)] backdrop-blur">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-[var(--gray-text)]">
                Single Board Kanban
              </p>
              <h1 className="mt-3 font-display text-4xl font-semibold text-[var(--navy-dark)]">
                Kanban Studio
              </h1>
              <p className="mt-3 max-w-xl text-sm leading-6 text-[var(--gray-text)]">
                Keep momentum visible. Rename columns, drag cards between stages,
                and capture quick notes without getting buried in settings.
              </p>
            </div>
            <div className="flex flex-col items-end gap-4">
              <div className="flex items-center gap-3">
                <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--gray-text)]">
                  Signed in as {username}
                </span>
                <button
                  type="button"
                  onClick={onSignOut}
                  className="rounded-full border border-[var(--stroke)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--navy-dark)] transition hover:border-[var(--primary-blue)] hover:text-[var(--primary-blue)]"
                >
                  Sign out
                </button>
              </div>
              <div className="rounded-2xl border border-[var(--stroke)] bg-[var(--surface)] px-5 py-4">
                <p className="text-xs font-semibold uppercase tracking-[0.25em] text-[var(--gray-text)]">
                  Focus
                </p>
                <p className="mt-2 text-lg font-semibold text-[var(--primary-blue)]">
                  One board. Five columns. Zero clutter.
                </p>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            {board.columns.map((column) => (
              <div
                key={column.id}
                className="flex items-center gap-2 rounded-full border border-[var(--stroke)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--navy-dark)]"
              >
                <span className="h-2 w-2 rounded-full bg-[var(--accent-yellow)]" />
                {column.title}
              </div>
            ))}
          </div>
        </header>

        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <section className="grid gap-6 lg:grid-cols-5">
            {board.columns.map((column) => (
              <KanbanColumn
                key={column.id}
                column={column}
                cards={column.cardIds.map((cardId) => board.cards[cardId])}
                onRename={handleRenameColumn}
                onAddCard={handleAddCard}
                onEditCard={handleEditCard}
                onDeleteCard={handleDeleteCard}
              />
            ))}
          </section>
          <DragOverlay>
            {activeCard ? (
              <div className="w-[260px]">
                <KanbanCardPreview card={activeCard} />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </main>
    </div>
  );
};
