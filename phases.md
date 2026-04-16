# Housing Crisis Tracker — Phases d'implementation

> **Date :** 2026-04-15
> **Repo :** `track-policy` (gov-index@0.1.0)
> **Reference :** Voir `upgrade.md` pour le rapport de recherche complet

---

## Prerequis — ce que tu dois faire avant qu'on commence

### 1. Installer les dependances

```bash
npm install
```

Verifie que ca fonctionne avec :

```bash
npm run dev
```

Si `next` n'est toujours pas reconnu apres `npm install`, essaie :

```bash
npx next dev
```

### 2. Creer les cles API

| Cle                 | Ou s'inscrire                                                               | Temps     | Obligatoire        |
| ------------------- | --------------------------------------------------------------------------- | --------- | ------------------ |
| `ANTHROPIC_API_KEY` | Tu l'as deja si tu as utilise track-policy                                  | —         | Oui                |
| `LEGISCAN_API_KEY`  | `https://legiscan.com/legiscan` — compte gratuit, cle dans le profil        | 2 min     | Oui (bills US)     |
| `FRED_API_KEY`      | `https://fred.stlouisfed.org/docs/api/api_key.html` — inscription par email | 2 min     | Oui (metriques US) |
| `CANLII_API_KEY`    | Formulaire de contact sur `https://www.canlii.org/` — expliquer le projet   | 1-5 jours | Non, nice-to-have  |

### 3. Creer `.env.local` a la racine du repo

```
ANTHROPIC_API_KEY=sk-ant-...
LEGISCAN_API_KEY=...
FRED_API_KEY=...
```

Ce fichier est deja dans `.gitignore` (pattern `.env*` a la ligne 10).

### 4. Decisions a me communiquer

- **Nom du projet** — ex: "housing-tracker", "shelter-watch", "home-crisis", ou garder "gov-index" ?
- **Langue du site** — anglais seulement ou bilingue EN/FR ?
- **Vercel KV** — tu as un projet Vercel avec KV, ou on retire le widget visiteurs ?
- **Domaine prevu** — pour les balises `<title>`, Open Graph, etc.

---

## Vue d'ensemble des 12 phases

```
Phase 0    Setup & hygiene                    aucun code metier
Phase 1    Types & contrats                   schema de donnees
Phase 2    Pipeline Canada — legislation      premiers JSON
Phase 3    Pipeline Canada — metriques        chiffres concrets
Phase 4    Pipeline USA — legislation         adapter LegiScan
Phase 5    Pipeline USA — metriques           FRED + Zillow + Census
Phase 6    Pipeline UK + EU                   3 APIs + Claude research
Phase 7    Pipeline Australie + Asia          ABS + HDB + HK
Phase 8    Pipeline global + News RSS         OECD + feeds
Phase 9    UI — carte & navigation            MapShell drill-down
Phase 10   UI — sections & composants         page d'accueil
Phase 11   Automatisation GitHub Actions      3 workflows
Phase 12   Polish & verification              nettoyage final
```

Chaque phase produit un resultat testable. On ne passe a la suivante que si la precedente compile/fonctionne.

---

## Phase 0 — Setup & hygiene

> Aucun code metier. Preparer le terrain.

### Objectif

Le repo build, les dossiers existent, le nommage est a jour.

### Actions

**0.1 — Creer les dossiers de donnees**

```
data/legislation/provinces/          ← bills provinciaux CA
data/legislation/uk/                 ← bills UK
data/housing/canada/                 ← metriques CA
data/housing/us/                     ← metriques US
data/housing/uk/                     ← metriques UK
data/housing/eu/                     ← metriques EU
data/housing/asia/                   ← metriques Asia-Pacific
data/housing/global/                 ← metriques cross-country
data/raw/legisinfo/                  ← cache LEGISinfo
data/raw/statcan/                    ← cache StatsCan
data/raw/cmhc/                       ← cache CMHC
data/raw/fred/                       ← cache FRED
data/raw/zillow/                     ← cache Zillow
data/raw/eurostat/                   ← cache Eurostat
data/raw/uk-bills/                   ← cache UK Bills
data/raw/uk-landregistry/            ← cache UK Land Registry
data/raw/abs/                        ← cache ABS Australia
data/raw/oecd/                       ← cache OECD
```

**0.2 — Mettre a jour `.gitignore`**

Fichier actuel : `.gitignore`
La ligne 44 contient deja `/data/raw` — les nouveaux sous-dossiers sont automatiquement ignores. Rien a changer.

**0.3 — Mettre a jour `package.json`**

Changer :

- `"name"` : `"gov-index"` → nouveau nom du projet
- `"description"` : adapter

**0.4 — Verifier le build**

```bash
npm install
npm run dev      # doit demarrer sans erreur
npm run build    # doit compiler
```

### Validation

- `npm run dev` demarre sur localhost:3000
- `npm run build` passe sans erreur
- Les dossiers `data/housing/` et `data/raw/` existent

---

## Phase 1 — Types & contrats

> Definir le schema de donnees AVANT de toucher au UI ou aux pipelines. Ca force la coherence.

### Objectif

Tous les types TypeScript sont adaptes au logement. Le build passe (avec des donnees vides).

### Fichiers modifies

#### `types/index.ts`

**ImpactTag** (lignes 148-178) — remplacer les 24 tags AI par ~20 tags logement :

```
Actuel : "water-consumption" | "carbon-emissions" | "grid-capacity" | "ai-safety" | ...

Nouveau : "affordability" | "displacement" | "density" | "lot-splitting" |
  "inclusionary-zoning" | "rent-stabilization" | "social-housing" |
  "foreign-buyer" | "first-time-buyer" | "homelessness" |
  "transit-oriented" | "environmental-review" | "nimby" |
  "community-opposition" | "vacancy-tax" | "short-term-rental" |
  "heritage-protection" | "mortgage-regulation" | "public-land" |
  "indigenous-housing"
```

