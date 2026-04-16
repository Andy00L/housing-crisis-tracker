/**
 * Public entry point for every external HTTP call in pipeline + sync scripts.
 *
 * Layers it applies, in order:
 *   1. Rate limit (per-source token bucket)
 *   2. Circuit breaker (opossum, per source)
 *   3. Timeout (via the breaker)
 *   4. Retry (exponential backoff; only retries on 5xx / 429 / network errors)
 *   5. Content-Type check
 *   6. Optional schema validator
 *   7. Records success/failure to the health registry
 *
 * No pipeline script should ever call `fetch()` directly. Everything that
 * hits an external URL goes through here.
 *
 * Example:
 *
 *     const res = await resilientFetch<LegisBill[]>(
 *       "legisinfo",
 *       "https://www.parl.ca/legisinfo/en/bills/json?text=housing&parlsession=45-1",
 *       { validator: (x): x is LegisBill[] => Array.isArray(x) },
 *     );
 *     if (!res.ok) {
 *       if (res.reason.kind === "circuit-open") return fallback();
 *       throw new Error(`legisinfo failed: ${res.reason.kind}`);
 *     }
 *     use(res.data);
 */

import {
  getBreaker,
  getBreakerResetAt,
  getBreakerTimeout,
  isBreakerOpen,
} from "./resilience/circuit-breaker.js";
import {
  recordFailure,
  recordSuccess,
} from "./resilience/health-registry.js";
import { acquire } from "./resilience/rate-limit.js";
import type {
  FailureReason,
  FetchResult,
  ResilientFetchOptions,
  SourceName,
} from "./resilience/types.js";

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_CONTENT_TYPE = "application/json";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function backoffMs(attempt: number): number {
  // 1s, 2s, 4s. Jitter to avoid thundering herds.
  const base = 1000 * Math.pow(2, attempt);
  const jitter = Math.floor(Math.random() * 200);
  return base + jitter;
}

function isNetworkError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? String(err);
  return /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|EAI_AGAIN|network|failed to fetch/i.test(
    msg,
  );
}

function isOpossumTimeout(err: unknown): boolean {
  const e = err as { code?: string; message?: string };
  return e?.code === "ETIMEDOUT" || /timed? ?out/i.test(e?.message ?? "");
}

function isOpossumOpen(err: unknown): boolean {
  const e = err as { code?: string; message?: string };
  return (
    e?.code === "EOPENBREAKER" ||
    /breaker is open/i.test(e?.message ?? "") ||
    /^Circuit\b.*(open|disabled)/i.test(e?.message ?? "")
  );
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  // Delta seconds
  const asInt = Number(header);
  if (!Number.isNaN(asInt) && Number.isFinite(asInt)) return asInt * 1000;
  // HTTP-date
  const t = Date.parse(header);
  if (!Number.isNaN(t)) return Math.max(0, t - Date.now());
  return null;
}

/**
 * Drain and safely read the response body.
 *
 * Single-read policy from REFERENCE_SECURITY_AUDIT: never call .json() and
 * .text() on the same response. Always read as text, parse conditionally.
 */
async function readBody(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch (err) {
    console.warn(`[resilient-fetch] body read failed: ${(err as Error).message}`);
    return "";
  }
}

