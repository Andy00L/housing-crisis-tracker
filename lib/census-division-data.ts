import type { MunicipalEntity } from "@/types";

import quebec from "@/data/municipal/quebec.json";
import ontario from "@/data/municipal/ontario.json";
import alberta from "@/data/municipal/alberta.json";
import newBrunswick from "@/data/municipal/new-brunswick.json";

/**
 * Census division entity data, keyed by 4-digit CDUID.
 *
 * Mirrors lib/municipal-data.ts for US counties. Data files live in
 * data/municipal/ alongside the US state files, using the same
 * MunicipalEntity shape with `fips` holding the 4-digit CDUID.
 */
const ALL: MunicipalEntity[] = ([] as unknown[])
  .concat(quebec, ontario, alberta, newBrunswick)
  .filter(Boolean) as MunicipalEntity[];

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
