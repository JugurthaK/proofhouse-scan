import { useSearchParams } from "react-router-dom";
import { githubLoginUrl } from "../api";

// Error codes the server's GitHub callback redirects back with.
const ERRORS: Record<string, string> = {
  not_allowed: "This GitHub account isn't authorized for this instance.",
  access_denied: "GitHub sign-in was cancelled.",
  state_mismatch: "Your sign-in attempt expired. Please try again.",
  not_configured: "GitHub sign-in isn't configured on this server.",
  github_error: "GitHub sign-in failed. Please try again.",
};

function GithubMark() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4 fill-current">
      <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z" />
    </svg>
  );
}

export default function Login() {
  const [params] = useSearchParams();
  const errorCode = params.get("error");
  const error = errorCode ? (ERRORS[errorCode] ?? ERRORS.github_error) : null;

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-sm rounded-lg border border-line bg-surface-1 p-6">
        <h1 className="text-lg font-semibold tracking-tight">
          <span className="text-accent">proofhouse</span>-scan
        </h1>
        <p className="mt-1 text-sm text-ink-3">
          Sign in with your GitHub account to continue.
        </p>
        {error && <p className="mt-4 text-sm text-sev-critical">{error}</p>}
        <a
          href={githubLoginUrl(params.get("next"))}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white"
        >
          <GithubMark />
          Sign in with GitHub
        </a>
      </div>
    </div>
  );
}