function parseJsonSafe(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function resilientFetch<T = unknown>(
  source: SourceName,
  url: string,
  options: ResilientFetchOptions<T> = {},
): Promise<FetchResult<T>> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const expectContentType =
    options.expectContentType === null
      ? null
      : (options.expectContentType ?? DEFAULT_CONTENT_TYPE);
  const retryable4xx = new Set(options.retryable4xx ?? []);

  // Fast path: breaker already open. Fail immediately, let the caller decide.
  if (isBreakerOpen(source)) {
    const resetAt = getBreakerResetAt(source) ?? new Date(Date.now() + 3_600_000);
    const reason: FailureReason = { kind: "circuit-open", source, retryAfter: resetAt };
    recordFailure(source, reason);
    return { ok: false, reason };
  }

  await acquire(source);

  const breaker = getBreaker(source);
  let lastReason: FailureReason | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let reason: FailureReason | null = null;

    try {
      const init: RequestInit = {
        method: "GET",
        ...options.init,
        headers: {
          "user-agent": "housing-crisis-tracker/1.0 (+https://github.com)",
          accept: expectContentType ?? "*/*",
          ...(options.init?.headers as Record<string, string> | undefined),
        },
      };

      const response = await breaker.fire(url, init);

      // Success HTTP status: 2xx-3xx redirects handled by fetch already.
      if (response.ok) {
        if (expectContentType) {
          const ct = response.headers.get("content-type") ?? "";
          if (!ct.toLowerCase().startsWith(expectContentType.toLowerCase())) {
            const text = await readBody(response);
            reason = {
              kind: "schema-mismatch",
              source,
              expected: `Content-Type starting with ${expectContentType}`,
              receivedKeys: [`content-type: ${ct}`, `body[0..120]: ${text.slice(0, 120)}`],
            };
            recordFailure(source, reason);
            return { ok: false, reason };
          }
        }
        const text = await readBody(response);
        const parsed = expectContentType?.includes("json") ? parseJsonSafe(text) : text;

        if (options.validator && !options.validator(parsed)) {
          reason = {
            kind: "schema-mismatch",
            source,
            expected: "validator passed",
            receivedKeys: Object.keys((parsed as Record<string, unknown>) ?? {}).slice(0, 6),
          };
          recordFailure(source, reason);
          return { ok: false, reason };
        }

        recordSuccess(source);
        return { ok: true, data: parsed as T, source };
      }

      // Non-2xx. Decide whether to retry.
      if (response.status === 429) {
        const waitMs = parseRetryAfter(response.headers.get("retry-after"));
        const retryAfter = new Date(Date.now() + (waitMs ?? backoffMs(attempt)));
        reason = { kind: "rate-limited", source, retryAfter };
        if (attempt < maxAttempts - 1) {
          await sleep(waitMs ?? backoffMs(attempt));
          continue;
        }
      } else if (response.status >= 500 && response.status < 600) {
        const text = await readBody(response);
        reason = { kind: "http-error", source, status: response.status, body: text.slice(0, 300) };
        if (attempt < maxAttempts - 1) {
          await sleep(backoffMs(attempt));
          continue;
        }
      } else if (retryable4xx.has(response.status)) {
        const text = await readBody(response);
        reason = { kind: "http-error", source, status: response.status, body: text.slice(0, 300) };
        if (attempt < maxAttempts - 1) {
          await sleep(backoffMs(attempt));
          continue;
        }
      } else {
        // 4xx final (non-retryable).
        const text = await readBody(response);
        reason = { kind: "http-error", source, status: response.status, body: text.slice(0, 300) };
      }
    } catch (err) {
      if (isOpossumOpen(err)) {
        const resetAt = getBreakerResetAt(source) ?? new Date(Date.now() + 3_600_000);
        reason = { kind: "circuit-open", source, retryAfter: resetAt };
      } else if (isOpossumTimeout(err)) {
        reason = { kind: "timeout", source, timeoutMs: getBreakerTimeout(source) };
        // Timeout is worth retrying once or twice.
        if (attempt < maxAttempts - 1) {
          await sleep(backoffMs(attempt));
          lastReason = reason;
          continue;
        }
      } else if (isNetworkError(err)) {
        reason = {
          kind: "network-error",
          source,
          message: (err as Error).message ?? String(err),
        };
        if (attempt < maxAttempts - 1) {
          await sleep(backoffMs(attempt));
          lastReason = reason;
          continue;
        }
      } else {
        reason = {
          kind: "network-error",
          source,
          message: (err as Error).message ?? String(err),
        };
      }
    }

    lastReason = reason ?? lastReason;

    // Reached the end of attempts. Record and return.
    if (reason) {
      recordFailure(source, reason);
      return { ok: false, reason };
    }
  }

  // Exhausted attempts. Return the last reason (or a synthetic one if
  // somehow nothing was recorded).
  const fallback: FailureReason = lastReason ?? {
    kind: "network-error",
    source,
    message: `Exhausted ${maxAttempts} attempts with no concrete failure reason`,
  };
  recordFailure(source, fallback);
  return { ok: false, reason: fallback };
}
