/**
 * Health registry. Writes data/raw/_health.json with the current state of
 * every source the app talks to. Consumed by:
 *
 *   - app/api/health/route.ts  (public status JSON)
 *   - components/ui/HealthFooter.tsx  (UI freshness chip)
 *   - pipeline scripts that want to degrade gracefully when a source is down
 *
 * Behaviour:
 *   - recordSuccess / recordFailure update the in-memory registry
 *   - File is written every N updates (batched) or when flush() is called
 *   - On process exit, flush() is called so the last state lands on disk
 *   - Lifecycle events from the circuit breaker are also merged here
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  CircuitState,
  FailureReason,
  HealthFile,
  HealthStatus,
  SourceHealth,
  SourceName,
} from "./types.js";
import { getBreakerResetAt, onCircuitLifecycle } from "./circuit-breaker.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const HEALTH_PATH = join(ROOT, "data/raw/_health.json");

const BATCH_WRITE_EVERY = 20;
const ROLLING_WINDOW = 20;

interface SourceStats {
  /** 1 for success, 0 for failure. Ring buffer of last ROLLING_WINDOW calls. */
  ring: number[];
  last_success: string | null;
  last_failure: string | null;
  circuit_state: CircuitState;
  circuit_reopens_at: string | null;
  note: string | null;
}

const stats = new Map<SourceName, SourceStats>();
let pendingWrites = 0;
let loadedFromDisk = false;

function ensureSource(source: SourceName): SourceStats {
  let s = stats.get(source);
  if (!s) {
    s = {
      ring: [],
      last_success: null,
      last_failure: null,
      circuit_state: "closed",
      circuit_reopens_at: null,
      note: null,
    };
    stats.set(source, s);
  }
  return s;
}

function loadFromDisk(): void {
  if (loadedFromDisk) return;
  loadedFromDisk = true;
  if (!existsSync(HEALTH_PATH)) return;
  try {
    const raw = readFileSync(HEALTH_PATH, "utf8");
    const parsed = JSON.parse(raw) as HealthFile;
    for (const [name, h] of Object.entries(parsed.sources ?? {})) {
      if (!h) continue;
      const s = ensureSource(name as SourceName);
      s.last_success = h.last_success;
      s.last_failure = h.last_failure;
      s.circuit_state = h.circuit_state;
      s.circuit_reopens_at = h.circuit_reopens_at ?? null;
      s.note = h.note ?? null;
      // Restore failure rate as a single sample so future calls can refine.
      if (typeof h.rolling_failure_rate === "number") {
        // Seed one representative sample: 1 if recent success, else 0.
        s.ring = [h.rolling_failure_rate < 0.5 ? 1 : 0];
      }
    }
  } catch (err) {
    console.warn(
      `[health-registry] unreadable ${HEALTH_PATH}, starting fresh (${(err as Error).message})`,
    );
  }
}

function rollingFailureRate(s: SourceStats): number {
  if (s.ring.length === 0) return 0;
  const failures = s.ring.filter((v) => v === 0).length;
  return failures / s.ring.length;
}

function statusFrom(s: SourceStats): HealthStatus {
  if (s.circuit_state === "open") return "down";
  const rate = rollingFailureRate(s);
  if (rate > 0.5) return "down";
  if (rate > 0.1) return "degraded";
  return "healthy";
}

function buildHealth(s: SourceStats): SourceHealth {
  return {
    status: statusFrom(s),
    last_success: s.last_success,
    last_failure: s.last_failure,
    circuit_state: s.circuit_state,
    circuit_reopens_at: s.circuit_reopens_at ?? undefined,
    rolling_failure_rate: Number(rollingFailureRate(s).toFixed(3)),
    note: s.note ?? undefined,
  };
}

function pushOutcome(s: SourceStats, ok: boolean): void {
  s.ring.push(ok ? 1 : 0);
  if (s.ring.length > ROLLING_WINDOW) s.ring.shift();
}

function maybeWrite(force: boolean): void {
  pendingWrites += 1;
  if (!force && pendingWrites < BATCH_WRITE_EVERY) return;
  pendingWrites = 0;
  writeNow();
}

/** Force-flush the registry to disk. Called on process exit and at end of pipelines. */
export function flushHealth(): void {
  pendingWrites = 0;
  writeNow();
}

function writeNow(): void {
  const file: HealthFile = {
    updated_at: new Date().toISOString(),
    sources: {},
  };
  for (const [name, s] of stats.entries()) {
    file.sources[name] = buildHealth(s);
  }
  mkdirSync(dirname(HEALTH_PATH), { recursive: true });
  const tmp = `${HEALTH_PATH}.tmp`;
  writeFileSync(tmp, JSON.stringify(file, null, 2) + "\n");
  renameSync(tmp, HEALTH_PATH);
}

export function recordSuccess(source: SourceName): void {
  loadFromDisk();
  const s = ensureSource(source);
  pushOutcome(s, true);
  s.last_success = new Date().toISOString();
  s.note = null;
  maybeWrite(false);
}

export function recordFailure(
  source: SourceName,
  reason: FailureReason,
): void {
  loadFromDisk();
  const s = ensureSource(source);
  pushOutcome(s, false);
  s.last_failure = new Date().toISOString();
  s.note = friendlyNote(reason);
  maybeWrite(false);
}

export function getStatus(source: SourceName): HealthStatus {
  loadFromDisk();
  const s = stats.get(source);
  if (!s) return "healthy";
  return statusFrom(s);
}

export function getHealthSnapshot(): HealthFile {
  loadFromDisk();
  const file: HealthFile = {
    updated_at: new Date().toISOString(),
    sources: {},
  };
  for (const [name, s] of stats.entries()) {
    file.sources[name] = buildHealth(s);
  }
  return file;
}

function friendlyNote(reason: FailureReason): string {
  switch (reason.kind) {
    case "circuit-open":
      return `Circuit open until ${reason.retryAfter.toISOString()}`;
    case "timeout":
      return `Request timed out after ${reason.timeoutMs}ms`;
    case "http-error":
      return `HTTP ${reason.status}`;
    case "network-error":
      return `Network error: ${reason.message.slice(0, 120)}`;
    case "schema-mismatch":
      return `Schema mismatch (expected ${reason.expected})`;
    case "rate-limited":
      return `Rate limited until ${reason.retryAfter.toISOString()}`;
    case "budget-exhausted":
      return `Budget exhausted${reason.resetAt ? `, resets ${reason.resetAt.toISOString().slice(0, 10)}` : ""}`;
  }
}

// Wire up circuit breaker lifecycle events. Changes to breaker state are
// reflected immediately in the registry so the UI freshness chip can flip
// amber/red the moment a source trips.
onCircuitLifecycle((source, state) => {
  loadFromDisk();
  const s = ensureSource(source);
  s.circuit_state = state === "close" ? "closed" : (state as CircuitState);
  if (state === "open") {
    const resetAt = getBreakerResetAt(source);
    s.circuit_reopens_at = resetAt ? resetAt.toISOString() : null;
  } else {
    s.circuit_reopens_at = null;
  }
  maybeWrite(true);
});

// Flush on exit so the last state is on disk even after SIGINT.
let exitHooked = false;
function hookExit(): void {
  if (exitHooked) return;
  exitHooked = true;
  const flush = (): void => {
    try {
      flushHealth();
    } catch {
      // Best-effort; never block exit.
    }
  };
  process.on("exit", flush);
  process.on("SIGINT", () => {
    flush();
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    flush();
    process.exit(143);
  });
}
hookExit();
