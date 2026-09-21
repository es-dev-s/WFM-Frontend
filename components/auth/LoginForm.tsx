"use client";

import { BrandMark } from "@/components/layout/BrandMark";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { ApiError } from "@/lib/api";
import { Eye, EyeOff } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";

export function LoginForm() {
  const search = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setPending(true);
    try {
      const response = await fetch("/api/v1/auth/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        message?: string;
        error?: string;
      };
      if (!response.ok) {
        throw new ApiError(
          response.status,
          body.error || "invalid_credentials",
          body.message || "Email or password is incorrect.",
        );
      }
      const next = search.get("next") || "/";
      window.location.assign(next.startsWith("/") ? next : "/");
    } catch (caught) {
      const message =
        caught instanceof ApiError
          ? caught.message
          : "Can’t reach WFM right now. Try again.";
      setError(message);
      setPending(false);
    }
  }

  return (
    <div className="smp-login">
      <aside className="smp-login__brand">
        <div className="smp-login__brand-top">
          <span className="smp-login__mark" aria-hidden="true">
            <BrandMark />
          </span>
          <p className="smp-login__eyebrow">Workforce</p>
          <h1 className="smp-login__headline">Operations for Tivazo and Biometrics, in one place.</h1>
          <p className="smp-login__lede">
            WFM sees the full floor. Team leads only see the people they are accountable for.
          </p>
        </div>
        <ul className="smp-login__points">
          <li>Superadmin access for WFM</li>
          <li>Team-scoped views for leads</li>
          <li>Live attendance and tracked time</li>
        </ul>
      </aside>

      <main className="smp-login__panel">
        <div className="smp-login__toolbar">
          <ThemeToggle />
        </div>
        <form className="smp-login__form" onSubmit={onSubmit}>
          <div className="smp-login__form-head">
            <p className="smp-login__kicker">Sign in</p>
            <h2 className="smp-login__title">Welcome back</h2>
            <p className="smp-login__hint">Use your WFM or team lead account.</p>
          </div>

          <label className="smp-login__field">
            <span>Email</span>
            <input
              type="email"
              name="email"
              autoComplete="username"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@entegrasources.com.np"
            />
          </label>

          <label className="smp-login__field">
            <span>Password</span>
            <div className="smp-login__secret">
              <input
                type={showPassword ? "text" : "password"}
                name="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Enter your password"
              />
              <button
                type="button"
                className="smp-login__secret-toggle"
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                onClick={() => setShowPassword((current) => !current)}
              >
                {showPassword ? (
                  <EyeOff size={16} strokeWidth={1.75} />
                ) : (
                  <Eye size={16} strokeWidth={1.75} />
                )}
              </button>
            </div>
          </label>

          {error ? (
            <p className="smp-login__error" role="alert">
              {error}
            </p>
          ) : null}

          <button className="smp-login__submit" type="submit" disabled={pending}>
            {pending ? "Signing in…" : "Continue"}
          </button>
        </form>
      </main>
    </div>
  );
}
