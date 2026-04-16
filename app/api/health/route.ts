/**
 * Public health endpoint.
 *
 * GET /api/health
 *
 * Returns a snapshot of:
 *   - Per-source live status (data/raw/_health.json)
 *   - Per-pipeline latest run report (data/raw/_run-reports/)
 *
 * No auth. No API keys in the response. Safe to be world-readable.
 *
 * Consumers:
 *   - components/ui/HealthFooter.tsx   (UI freshness chip)
 *   - CI workflow step summaries
 *   - External monitoring / status page
 */

import { NextResponse } from "next/server";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { HealthFile, HealthStatus } from "@/lib/resilience/types";
import { latestReportsByPipeline } from "@/lib/resilience/run-report";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEALTH_PATH = join(process.cwd(), "data/raw/_health.json");

type OverallStatus = "healthy" | "degraded" | "down";

interface HealthEndpointResponse {
  overall: OverallStatus;
  last_updated: string;
  pipelines: Array<{
    name: string;
    status: string;
    last_run: string;
    entities_total: number;
    entities_successful: number;
    entities_failed: number;
    sources_fallback_used: string[];
    notes?: string[];
  }>;
  sources: HealthFile["sources"];
}

function readHealth(): HealthFile {
  if (!existsSync(HEALTH_PATH)) {
    return { updated_at: new Date().toISOString(), sources: {} };
  }
  try {
    return JSON.parse(readFileSync(HEALTH_PATH, "utf8")) as HealthFile;
  } catch {
    return { updated_at: new Date().toISOString(), sources: {} };
  }
}

function deriveOverall(file: HealthFile): OverallStatus {
  const statuses = Object.values(file.sources)
    .filter((s): s is NonNullable<typeof s> => !!s)
    .map((s) => s.status);
  if (statuses.length === 0) return "healthy";
  if (statuses.some((s: HealthStatus) => s === "down")) return "down";
  if (statuses.some((s: HealthStatus) => s === "degraded")) return "degraded";
  return "healthy";
}

export async function GET(): Promise<NextResponse<HealthEndpointResponse>> {
  const file = readHealth();
  const reports = latestReportsByPipeline();

  const pipelines = Object.values(reports).map((r) => ({
    name: r.pipeline,
    status: r.status,
    last_run: r.finished_at,
    entities_total: r.entities_total,
    entities_successful: r.entities_successful,
    entities_failed: r.entities_failed,
    sources_fallback_used: r.sources_fallback_used,
    notes: r.notes,
  }));

  const body: HealthEndpointResponse = {
    overall: deriveOverall(file),
    last_updated: file.updated_at,
    pipelines,
    sources: file.sources,
  };

  return NextResponse.json(body, {
    status: 200,
    headers: {
      "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
    },
  });
}
