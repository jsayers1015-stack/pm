"use client";

import { useCallback, useEffect, useState } from "react";
import { getMe, logout } from "@/lib/api";
import { KanbanBoard } from "@/components/KanbanBoard";
import { LoginForm } from "@/components/LoginForm";

export const AppShell = () => {
  const [username, setUsername] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    getMe()
      .then((me) => setUsername(me?.username ?? null))
      .catch(() => setUsername(null))
      .finally(() => setIsLoading(false));
  }, []);

  const handleSignOut = async () => {
    await logout();
    setUsername(null);
  };

  // Stable, so it can sit in KanbanBoard's effect dependencies without
  // retriggering the board fetch on every render.
  const handleUnauthorized = useCallback(() => setUsername(null), []);

  if (isLoading) {
    return (
      <div
        data-testid="session-loading"
        className="grid min-h-screen place-items-center text-xs font-semibold uppercase tracking-[0.35em] text-[var(--gray-text)]"
      >
        Loading
      </div>
    );
  }

  if (!username) {
    return <LoginForm onSignedIn={setUsername} />;
  }

  return (
    <KanbanBoard
      username={username}
      onSignOut={handleSignOut}
      onUnauthorized={handleUnauthorized}
    />
  );
};
