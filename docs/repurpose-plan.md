# Repurpose Plan. Datacenter/Energy to Housing

Recorded 2026-04-16 as part of Phase C.
Source of truth for the file renames, type renames, and consumer migrations
that finish the pivot from AI/datacenter tracker to Canadian housing tracker.

## 1. What we observed in recon

- `lib/datacenters.ts` already returns `HousingProject[]` and reads from
  `ENTITIES[].projects`. The filename is the lie. The content is honest.
- `lib/energy-data.ts` is a 26 line stub. Every exported function returns
  `[]` or `null`. Dead weight kept alive so imports do not break.
- `lib/energy-colors.ts` still carries real data (EIA fuel palette and
  `plantRadius` helper). Used by `MapShell`, `CountyMap`, `EnergySection`.
- `components/map/DataCenterDots.tsx` already types its props as
  `HousingProject[]` and clusters by `unitCount`, not `capacityMw`.
- `components/panel/EnergySection.tsx` calls the stub and always renders
  "No energy profile available." on every entity. Unreachable content.
- `data/datacenters/` still holds `international.json` and `researched.json`
  from the pre-pivot era. No live consumer. Candidate for deletion.
- `data/energy/` folder is already gone.
- `data/projects/canada.json` is the live source, mapped by
  `scripts/build-placeholder.ts` into `Entity.projects`.
- HealthFooter at `components/ui/HealthFooter.tsx:258` links to
  `/about/data-sources`. The route does not exist yet.

## 2. Final file rename map

Git mv where possible so history follows.

| From | To | Rationale |
|---|---|---|
| `lib/datacenters.ts` | `lib/projects-map.ts` | Name describes the actual content. |
| `lib/energy-colors.ts` | `lib/project-colors.ts` | Palette repurposed to project status. |
| `lib/energy-data.ts` | DELETE | Pure stub, no housing analogue. |
| `components/map/DataCenterDots.tsx` | `components/map/ProjectDots.tsx` | Dots render projects. |
| `components/panel/EnergySection.tsx` | `components/panel/HousingMetricsSection.tsx` | Tab shows `Entity.housingMetrics`. |

Ancillary components keep their names for now. They are imports away from
confusion, not filenames: `DataCentersList.tsx`, `FacilityDetail.tsx`,
`DataCenterCard.tsx`, `MobileLegend.tsx`. Their bodies already reference
`HousingProject` fields.

## 3. Final type rename map

All already adapted in `types/index.ts`:

| Old concept | Current reality |
|---|---|
| `Facility` | Already `HousingProject` across the codebase. Add `@deprecated` alias `Facility = HousingProject` for one release. |
| `PowerPlant` | Stays only because `lib/energy-data.ts` type-references it. Removed with that file. |
| `FuelType`, `StateEnergyProfile` | Removed with `lib/energy-data.ts`. |

Export renames inside the new files:

| In `lib/projects-map.ts` | Before | After |
|---|---|---|
| primary list | `ALL_FACILITIES` | `ALL_HOUSING_PROJECTS` plus deprecated alias `ALL_FACILITIES` |
| primary accessor | `facilitiesForEntity` | `projectsForEntity` plus deprecated alias `facilitiesForEntity` |
| dropped | `US_FACILITIES`, `EU_FACILITIES`, `ASIA_FACILITIES` | removed (no housing data in those regions yet) |

Deprecated alias sunset: next release cycle. Every deprecated export has
`@deprecated` JSDoc so any future consumer gets a squiggle at import time.

## 4. Consumer by consumer action plan

14 confirmed importers of `lib/datacenters`. 4 of `lib/energy-data`. 3 of
`lib/energy-colors`. Plus downstream `DataCenterDots` consumers.

### 4.1 lib/datacenters consumers