**LegislationCategory** (lignes 180-190) — remplacer les 10 categories AI :

```
Actuel : "data-center-siting" | "data-center-energy" | "ai-governance" | ...

Nouveau : "zoning-reform" | "rent-regulation" | "affordable-housing" |
  "development-incentive" | "building-code" | "foreign-investment" |
  "homelessness-services" | "tenant-protection" | "transit-housing" |
  "property-tax"
```

**Dimension** (lignes 192-204) — remplacer :

```
Actuel : "overall" | "environmental" | "energy" | "community" | "land-use" |
  "ai-governance-dim" | "ai-consumer" | "ai-workforce" | "ai-public" | "ai-synthetic"

Nouveau : "overall" | "affordability" | "supply" | "rental-market" |
  "ownership" | "social-housing" | "environmental" | "community-impact"
```

**DimensionLens** (ligne 206) — remplacer :

```
Actuel : "datacenter" | "ai"
Nouveau : "zoning" | "affordability"
```

**DataCenter interface** (lignes 487-506) — renommer en `HousingProject` et adapter :

```
operator       → developer
capacityMW     → unitCount
costUSD        → projectCost
computeH100e   → (supprimer)
primaryUser    → (supprimer)
+ affordableUnits?: number
+ projectType?: "rental" | "condo" | "mixed" | "social" | "cooperative"
```

**Entity interface** (lignes 434-458) — ajouter/renommer :

```
stanceDatacenter → stanceZoning
stanceAI         → stanceAffordability
+ housingMetrics?: HousingMetrics
```

**Ajouter `HousingMetrics` interface** (nouveau) :

```typescript
interface HousingMetrics {
  nhpiIndex?: number;
  nhpiChangeYoY?: number;
  medianHomePrice?: number;
  priceToIncomeRatio?: number;
  vacancyRate?: number;
  avgRent?: number;
  avgRentChangeYoY?: number;
  priceToRentRatio?: number;
  startsQuarterly?: number;
  completionsQuarterly?: number;
  mortgageRate?: number;
  currency?: string;
  lastUpdated?: string;
}
```

#### `lib/dimensions.ts`

**DIMENSION_TAGS** (lignes 8-38) — remplacer le mapping dimension → tags :

```
Chaque dimension logement mappe vers ses ImpactTag pertinents.
Ex : "affordability" → ["affordability", "displacement", "first-time-buyer", "foreign-buyer"]
Ex : "supply" → ["density", "lot-splitting", "transit-oriented", "nimby"]
```

**DIMENSION_COLOR** (lignes 44-59) — nouvelle palette :

```
Garder la structure Record<Dimension, string>, changer les hex.
```

**DIMENSION_GRADIENT** (lignes 85-100) — nouveaux gradients :

```
Garder la structure Record<Dimension, { from: string, to: string }>, changer les couleurs.
```

**DATACENTER_DIMENSIONS** (lignes 208-213) → renommer `ZONING_DIMENSIONS`
**AI_DIMENSIONS** (lignes 215-221) → renommer `AFFORDABILITY_DIMENSIONS`

**getEntityColorForDimension** (lignes 139-151) — adapter les references :

```
entity.stanceDatacenter → entity.stanceZoning
entity.stanceAI → entity.stanceAffordability
```

#### Cascade de corrections TypeScript

Apres ces changements, il y aura des erreurs TS partout ou le code reference les anciens types. Pour que le build passe a cette phase, il faudra aussi faire des find-replace dans :

- Toute reference a `stanceDatacenter` → `stanceZoning`
- Toute reference a `stanceAI` → `stanceAffordability`
- Toute reference a `"datacenter"` (lens) → `"zoning"`
- Toute reference a `"ai"` (lens) → `"affordability"`
- Toute reference a `DataCenter` (type) → `HousingProject`

Fichiers impactes (grep dans le repo) :

- `components/map/MapShell.tsx`
- `components/sections/SummaryBar.tsx`
- `components/sections/DimensionToggle.tsx`
- `components/sections/DataCentersOverview.tsx`
- `components/panel/SidePanel.tsx`
- `components/panel/FacilityDetail.tsx`
- `components/panel/DataCentersList.tsx`
- `components/map/DataCenterDots.tsx`
- `components/map/DataCenterCard.tsx`
- `lib/datacenters.ts`
- `lib/dimensions.ts`
- `lib/placeholder-data.ts`
- `scripts/build-placeholder.ts`
- `app/page.tsx`
- `app/datacenters/page.tsx`
- `app/datacenters/[id]/page.tsx`

### Validation

- `npm run lint` passe sans erreurs de type
- `npm run build` compile (le site peut afficher des donnees vides/placeholder)

---

## Phase 2 — Pipeline Canada : legislation

> La priorite #1. Les bills federaux et provinciaux canadiens.

### Objectif

`data/legislation/federal-ca.json` et `data/legislation/provinces/*.json` existent avec des donnees reelles.

### Scripts a creer

#### `scripts/sync/canada-legislation.ts`

**Input :** LEGISinfo JSON feed
**Output :** `data/legislation/federal-ca.json`
**API :** `GET https://www.parl.ca/legisinfo/en/bills/json?text={keyword}&parlsession=45-1`
**Auth :** Aucune
**Cache :** `data/raw/legisinfo/`

Logique :

1. Pour chaque mot-cle (`housing`, `zoning`, `affordable`, `rental`, `residential`, `logement`, `habitation`) :
   - Fetch le JSON de LEGISinfo
   - Dedup par `BillId`
