import { Octokit } from "octokit";
import { getConfig } from "../config.js";

let cached: Octokit | null = null;

export function getOctokit(): Octokit {
  if (cached) return cached;
  const { GITHUB_TOKEN } = getConfig();
  if (!GITHUB_TOKEN) {
    throw new Error("GITHUB_TOKEN is required for GitHub repos (see .env.example)");
  }
  cached = new Octokit({ auth: GITHUB_TOKEN });
  return cached;
}

export function parseRepoSlug(slug: string): { owner: string; repo: string } {
  const match = slug.match(/^([^/]+)\/([^/]+)$/);
  if (!match) throw new Error(`Invalid repo "${slug}" — expected owner/repo`);
  return { owner: match[1]!, repo: match[2]! };
}