| File | Category | Action |
|---|---|---|
| `components/map/MapShell.tsx` | A, C | Import from `lib/projects-map`. Drop `plantsInState`, `FUEL_COLOR`, `FUEL_LABEL`, `collapseFuel`. Remove the per-state plant mix overlay. |
| `components/map/NorthAmericaMap.tsx` | A | Import `ALL_HOUSING_PROJECTS` from `lib/projects-map`. Pass to `ProjectDots`. |
| `components/map/USStatesMap.tsx` | A | Drop `US_FACILITIES` import. Pass `[]` to `ProjectDots` for now (no US housing data). |
| `components/map/EuropeMap.tsx` | A | Same treatment. Drop `EU_FACILITIES`. Pass `[]`. |
| `components/map/AsiaMap.tsx` | A | Same. Drop `ASIA_FACILITIES`. Pass `[]`. |
| `components/map/CountyMap.tsx` | A, C | Drop `US_FACILITIES`, `plantsInState`, `plantsNearby`, `FUEL_COLOR`, `plantRadius`. Remove plant markers. Pass `[]` to dot renderer. |
| `components/panel/SidePanel.tsx` | B, C | Switch `facilitiesForEntity` import. Replace `EnergySection` with `HousingMetricsSection`. Drop `getStateProfile`, `plantsInState`. Rename the tab from "Energy" to "Metrics". |
| `components/sections/ProjectsOverview.tsx` | B | Switch import path. Rename `DC_COLOR` import source. |
| `components/panel/BillExpanded.tsx` | B | Switch import path (uses `ALL_FACILITIES` for related projects lookup). |
| `app/projects/[id]/page.tsx` | B | Switch `facilitiesForEntity` import. Update copy to "projects" where it still says "facilities". |
| `app/datacenters/[id]/page.tsx` | B | Redirect to `/projects/[id]` via `next.config.ts`. Delete the file. |
| `app/globe/page.tsx` | A | Switch import. Cluster and render housing projects. |
| `app/sandbox/cobe-hero/page.tsx` | D | Switch import. Sandbox, lower priority but fix the import so the build passes. |
| `components/map/sandbox/configs.ts` | D | Drop `US_FACILITIES`. Use `ALL_HOUSING_PROJECTS` or empty. Sandbox config. |

### 4.2 lib/energy-data consumers

| File | Action |
|---|---|
| `components/map/MapShell.tsx` | Remove `plantsInState` import and all call sites. The plant mix legend goes away. |
| `components/map/CountyMap.tsx` | Remove `plantsInState`, `plantsNearby` imports and the plant marker layer. |
| `components/panel/SidePanel.tsx` | Remove `getStateProfile`, `plantsInState` imports. Replaced by `HousingMetricsSection`. |
| `components/panel/EnergySection.tsx` | Rewritten as `HousingMetricsSection.tsx`. |

After these edits, `lib/energy-data.ts` has zero importers. Delete.

### 4.3 lib/energy-colors consumers

| File | Action |
|---|---|
| `components/map/MapShell.tsx` | Remove `FUEL_COLOR`, `FUEL_LABEL`, `collapseFuel` imports. Map legend no longer shows fuel mix. |
| `components/map/CountyMap.tsx` | Remove `FUEL_COLOR`, `plantRadius` imports. |
| `components/panel/EnergySection.tsx` | Replaced by `HousingMetricsSection.tsx`. |

Rename file to `lib/project-colors.ts`. Keep a deprecated `FUEL_COLOR` export
returning `#6b7280` for any third-party alias that may still exist. Remove
after one release.

### 4.4 DataCenterDots downstream consumers

Renaming the default export has a ripple. Update these imports:

| File | Action |
|---|---|
| `components/map/sandbox/ZoomableSvgMap.tsx` | `import DataCenterDots` to `import ProjectDots`. |
| `components/map/sandbox/GLMap.tsx` | `DC_COLOR` import path and source stay, just switch to `ProjectDots`. |
| `components/map/DataCenterCard.tsx` | Switch `DC_COLOR` source to `ProjectDots`. |
| `components/map/MobileLegend.tsx` | Switch `SIZE_BANDS` source. |
| `components/panel/DataCentersList.tsx` | Switch `DC_COLOR` source. |
| `components/panel/FacilityDetail.tsx` | Switch `DC_COLOR` source. |
| `components/sections/ProjectsOverview.tsx` | Already on the list. Same fix. |
| `components/map/CountyMap.tsx` | Switch `DcIcon, SIZE_BANDS` source. |
| Region maps | Each imports `DataCenterDots`. Switch default import name. |