2. Pour chaque bill unique :
   - Map `CurrentStatusEn` → `Stage` :
     - "At first reading" / "At introduction" → `"Filed"`
     - "At committee" / "At report stage" → `"Committee"`
     - "At second reading" / "At third reading" → `"Floor"`
     - "Royal Assent" → `"Enacted"`
     - "Defeated" / "Prorogued" → `"Dead"`
   - Classifier avec les nouvelles heuristiques de `legislation-classify.ts`
3. Ecrire `data/legislation/federal-ca.json` au format :

```json
{
  "state": "Canada",
  "stateCode": "CA",
  "region": "na",
  "stance": "review",
  "stanceZoning": "review",
  "stanceAffordability": "favorable",
  "lastUpdated": "2026-04-15",
  "contextBlurb": "...",
  "legislation": [...]
}
```

#### `scripts/sync/bc-legislation.ts`

**Input :** BC Laws XML search API
**Output :** `data/legislation/provinces/BC.json`
**API :** `GET https://www.bclaws.gov.bc.ca/civix/search/complete/fullsearch?q=housing&s=0&e=20`
**Auth :** Aucune
**Cache :** `data/raw/bclaws/`

Logique :

1. Chercher "housing", "zoning", "residential tenancy", "strata"
2. Parser le XML (utiliser le DOMParser natif ou `fast-xml-parser`)
3. Extraire les documents pertinents
4. Ecrire `data/legislation/provinces/BC.json`

#### Provinces sans API (ON, QC, AB, etc.)

Pour la Phase 2, on cree les fichiers provinciaux initiaux via le pattern existant de Claude research (`scripts/sync/international.ts`). Adapter le prompt pour rechercher la legislation logement provinciale.

### Fichier a modifier

#### `scripts/sync/legislation-classify.ts`

**classifyCategory** (ligne ~208) — nouvelles regles de mots-cles :

| Categorie               | Mots-cles                                                          |
| ----------------------- | ------------------------------------------------------------------ |
| `zoning-reform`         | zoning, rezone, density, setback, lot split, ADU, duplex, fourplex |
| `rent-regulation`       | rent control, rent stabilization, rent cap, rent freeze            |
| `affordable-housing`    | affordable, inclusionary, below-market, subsidized, social housing |
| `development-incentive` | tax increment, opportunity zone, fast-track, expedited, incentive  |
| `building-code`         | building code, fire safety, accessibility, energy efficiency       |
| `foreign-investment`    | foreign buyer, non-resident, beneficial ownership, vacancy tax     |
| `homelessness-services` | homeless, shelter, supportive housing, encampment                  |
| `tenant-protection`     | eviction, just cause, relocation, habitability, tenant             |
| `transit-housing`       | transit-oriented, TOD, station area, corridor                      |
| `property-tax`          | property tax, assessment, exemption, abatement                     |

**classifyTags** (ligne ~215) — nouvelles regles.

**deriveStance** (ligne ~223) — nouvelle logique :

- Moratorium / restriction / ban → `"restrictive"`
- Study / commission / review → `"review"`
- Incentive / upzone / density bonus → `"favorable"`
- Mixed / unclear → `"concerning"`

### Validation

- `data/legislation/federal-ca.json` existe avec 5+ bills
- `data/legislation/provinces/BC.json` existe
- Au moins 3 autres fichiers provinciaux (ON, QC, AB) existent
- Les bills ont des categories, tags, et stances valides

---

## Phase 3 — Pipeline Canada : metriques

> Les chiffres concrets : prix, loyers, vacance, mises en chantier.

### Objectif

`data/housing/canada/*.json` contient des metriques reelles de StatsCan et CMHC.

### Scripts a creer

#### `scripts/sync/statcan-housing.ts`

**Output :** `data/housing/canada/nhpi.json`, `starts.json`, `cpi-shelter.json`
**API :** `POST https://www150.statcan.gc.ca/t1/wds/rest/getDataFromCubePidCoordAndLatestNPeriods`
**Auth :** Aucune

Tables a fetcher :

| ProductId  | Table                      | Periodes              |
| ---------- | -------------------------- | --------------------- |
| `18100205` | NHPI                       | 12 derniers mois      |
| `34100135` | Housing starts/completions | 8 derniers trimestres |
| `18100004` | CPI Shelter                | 12 derniers mois      |

Pour chaque table :

1. POST `getCubeMetadata` pour decouvrir les coordonnees geographiques
2. POST `getDataFromCubePidCoordAndLatestNPeriods` pour chaque geographie
3. Structurer le resultat :

```json
{
  "table": "18100205",
  "name": "New Housing Price Index",
  "lastUpdated": "2026-03-20",
  "geographies": {
    "Canada": { "values": [{"period": "2026-02", "value": 121.9}, ...] },
    "Ontario": { "values": [...] },
    "Toronto": { "values": [...] }
  }
}
```

4. Cache brut dans `data/raw/statcan/`
5. Ecrire le JSON processe dans `data/housing/canada/`

#### `scripts/sync/cmhc-housing.ts`

**Output :** `data/housing/canada/cmhc-rental.json`, `cmhc-starts.json`
**API :** `POST https://www03.cmhc-schl.gc.ca/hmip-pimh/en/TableMapChart/ExportTable`
**Auth :** Cookies de session (risque : endpoint non-documente)

Tables a fetcher :

| TableId    | Contenu                                         |
| ---------- | ----------------------------------------------- |
| `2.1.31.2` | Statistiques sommaires locatives (par province) |
| `2.1.31.3` | Statistiques sommaires locatives (par CMA)      |
| `1.1.1.2`  | Mises en chantier par type (par province)       |

Logique :

