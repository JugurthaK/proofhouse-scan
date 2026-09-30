import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, clearToken, setToken } from "../api";

export default function Login() {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const navigate = useNavigate();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setChecking(true);
    setError(null);
    setToken(value.trim());
    try {
      await api.authCheck();
      navigate("/");
    } catch {
      clearToken();
      setError("Invalid token");
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-lg border border-line bg-surface-1 p-6"
      >
        <h1 className="text-lg font-semibold tracking-tight">
          <span className="text-accent">proofhouse</span>-scan
        </h1>
        <p className="mt-1 text-sm text-ink-3">
          This instance requires an API token.
        </p>
        <input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="API token"
          autoFocus
          className="mt-4 w-full rounded-md border border-line bg-surface-2 px-3 py-2 text-sm text-ink placeholder:text-ink-3"
        />
        {error && <p className="mt-2 text-sm text-sev-critical">{error}</p>}
        <button
          type="submit"
          disabled={checking || value.trim().length === 0}
          className="mt-4 w-full rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {checking ? "Checking…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
