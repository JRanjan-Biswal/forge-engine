import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { layout, nowIso, writeJsonAtomic } from "../core/paths.js";
import { htmlToText, USER_AGENT } from "./text.js";

/**
 * Evidence connectors: public sources an agent can search for real-world signal
 * (pain, competitors, demand). Every result keeps its URL and the text it came
 * with, so quotes saved from it can be verified later (see store.ts).
 *
 * Not included: PyPI (no search API) and Product Hunt (API requires OAuth and has
 * no full-text search). Agents use their host's web search for everything else
 * and still save the evidence through forge, which verifies it against the page.
 */

export const SOURCES = ["hackernews", "github", "npm", "appstore", "reddit"] as const;
export type EvidenceSource = (typeof SOURCES)[number];

export interface SearchResult {
  source: EvidenceSource;
  title: string;
  url: string;
  /** Plain text the result came with — what saved quotes are checked against. */
  text: string;
  metrics: Record<string, number | string>;
  publishedAt?: string;
}

export interface SearchResponse {
  source: EvidenceSource;
  query: string;
  limit: number;
  fetchedAt: string;
  cached: boolean;
  results: SearchResult[];
}

export interface ConnectorOptions {
  limit?: number;
  /** Override the API origin (tests, proxies). */
  baseUrl?: string;
  token?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Skip the 24h cache. */
  fresh?: boolean;
}