1. POST avec `TableId` + `GeographyId` + `GeographyTypeId`
2. Parser le CSV retourne
3. Extraire : vacancy rate, average rent, housing starts
4. Cache dans `data/raw/cmhc/`
5. Ecrire le JSON dans `data/housing/canada/`

### Fichier a modifier

#### `scripts/build-placeholder.ts`

Modifier la fonction qui construit les entites canadiennes (lignes 180-195) :

- Au lieu d'une seule entite Canada hardcodee, construire 1 entite federale + 13 entites provinciales
- Lire `data/legislation/federal-ca.json` et `data/legislation/provinces/*.json`
- Lire `data/housing/canada/*.json` pour les `housingMetrics`
- Fusionner legislation + metriques + figures dans chaque entite

### Validation

- `data/housing/canada/nhpi.json` contient des donnees pour Canada + 10 provinces + CMAs
- `data/housing/canada/cmhc-rental.json` contient vacancy rates + loyers
- `npm run data:rebuild` genere un `lib/placeholder-data.ts` avec les entites canadiennes
- Chaque entite provinciale a un `housingMetrics` non-vide

---

## Phase 4 — Pipeline USA : legislation

> Adapter le pipeline LegiScan existant aux mots-cles logement.

### Objectif

`data/legislation/states/*.json` contient des bills de logement (pas d'AI).

### Fichiers a modifier

#### `scripts/sync/legislation-ingest.ts`

**KEYWORDS** (ligne 36) — remplacer :

```
Actuel :  ["data center", "artificial intelligence", "deepfake", "facial recognition"]
Nouveau : ["housing", "zoning", "affordable housing", "rent control",
           "building permit", "homelessness", "tenant protection",
           "inclusionary zoning", "eviction", "residential"]
```

Tout le reste du script (cache, budget, dedup, juridictions) reste identique.

#### `scripts/sync/legislation-classify.ts`

Deja modifie en Phase 2. S'applique aussi aux bills US.

### Execution

```bash
# Vider le cache des anciens bills AI
rm -rf data/raw/legiscan/bills/
rm -rf data/raw/legiscan/search/
rm -rf data/raw/legiscan/detail/

# Re-ingest avec les nouveaux mots-cles
npx tsx scripts/sync/legislation-ingest.ts

# Re-classifier
npx tsx scripts/sync/legislation-classify.ts
```

**Budget API :** ~10 mots-cles × 51 juridictions = 510 recherches + ~600 getBill = ~1,110 queries (dans le budget de 5,000/run).

### Renommage

`data/legislation/federal.json` → `data/legislation/federal-us.json` (pour distinguer du `federal-ca.json` canadien)

### Validation

- 50 fichiers `data/legislation/states/*.json` avec des bills logement
- `data/legislation/federal-us.json` avec des bills federaux logement
- Les categories sont des categories logement (zoning-reform, rent-regulation, etc.)
- `npm run data:rebuild` integre les bills US

---

## Phase 5 — Pipeline USA : metriques

> Prix, loyers, vacancy, mortgage rates pour les 50 etats.

### Objectif

`data/housing/us/*.json` contient des metriques reelles pour tous les etats.

### Scripts a creer

#### `scripts/sync/fred-housing.ts`

**Output :** `data/housing/us/case-shiller.json`, `fred-starts.json`, `fred-mortgage.json`
**API :** `GET https://api.stlouisfed.org/fred/series/observations?series_id={ID}&api_key={KEY}&file_type=json&sort_order=desc&limit=12`
**Auth :** `FRED_API_KEY` (`.env.local`)

Series a fetcher :

| Series ID      | Contenu                                | Frequence    |
| -------------- | -------------------------------------- | ------------ |
| `CSUSHPISA`    | Case-Shiller National Home Price Index | Mensuel      |
| `HOUST`        | Housing Starts                         | Mensuel      |
| `MORTGAGE30US` | 30-Year Mortgage Rate                  | Hebdomadaire |
| `RRVRUSQ156N`  | Rental Vacancy Rate                    | Trimestriel  |
| `USSTHPI`      | All-Transactions House Price Index     | Trimestriel  |

Pour les series par etat (ex: `USSTHPI` a des variantes par etat comme `AZSTHPI` pour Arizona), fetcher les 50 variantes.

#### `scripts/sync/zillow-housing.ts`

**Output :** `data/housing/us/zillow-zhvi.json`, `zillow-zori.json`
**API :** Telechargement direct CSV, aucune auth

URLs :

```
State ZHVI : https://files.zillowstatic.com/research/public_csvs/zhvi/State_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv
Metro ZORI : https://files.zillowstatic.com/research/public_csvs/zori/Metro_zori_uc_sfrcondomfr_sm_sa_month.csv
```

Logique :

1. Download les CSV (298 KB + 981 KB)
2. Parser : extraire derniere colonne (valeur actuelle) + colonne -12 mois (pour % changement)
3. Structurer par etat/metro
4. Ecrire le JSON

#### `scripts/sync/census-housing.ts`

**Output :** `data/housing/us/census-housing.json`
**API :** `GET https://api.census.gov/data/2023/acs/acs1?get=NAME,B25077_001E,B25064_001E,B25001_001E&for=state:*`
**Auth :** Aucune

Champs :

- `B25077_001E` — Median home value
- `B25064_001E` — Median gross rent
- `B25001_001E` — Total housing units

### Modifier `scripts/build-placeholder.ts`

- Lire `data/housing/us/*.json`
- Pour chaque etat, ajouter `housingMetrics` a l'entite

### Validation

- `data/housing/us/case-shiller.json` avec 12 mois de donnees
- `data/housing/us/zillow-zhvi.json` avec prix par etat
- `data/housing/us/census-housing.json` avec median value + rent par etat
- Chaque entite US dans `lib/placeholder-data.ts` a un `housingMetrics`

---

## Phase 6 — Pipeline UK + EU

> Le UK a les meilleures APIs. L'EU a Eurostat.

### Objectif

Entites UK + 9 pays EU avec legislation et metriques.

### Scripts a creer

#### `scripts/sync/uk-bills.ts`

**Output :** `data/legislation/uk/bills.json`
**API :** `GET https://bills-api.parliament.uk/api/v1/Bills?SearchTerm=housing&SortOrder=DateUpdatedDescending`
**Auth :** Aucune

Logique :

1. Paginer avec `Skip` et `Take` (20 par page)
2. Aussi chercher "zoning", "planning", "tenant", "rent", "affordable"
3. Dedup par `billId`
4. Map `currentStage` → `Stage`
5. Ecrire `data/legislation/uk/bills.json`

#### `scripts/sync/uk-landregistry.ts`

**Output :** `data/housing/uk/land-registry.json`
**API :** `GET https://landregistry.data.gov.uk/data/ukhpi/region/{region}/month/{YYYY-MM}.json`
**Auth :** Aucune

Regions : united-kingdom, england, wales, scotland, northern-ireland, london, east-midlands, east-of-england, north-east, north-west, south-east, south-west, west-midlands, yorkshire-and-the-humber (14 total)

Fetcher les 12 derniers mois pour chaque region.

#### `scripts/sync/eurostat-housing.ts`

**Output :** `data/housing/eu/eurostat-hpi.json`, `eurostat-rents.json`
**APIs :**

```
HPI  : GET https://ec.europa.eu/eurostat/api/dissemination/sdmx/2.1/data/prc_hpi_q/Q.TOTAL.I15_Q.{GEO}?format=JSON&lastNPeriods=8
Rents: GET https://ec.europa.eu/eurostat/api/dissemination/sdmx/2.1/data/prc_hicp_midx/M.I15.CP041.{GEO}?format=JSON&lastNPeriods=12
```

**Auth :** Aucune

Pays : DE, FR, ES, IT, NL, IE, SE, PL, AT, EU27_2020 (10 queries)

#### `scripts/sync/eurlex-housing.ts`

**Output :** Integre dans les entites EU de `lib/international-entities.ts`
**API :** `POST https://publications.europa.eu/webapi/rdf/sparql`
**Auth :** Aucune

Query SPARQL pour les directives/reglements EU sur le logement.

#### Adaptation de `lib/international-entities.ts`

Remplacer les entites EU hand-curated (actuellement AI/data-center) par des entites logement. Garder la meme structure, changer :

- `legislation[]` → bills logement par pays
- `contextBlurb` → contexte crise du logement
- `stanceZoning` / `stanceAffordability` → classifie par pays
- `keyFigures[]` → ministres du logement

#### Adaptation de `scripts/sync/international.ts`

Changer le prompt Claude pour rechercher la legislation logement au lieu de AI/data-center. Le script utilise Claude Sonnet avec `web_search` — meme pattern, contenu different.

### Validation

- `data/legislation/uk/bills.json` avec 10+ bills logement
- `data/housing/uk/land-registry.json` avec prix par region
- `data/housing/eu/eurostat-hpi.json` avec HPI pour 10 pays
- Les entites internationales dans `lib/international-entities.ts` ont des donnees logement

---

## Phase 7 — Pipeline Australie + Asia-Pacific

> ABS pour l'Australie, HDB pour Singapour, RVD pour Hong Kong.

### Objectif

Entites Asia-Pacific avec metriques et legislation (Claude research).

### Scripts a creer

#### `scripts/sync/abs-housing.ts`

**Output :** `data/housing/asia/aus-rppi.json`
**API :** `GET https://api.data.abs.gov.au/data/ABS,RPPI/all?format=jsondata`
**Auth :** Aucune

Extraire : prix par etat (NSW, VIC, QLD, SA, WA, TAS, NT, ACT) + capitales.

#### `scripts/sync/sg-hdb.ts`

**Output :** `data/housing/asia/sg-hdb.json`
**API :** `GET https://data.gov.sg/api/action/datastore_search?resource_id=f1765b54-a209-4718-8d38-a39237f502b3&limit=1000`
**Auth :** Aucune

228,732 transactions. Agreger par `town` + `month` pour obtenir prix median par planning area.

#### `scripts/sync/hk-rvd.ts`

**Output :** `data/housing/asia/hk-rvd.json`
**Source :** `GET https://www.rvd.gov.hk/doc/en/statistics/his_data_2.xls`

Download XLS → parse → extraire les indices de prix mensuels.

#### Legislation Asia-Pacific

Pas d'API de legislation pour le Japon, la Coree, la Chine. Utiliser le pattern Claude research existant (`scripts/sync/international.ts`) avec des prompts logement.

### Validation

- `data/housing/asia/aus-rppi.json` avec prix par etat australien
- `data/housing/asia/sg-hdb.json` avec prix par town
- Entites Asia-Pacific dans `lib/international-entities.ts` avec donnees logement

---

## Phase 8 — Pipeline global + News RSS

> Donnees cross-country OECD + nouveau systeme de news.

### Objectif

Metriques comparatives mondiales. News logement automatisees.

### Scripts a creer

#### `scripts/sync/oecd-housing.ts`

**Output :** `data/housing/global/oecd-hpi.json`
**API :** `GET https://sdmx.oecd.org/public/rest/data/OECD.ECO.MPD,DSD_AN_HOUSE_PRICES@DF_HOUSE_PRICES,/{COUNTRY}.A..?format=csvfilewithlabels`
**Auth :** Aucune

**ATTENTION :** L'ancien endpoint `stats.oecd.org` est mort. Utiliser `sdmx.oecd.org`.

Query par pays individuellement (les multi-country retournent parfois "NoRecordsFound"). 7 metriques par pays : HPI, RHP, RPI, HPI_RPI, HPI_YDH, HPI_RPI_AVG, HPI_YDH_AVG.

#### `scripts/sync/worldbank-housing.ts`

**Output :** `data/housing/global/worldbank.json`
**API :** `GET https://api.worldbank.org/v2/country/{ISO}/indicator/{INDICATOR}?format=json`
**Auth :** Aucune

### Adaptation news

#### `data/news/feeds.json`

Remplacer les 8 feeds actuels (lignes 3-52) par les 14 feeds logement verifies :

```json
[
  {
    "url": "https://www.theglobeandmail.com/arc/outboundfeeds/rss/category/real-estate/",
    "name": "Globe & Mail Real Estate",
    "entity": "Canada",
    "topicHint": "housing"
  },
  {
    "url": "https://financialpost.com/feed",
    "name": "Financial Post",
    "entity": "Canada",
    "topicHint": "housing"
  },
  {
    "url": "https://www.bnnbloomberg.ca/arc/outboundfeeds/rss/?outputType=xml",
    "name": "BNN Bloomberg",
    "entity": "Canada",
    "topicHint": "housing"
  },
  {
    "url": "https://rss.cbc.ca/lineup/canada.xml",
    "name": "CBC Canada",
    "entity": "Canada",
    "topicHint": "housing"
  },
  {
    "url": "https://www.bankofcanada.ca/feed/",
    "name": "Bank of Canada",
    "entity": "Canada",
    "topicHint": "housing"
  },
  {
    "url": "https://news.google.com/rss/search?q=%22housing+crisis%22+OR+%22zoning+reform%22+Canada&hl=en-CA&gl=CA&ceid=CA:en",
    "name": "Google News Housing CA",
    "entity": "Canada",
    "topicHint": "housing"
  },
  {
    "url": "https://news.google.com/rss/search?q=%22housing+crisis%22+OR+%22zoning+reform%22+US&hl=en-US&gl=US&ceid=US:en",
    "name": "Google News Housing US",
    "entity": "United States",
    "topicHint": "housing"
  },
  {
    "url": "https://www.theguardian.com/society/housing/rss",
    "name": "The Guardian Housing",
    "entity": "United Kingdom",
    "topicHint": "housing"
  },
  {
    "url": "https://feeds.bbci.co.uk/news/business/your_money/rss.xml",
    "name": "BBC Your Money",
    "entity": "United Kingdom",
    "topicHint": "housing"
  },
  {
    "url": "https://euobserver.com/rss",
    "name": "EUobserver",
    "entity": "European Union",
    "topicHint": "policy"
  },
  {
    "url": "https://www.sbs.com.au/news/feed",
    "name": "SBS Australia",
    "entity": "Australia",
    "topicHint": "housing"
  },
  {
    "url": "https://gazette.gc.ca/rss/p1-eng.xml",
    "name": "Canada Gazette Part I",
    "entity": "Canada",
    "topicHint": "regulation"
  },
  {
    "url": "https://gazette.gc.ca/rss/p2-eng.xml",
    "name": "Canada Gazette Part II",
    "entity": "Canada",
    "topicHint": "regulation"
  },
  {
    "url": "https://news.google.com/rss/search?q=%22housing+affordability%22+OR+%22housing+crisis%22&hl=en",
    "name": "Google News Housing Global",
    "entity": "World",
    "topicHint": "housing"
  }
]
```

#### `scripts/sync/news-rss.ts`

**RELEVANCE_RE** (lignes 136-171) — remplacer par :

```javascript
const RELEVANCE_RE =
  /housing|zoning|affordable|rent.control|CMHC|vacancy|condo|mortgage|homelessness|eviction|tenant|building.permit|rezoning|density|upzoning|property.tax|gentrification|displacement|shelter|foreclosure|housing.crisis|housing.starts|rental.market/i;
```

**Prompt Haiku** — changer le system prompt de "AI governance and data center policy" vers "housing policy, affordability, and residential development".

#### `scripts/sync/news-regional-summary.ts`

Changer le prompt Sonnet pour generer des syntheses sur la crise du logement par region.

#### Reset du cycle RSS

```bash
rm data/news/.rss-started
rm data/news/summaries.json
```

Puis : `npm run news:poll`

### Validation

- `data/housing/global/oecd-hpi.json` avec 38 pays
- `data/news/feeds.json` avec 14 feeds logement
- `data/news/summaries.json` avec des articles logement
- `npm run news:poll` fonctionne sans erreur
- Les resumes regionaux sont generes

---

## Phase 9 — UI : carte & navigation

> Le changement le plus delicat. Le drill-down Canada dans MapShell.

### Objectif

Clic sur le globe → Canada → provinces → detail avec panel. Meme chose pour USA → etats.

### Fichiers a modifier

#### `components/map/MapShell.tsx` (77 KB)

C'est le fichier le plus complexe du repo. Modifications cibles :

1. **Drill-down Canada** — quand l'utilisateur clique sur le Canada dans la vue "countries" :
   - Passer a une vue "provinces" (similaire a "states" pour les US)
   - Afficher les 13 provinces/territoires avec coloration par stance
   - Clic sur une province → charger l'entite provinciale dans le panel

2. **GeoId mapping** — les provinces canadiennes utilisent les codes ISO 3166-2:CA. Il faut mapper :
   - `CA-ON` → Ontario, `CA-BC` → British Columbia, etc.
   - Ou utiliser les codes numeriques ISO 3166-1 si react-simple-maps les utilise

3. **ViewTarget** — ajouter le support pour `selectedProvinceName` ou generaliser `selectedStateName`

4. **History stack** — les entrees de navigation doivent supporter le drill Canada → provinces

#### `components/map/NorthAmericaMap.tsx`

Ajouter la logique de survol/clic sur les provinces canadiennes. Actuellement le Canada est un seul polygone cliquable — il faut afficher les subdivisions.

#### `lib/search.ts`

Ajouter les entites canadiennes a l'index de recherche. Les provinces doivent etre trouvables via le SearchPill.

### Validation

- Globe → clic "North America" → voir Canada + USA
- Clic Canada → voir 13 provinces colorees par stance
- Clic Ontario → panel lateral s'ouvre avec legislation + metriques
- Clic USA → voir 50 etats (comportement existant preserve)
- Recherche "Ontario" → trouve l'entite et navigue

---

## Phase 10 — UI : sections & composants

> Adapter toute la page d'accueil.

### Objectif

La page d'accueil affiche des donnees logement, pas AI.

### Nouveaux composants a creer

#### `components/sections/MetricsStrip.tsx`

Affiche 3-4 KPIs en haut de la page :

- NHPI national : +X.X% YoY
- Vacancy rate : X.X%
- Housing starts : X,XXX / trimestre
- Median price : $XXX,XXX

Utiliser `@number-flow/react` (deja installe) pour l'animation des chiffres.

#### `components/panel/MetricsPanel.tsx`

Tab dans le SidePanel. Affiche les `housingMetrics` de l'entite selectionnee :

- Grille de stat cards (prix, loyer, vacance, mises en chantier)
- Optionnel : sparkline SVG pour la tendance

### Fichiers a modifier

#### `app/page.tsx`

**Titres de sections** (lignes referencees) :

| Ligne | Actuel                         | Nouveau                             |
| ----- | ------------------------------ | ----------------------------------- |
| 88    | "01 · At a glance"             | "01 · At a glance" (garde)          |
| 91    | "State of US policy"           | "State of housing"                  |
| 110   | "02 · Latest developments"     | "02 · Latest developments" (garde)  |
| 113   | "What happened this week"      | "What happened this week" (garde)   |
| 129   | "03 · The full record"         | "03 · The full record" (garde)      |
| 131   | "Every bill we're tracking"    | "Every housing bill we're tracking" |
| 150   | "04 · Where the compute lives" | "04 · Major housing projects"       |
| 152   | "Data centers we're tracking"  | "Projects we're tracking"           |
| 176   | "05 · Who voted how"           | "05 · Key players"                  |
| 179   | "Politicians"                  | "Officials & leaders"               |
| 198   | "06 · From the wire"           | "06 · From the wire" (garde)        |
| 200   | "Live news"                    | "Live news" (garde)                 |

Integrer `MetricsStrip` dans la section "At a glance".

#### `components/sections/DimensionToggle.tsx`

**LENS_LABEL** (lignes 21-24) :

```
"datacenter" → "Data Centers"    →   "zoning" → "Zoning"
"ai"         → "AI Regulation"   →   "affordability" → "Affordability"
```

**LENS_BLURB** (lignes 26-30) : adapter les descriptions.

**DIMENSION_BLURB** (lignes 34-57) : remplacer avec les descriptions des dimensions logement.

#### `components/sections/SummaryBar.tsx`

**BUCKETS** (lignes 19-50) : adapter les labels des 5 buckets.

#### `components/sections/LegislationTable.tsx`

**JURISDICTION_OPTIONS** (lignes 88-96) :

```
Ajouter : "ca-federal", "ca-provinces"
Garder : "us-federal" (renomme de "us-federal"), "us-states", "europe", "asia-pacific"
```

**CATEGORY_FILTERS** (lignes 41-69) : remplacer par les categories logement.

#### `components/sections/DataCentersOverview.tsx`

**Stats strip** (lignes 118-122) : "Tracked" → "Projects", "Power" → "Units", "Compute" → "Affordable"

**Column headers** (lignes 386-420) : adapter

**STATUS_LABEL** (lignes 27-31) : garder tel quel

#### `components/sections/LiveNews.tsx`

**TOPIC_KEYWORDS** (lignes 38-42) : remplacer par housing topics
**HIGH_SIGNAL** (ligne 60) : remplacer
**MED_SIGNAL** (ligne 61) : remplacer

#### `components/sections/AIOverview.tsx`

**CURATED** (lignes 70-96) : remplacer les phrases par region avec du contenu logement
**Highlight topics** (lignes 57-63) : `"legislation"` / `"infrastructure"` / `"cooperation"` → `"legislation"` / `"construction"` / `"affordability"`

#### `components/sections/PoliticiansOverview.tsx`

**FEATURED_PRIORITY** (lignes 37-49) : remplacer les 9 noms par des acteurs cles du logement.

### Validation

- `npm run dev` → la page d'accueil affiche des donnees logement
- Les filtres de la table fonctionnent avec les nouvelles categories
- Le DimensionToggle affiche "Zoning" / "Affordability"
- Le panel MetricsPanel affiche les metriques d'une province/etat
- Les news montrent des articles logement

---

## Phase 11 — GitHub Actions

> Automatiser les 3 pipelines.

### Objectif

Les donnees se mettent a jour automatiquement.

### Workflows

#### `.github/workflows/news-rss.yml` (adapter)

Deja adapte en Phase 8. Verifier que le cron fonctionne.

#### `.github/workflows/metrics-sync.yml` (NOUVEAU)

- **Cron :** `0 6 * * 1` (chaque lundi 6h UTC)
- **Steps :** statcan → cmhc → fred → zillow → census → uk-landregistry → eurostat → abs → sg-hdb → oecd → build-placeholder → commit
- **Secrets :** `FRED_API_KEY`

#### `.github/workflows/legislation-sync.yml` (NOUVEAU)

- **Cron :** `0 7 * * 3` (chaque mercredi 7h UTC)
- **Steps :** canada-legislation → bc-legislation → legislation-ingest → legislation-classify → uk-bills → eurlex → build-placeholder → commit
- **Secrets :** `LEGISCAN_API_KEY`, `ANTHROPIC_API_KEY`

### Configuration des secrets

Dans GitHub → Settings → Secrets and variables → Actions :

- `ANTHROPIC_API_KEY` (probablement deja configure)
- `LEGISCAN_API_KEY`
- `FRED_API_KEY`

### Validation

- Chaque workflow peut etre declenche manuellement via `workflow_dispatch`
- Les workflows commitent les changements dans `data/`
- Pas de conflit entre les 3 workflows (jours/heures differents)

---

## Phase 12 — Polish & verification

> Nettoyage final, suppression du code mort, verification complete.

### Objectif

Le site est propre, sans references AI/data-center, et pret a deployer.

### Fichiers/dossiers a supprimer

| Fichier/Dossier                             | Raison                        |
| ------------------------------------------- | ----------------------------- |
| `scripts/sync/datacenters-epoch.ts`         | Plus de data centers          |
| `scripts/sync/datacenters-international.ts` | Plus de data centers          |
| `scripts/sync/datacenters-researched.ts`    | Plus de data centers          |
| `scripts/sync/eia-plants.ts`                | Donnees energetiques US       |
| `scripts/sync/eia-state-profiles.ts`        | Donnees energetiques US       |
| `scripts/sync/water-features.ts`            | Donnees eau pour data centers |
| `data/datacenters/epoch-ai.json`            | Donnees data centers          |
| `data/energy/power-plants.json`             | Donnees energetiques          |
| `data/energy/us-water.json`                 | Donnees eau                   |
| `data/energy/state-profiles.json`           | Donnees energetiques          |

### Pages a adapter

| Page                            | Changement                                    |
| ------------------------------- | --------------------------------------------- |
| `app/about/page.tsx`            | Recrire le contenu pour le housing tracker    |
| `app/methodology/page.tsx`      | Recrire les explications methodologiques      |
| `app/layout.tsx`                | Metadata : `<title>`, description, Open Graph |
| `app/datacenters/page.tsx`      | Renommer route → `/projects/`                 |
| `app/datacenters/[id]/page.tsx` | Renommer route → `/projects/[id]/`            |

### Verifications finales

```bash
# Build complet
npm run build

# Verifier qu'il n'y a plus de references "data center" ou "AI" dans le UI
grep -ri "data center" components/ app/ lib/dimensions.ts
grep -ri "artificial intelligence" components/ app/

# Verifier toutes les routes
npm run start
# Tester manuellement : /, /bills, /news, /politicians, /projects, /about, /methodology

# Verifier le responsive
# Ouvrir Chrome DevTools → toggle mobile view
```

### Validation finale

- `npm run build` passe sans erreur ni warning
- Aucune reference "data center" ou "AI regulation" dans le UI visible
- Toutes les routes fonctionnent
- Le globe → drill-down Canada → provinces fonctionne
- Le globe → drill-down USA → etats fonctionne
- Les news s'affichent avec du contenu logement
- Les metriques s'affichent dans le panel
- Le responsive mobile fonctionne

---

## Resume des secrets et cles

| Secret              | Utilise par                                            | Comment l'obtenir                                   |
| ------------------- | ------------------------------------------------------ | --------------------------------------------------- |
| `ANTHROPIC_API_KEY` | news-rss.ts, legislation-classify.ts, international.ts | Tu l'as deja                                        |
| `LEGISCAN_API_KEY`  | legislation-ingest.ts                                  | `https://legiscan.com/legiscan` — profil → API key  |
| `FRED_API_KEY`      | fred-housing.ts                                        | `https://fred.stlouisfed.org/docs/api/api_key.html` |
| `CANLII_API_KEY`    | (optionnel, Phase 2 bonus)                             | Formulaire contact `canlii.org`                     |

**Toutes les autres APIs (StatsCan, CMHC, Eurostat, UK Land Registry, UK Bills, ABS, HDB, OECD, World Bank, Zillow, US Census, LEGISinfo, BC Laws, EUR-Lex) = aucune authentification requise.**

---

## Estimation par phase

| Phase | Travail          | Depend de                    |
| ----- | ---------------- | ---------------------------- |
| 0     | Setup            | `npm install` + `.env.local` |
| 1     | Types            | Phase 0                      |
| 2     | CA legislation   | Phase 1                      |
| 3     | CA metriques     | Phase 2                      |
| 4     | US legislation   | Phase 1 + `LEGISCAN_API_KEY` |
| 5     | US metriques     | Phase 4 + `FRED_API_KEY`     |
| 6     | UK + EU          | Phase 1                      |
| 7     | Australie + Asia | Phase 1                      |
| 8     | Global + News    | Phases 2-7                   |
| 9     | UI carte         | Phases 2-3                   |
| 10    | UI sections      | Phase 9 + donnees remplies   |
| 11    | GitHub Actions   | Phases 2-8                   |
| 12    | Polish           | Toutes les phases            |

**Les phases 4-5 (US) et 6-7 (EU/Asia) peuvent etre faites en parallele** puisqu'elles dependent seulement de Phase 1.

```
Phase 0 → Phase 1 → Phase 2 → Phase 3 ─────────────────┐
                  ├→ Phase 4 → Phase 5 ─────────────────┤
                  ├→ Phase 6 ───────────────────────────┤
                  └→ Phase 7 ───────────────────────────┤
                                                        ↓
                                                    Phase 8 → Phase 9 → Phase 10 → Phase 11 → Phase 12
```