`DC_COLOR` is the one cross-cutting symbol. It stays as `DC_COLOR` inside
`ProjectDots.tsx` even though the initials drift. Renaming at the export
site touches every downstream file without benefit. Documented with a
comment explaining the naming drift.

## 5. Schema migration notes

The runtime `HousingProject` shape in `types/index.ts` is already in place:

```ts
interface HousingProject {
  id: string;
  developer: string;
  projectName?: string;
  location?: string;
  state?: string;              // 2 letter province code on CA rows
  country?: string;            // "Canada"
  lat?: number;                // optional
  lng?: number;                // optional
  unitCount?: number;
  affordableUnits?: number;
  projectCost?: number;
  projectType?: "rental" | "condo" | "mixed" | "social" | "cooperative";
  status: "proposed" | "under-construction" | "operational";
  yearProposed?: number;
  yearCompleted?: number;
  notes?: string;
  concerns?: ImpactTag[];
  source?: string;
  proposal?: ProposalInfo;
}
```

Decision on geocoding. Coordinates in `HousingProject` use `lat`/`lng`,
not `latitude`/`longitude`. The helper added in `lib/projects-map.ts`
returns the same keys for consistency. The fallback matrix is city first,
then province centroid, then null (dot renderer filters nulls).

## 6. What we drop entirely

- `lib/energy-data.ts` (all exports are stubs)
- `PowerPlant`, `FuelType`, `StateEnergyProfile` types in `types/index.ts`
  once no file references them.
- `US_FACILITIES`, `EU_FACILITIES`, `ASIA_FACILITIES` from `lib/projects-map.ts`.
  We have no US, EU, or Asian housing project data today.
- Plant markers and fuel mix legend in MapShell, CountyMap, SidePanel.
- Old scripts: `datacenters-epoch.ts`, `datacenters-international.ts`,
  `datacenters-researched.ts`, `eia-plants.ts`, `eia-state-profiles.ts`,
  `water-features.ts`. Confirm they do not exist. If they do, delete with
  consumer audit first.
- `data/datacenters/` folder and any stale `data/energy/`.

## 7. Backward compat routes

`/datacenters/[id]` stays reachable for external bookmarks. Implementation:

```ts
// next.config.ts
async redirects() {
  return [
    { source: "/datacenters/:id", destination: "/projects/:id", permanent: true },
  ];
}
```

Permanent 301 so search engines update. Then delete
`app/datacenters/[id]/page.tsx`. Then delete the empty
`app/datacenters/` directory.

## 8. Build gating strategy

Run `npm run build` after each major edit, never in batches:

1. After creating `lib/projects-map.ts` (expect failures, that is the
   signal that consumers are found).
2. After migrating each of the ~14 consumers, one at a time.
3. After renaming `DataCenterDots.tsx` to `ProjectDots.tsx` (triggers
   another ~8 import fixes).
4. After deleting `lib/energy-data.ts`.
5. After the `/datacenters/[id]` redirect swap.

A single broken state at the end is hard to diagnose. Incremental is
cheaper than heroic.

## 9. Rollback plan

If the build goes red and the cause is not immediately obvious:

- Every rename is a `git mv`. `git checkout -- <file>` restores.
- Deletions are staged, not pushed. `git restore --staged` plus
  `git checkout --` brings files back.
- The deprecated aliases (`ALL_FACILITIES`, `Facility`,
  `facilitiesForEntity`) mean an incomplete consumer migration still
  builds.
- If a particular consumer resists, leave the deprecated alias pointing at
  the new name and move on. The file ships. The TODO gets captured in the
  run report.

## 10. Out of scope for this prompt

- Rewriting `DataCentersList.tsx`, `FacilityDetail.tsx`, and
  `DataCenterCard.tsx` file names. Their bodies are already correct, the
  filenames can be sorted in a follow-up.
- Moving `DC_COLOR` to a better home (its initials still read "data
  center" but every consumer uses it for housing project status).
- Pruning `PowerPlant` and `FuelType` from `types/index.ts` on the very
  same pass. Done in Phase C.3 after the energy layer is gone.