export class EvidenceSourceError extends Error {
  override name = "EvidenceSourceError";
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

async function getJson<T>(url: string, options: ConnectorOptions, headers: Record<string, string> = {}): Promise<T> {
  const response = await (options.fetchImpl ?? fetch)(url, {
    headers: { "user-agent": USER_AGENT, accept: "application/json", ...headers },
    signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
  });
  if (!response.ok) {
    const hint = response.status === 403 || response.status === 429 ? " (rate limited or blocked — try later, or set a token)" : "";
    throw new EvidenceSourceError(`${new URL(url).host} answered HTTP ${response.status}${hint}`);
  }
  return (await response.json()) as T;
}

const clip = (text: string | null | undefined, max = 1_500) => htmlToText(text ?? "").slice(0, max);

interface HnHit {
  objectID: string;
  title?: string | null;
  story_title?: string | null;
  story_text?: string | null;
  comment_text?: string | null;
  author?: string;
  points?: number | null;
  num_comments?: number | null;
  created_at?: string;
}

interface GithubRepo {
  full_name: string;
  html_url: string;
  description: string | null;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  pushed_at: string;
  created_at: string;
}

interface NpmObject {
  package: { name: string; description?: string; date?: string; links?: { npm?: string } };
  score?: { final?: number };
  downloads?: { weekly?: number; monthly?: number };
}

interface AppStoreApp {
  trackName: string;
  trackViewUrl: string;
  description?: string;
  averageUserRating?: number;
  userRatingCount?: number;
  formattedPrice?: string;
  sellerName?: string;
  releaseDate?: string;
}

interface RedditPost {
  data: {
    title: string;
    selftext?: string;
    permalink: string;
    subreddit: string;
    score: number;
    num_comments: number;
    created_utc?: number;
  };
}

type Connector = (query: string, options: ConnectorOptions & { limit: number }) => Promise<SearchResult[]>;

const CONNECTORS: Record<EvidenceSource, Connector> = {
  hackernews: async (query, options) => {
    const base = options.baseUrl ?? "https://hn.algolia.com";
    const data = await getJson<{ hits: HnHit[] }>(
      `${base}/api/v1/search?query=${encodeURIComponent(query)}&tags=(story,comment)&hitsPerPage=${options.limit}`,
      options,
    );
    return data.hits.map((hit) => ({
      source: "hackernews",
      title: hit.title ?? hit.story_title ?? "(comment)",
      url: `https://news.ycombinator.com/item?id=${hit.objectID}`,
      text: clip([hit.title, hit.story_text, hit.comment_text].filter(Boolean).join(" ")),
      metrics: { points: hit.points ?? 0, comments: hit.num_comments ?? 0, author: hit.author ?? "" },
      publishedAt: hit.created_at,
    }));
  },

  github: async (query, options) => {
    const base = options.baseUrl ?? "https://api.github.com";
    const token = options.token ?? process.env.GITHUB_TOKEN;
    const data = await getJson<{ items: GithubRepo[] }>(
      `${base}/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=${options.limit}`,
      options,
      { accept: "application/vnd.github+json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    );
    return data.items.map((repo) => ({
      source: "github",
      title: repo.full_name,
      url: repo.html_url,
      text: clip(`${repo.full_name} — ${repo.description ?? ""}`),
      metrics: { stars: repo.stargazers_count, forks: repo.forks_count, openIssues: repo.open_issues_count, pushedAt: repo.pushed_at },
      publishedAt: repo.created_at,
    }));
  },

  npm: async (query, options) => {
    const base = options.baseUrl ?? "https://registry.npmjs.org";
    const data = await getJson<{ objects: NpmObject[] }>(`${base}/-/v1/search?text=${encodeURIComponent(query)}&size=${options.limit}`, options);
    return data.objects.map(({ package: pkg, score, downloads }) => ({
      source: "npm",
      title: pkg.name,
      url: pkg.links?.npm ?? `https://www.npmjs.com/package/${pkg.name}`,
      text: clip(`${pkg.name} — ${pkg.description ?? ""}`),
      metrics: {
        weeklyDownloads: downloads?.weekly ?? "n/a",
        score: score?.final !== undefined ? Math.round(score.final * 100) / 100 : "n/a",
      },
      publishedAt: pkg.date,
    }));
  },

  appstore: async (query, options) => {
    const base = options.baseUrl ?? "https://itunes.apple.com";
    const data = await getJson<{ results: AppStoreApp[] }>(
      `${base}/search?term=${encodeURIComponent(query)}&entity=software&country=us&limit=${options.limit}`,
      options,
    );
    return data.results.map((app) => ({
      source: "appstore",
      title: app.trackName,
      url: app.trackViewUrl,
      text: clip(`${app.trackName} — ${app.description ?? ""}`),
      metrics: {
        rating: app.averageUserRating ?? "n/a",
        ratings: app.userRatingCount ?? 0,
        price: app.formattedPrice ?? "n/a",
        seller: app.sellerName ?? "",
      },
      publishedAt: app.releaseDate,
    }));
  },

  reddit: async (query, options) => {
    const base = options.baseUrl ?? "https://www.reddit.com";
    const data = await getJson<{ data: { children: RedditPost[] } }>(
      `${base}/search.json?q=${encodeURIComponent(query)}&limit=${options.limit}&sort=relevance&type=link`,
      options,
    );
    return data.data.children.map(({ data: post }) => ({
      source: "reddit",
      title: post.title,
      url: `https://www.reddit.com${post.permalink}`,
      text: clip(`${post.title} ${post.selftext ?? ""}`),
      metrics: { subreddit: post.subreddit, score: post.score, comments: post.num_comments },
      publishedAt: post.created_utc ? new Date(post.created_utc * 1000).toISOString() : undefined,
    }));
  },
};

function cacheDir(root: string): string {
  return join(layout(root).forge, "evidence", "cache");
}

export function isSource(value: string): value is EvidenceSource {
  return (SOURCES as readonly string[]).includes(value);
}

/** Search a source (24h on-disk cache per source+query+limit). */
export async function searchEvidence(root: string, source: string, query: string, options: ConnectorOptions = {}): Promise<SearchResponse> {
  if (!isSource(source)) throw new EvidenceSourceError(`Unknown evidence source "${source}". Sources: ${SOURCES.join(", ")}`);
  if (!query.trim()) throw new EvidenceSourceError("A search query is required");
  const limit = Math.min(Math.max(options.limit ?? 10, 1), 30);
  const key = createHash("sha1").update(`${source}\n${query.trim()}\n${limit}`).digest("hex");
  const file = join(cacheDir(root), `${key}.json`);
  if (!options.fresh && existsSync(file)) {
    const cached = JSON.parse(readFileSync(file, "utf8")) as Omit<SearchResponse, "cached">;
    if (Date.now() - Date.parse(cached.fetchedAt) < CACHE_TTL_MS) return { ...cached, cached: true };
  }
  const results = await CONNECTORS[source](query.trim(), { ...options, limit });
  const response = { source, query: query.trim(), limit, fetchedAt: nowIso(), results };
  writeJsonAtomic(file, response);
  return { ...response, cached: false };
}

/** Every result seen by recent searches — used to verify quotes without refetching. */
export function cachedResults(root: string): SearchResult[] {
  const dir = cacheDir(root);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .flatMap((name) => {
      try {
        return (JSON.parse(readFileSync(join(dir, name), "utf8")) as SearchResponse).results;
      } catch {
        return [];
      }
    });
}
