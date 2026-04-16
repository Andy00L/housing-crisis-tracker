import type { MunicipalEntity } from "@/types";

/**
 * Census division entity data, keyed by 4-digit CDUID.
 *
 * Mirrors lib/municipal-data.ts for US counties. Initially empty;
 * the data pipeline will populate data/municipal/canada/*.json over time.
 * Once data files exist, import and concat them here like the US ones.
 */
const ALL: MunicipalEntity[] = [];

const BY_CDUID = new Map<string, MunicipalEntity>();
for (const m of ALL) {
  if (m?.fips) BY_CDUID.set(String(m.fips).padStart(4, "0"), m);
}

const BY_PROVINCE = new Map<string, MunicipalEntity[]>();
for (const m of ALL) {
  if (!m?.state) continue;
  const bucket = BY_PROVINCE.get(m.state) ?? [];
  bucket.push(m);
  BY_PROVINCE.set(m.state, bucket);
}

export function getAllCensusDivisions(): MunicipalEntity[] {
  return ALL;
}

export function getCensusDivisionByUid(
  cduid: string,
): MunicipalEntity | undefined {
  return BY_CDUID.get(String(cduid).padStart(4, "0"));
}

export function getCensusDivisionsByProvince(
  provinceName: string,
): MunicipalEntity[] {
  return BY_PROVINCE.get(provinceName) ?? [];
}
