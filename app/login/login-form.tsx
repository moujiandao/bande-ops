"use client";

import { useActionState } from "react";
import { signIn } from "@/lib/auth/actions";
import type { SignInState } from "@/lib/auth/types";

const initialState: SignInState = { error: null };

/**
 * The email + password sign-in form. Client component so it can surface the
 * server action's error state via `useActionState` and disable the button
 * while the request is in flight. No sign-up path by design.
 */
export function LoginForm() {
  const [state, formAction, pending] = useActionState(signIn, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="email"
          className="text-xs font-medium text-muted"
        >
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className="rounded-md border border-border bg-panel px-3 py-2 text-sm text-foreground outline-none focus:border-border-strong"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="password"
          className="text-xs font-medium text-muted"
        >
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="rounded-md border border-border bg-panel px-3 py-2 text-sm text-foreground outline-none focus:border-border-strong"
        />
      </div>

      {state.error ? (
        <p role="alert" className="text-xs text-red-500">
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="mt-1 rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-foreground transition-opacity disabled:opacity-60"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
