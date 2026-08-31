"use client";

import { useState, type FormEvent } from "react";
import { login } from "@/lib/api";

type LoginFormProps = {
  onSignedIn: (username: string) => void;
};

export const LoginForm = ({ onSignedIn }: LoginFormProps) => {
  const [form, setForm] = useState({ username: "", password: "" });
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const me = await login(form.username, form.password);
      onSignedIn(me.username);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Sign in failed");
      setIsSubmitting(false);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute left-0 top-0 h-[420px] w-[420px] -translate-x-1/3 -translate-y-1/3 rounded-full bg-[radial-gradient(circle,_rgba(32,157,215,0.25)_0%,_rgba(32,157,215,0.05)_55%,_transparent_70%)]" />
      <div className="pointer-events-none absolute bottom-0 right-0 h-[520px] w-[520px] translate-x-1/4 translate-y-1/4 rounded-full bg-[radial-gradient(circle,_rgba(117,57,145,0.18)_0%,_rgba(117,57,145,0.05)_55%,_transparent_75%)]" />

      <main className="relative grid min-h-screen place-items-center px-6 py-16">
        <div className="w-full max-w-[420px] rounded-[32px] border border-[var(--stroke)] bg-white/85 p-10 shadow-[var(--shadow)] backdrop-blur">
          <div className="h-1 w-16 rounded-full bg-[var(--accent-yellow)]" />
          <p className="mt-6 text-xs font-semibold uppercase tracking-[0.35em] text-[var(--gray-text)]">
            Kanban Studio
          </p>
          <h1 className="mt-3 font-display text-3xl font-semibold text-[var(--navy-dark)]">
            Sign in
          </h1>
          <p className="mt-3 text-sm leading-6 text-[var(--gray-text)]">
            Use your project credentials to open the board.
          </p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-4">
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--gray-text)]">
                Username
              </span>
              <input
                value={form.username}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, username: event.target.value }))
                }
                aria-label="Username"
                autoComplete="username"
                className="mt-2 w-full rounded-xl border border-[var(--stroke)] bg-white px-3 py-2 text-sm font-medium text-[var(--navy-dark)] outline-none transition focus:border-[var(--primary-blue)]"
                required
              />
            </label>

            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--gray-text)]">
                Password
              </span>
              <input
                type="password"
                value={form.password}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, password: event.target.value }))
                }
                aria-label="Password"
                autoComplete="current-password"
                className="mt-2 w-full rounded-xl border border-[var(--stroke)] bg-white px-3 py-2 text-sm font-medium text-[var(--navy-dark)] outline-none transition focus:border-[var(--primary-blue)]"
                required
              />
            </label>

            {error && (
              <p
                role="alert"
                data-testid="login-error"
                className="rounded-xl bg-[rgba(117,57,145,0.08)] px-3 py-2 text-sm font-medium text-[var(--secondary-purple)]"
              >
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full rounded-full bg-[var(--secondary-purple)] px-4 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-white transition hover:brightness-110 disabled:opacity-60"
            >
              {isSubmitting ? "Signing in" : "Sign in"}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
};
