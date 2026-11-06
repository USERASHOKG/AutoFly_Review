"use client";

import { useState } from "react";
import { createSupabaseBrowser } from "@/lib/supabase/client";

export default function LoginForm() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    setMessage("");
    const supabase = createSupabaseBrowser();
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      setState("error");
      setMessage(
        error.status === 429
          ? "Too many requests. Please wait a minute before asking for another link."
          : "We could not send the link. Check the email address and try again."
      );
      return;
    }
    setState("sent");
  }

  if (state === "sent") {
    return (
      <div className="text-center">
        <p className="text-lg font-semibold">Check your inbox</p>
        <p className="mt-2 text-sm text-slate-600">
          We sent a sign-in link to <strong>{email}</strong>. It opens AutoFly_Review on this device.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <label htmlFor="email" className="block text-sm font-medium text-slate-700">
        Work email
      </label>
      <input
        id="email"
        type="email"
        required
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@yourbusiness.com"
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
      />
      <button type="submit" disabled={state === "sending"} className="btn-primary w-full">
        {state === "sending" ? "Sending..." : "Email me a magic link"}
      </button>
      {state === "error" && <p className="text-sm text-red-600">{message}</p>}
    </form>
  );
}
