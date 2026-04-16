# Housing Crisis Tracker — Rapport d'adaptation complet

> **Date :** 2026-04-15
> **Base :** Repository `track-policy` (gov-index@0.1.0)
> **Objectif :** Adapter le tracker de politique AI/data-center en un tracker mondial de la crise du logement
> **Priorite des regions :** Canada → USA → Europe/UK → Australie/Asia-Pacific

---

## Table des matieres

1. [Vue d'ensemble du projet](#1-vue-densemble-du-projet)
2. [Etat actuel du repo](#2-etat-actuel-du-repo)
3. [Architecture d'adaptation](#3-architecture-dadaptation)
4. [Region 1 : Canada (priorite)](#4-region-1--canada-priorite)
5. [Region 2 : USA](#5-region-2--usa)
6. [Region 3 : Europe & UK](#6-region-3--europe--uk)
7. [Region 4 : Australie & Asia-Pacific](#7-region-4--australie--asia-pacific)
8. [Donnees globales cross-region](#8-donnees-globales-cross-region)
9. [Structure des fichiers de donnees](#9-structure-des-fichiers-de-donnees)
10. [Adaptation des types TypeScript](#10-adaptation-des-types-typescript)
11. [Adaptation des composants UI](#11-adaptation-des-composants-ui)
12. [Adaptation des scripts de sync](#12-adaptation-des-scripts-de-sync)
13. [GitHub Actions & automatisation](#13-github-actions--automatisation)
14. [News RSS — feeds par region](#14-news-rss--feeds-par-region)
15. [Nouveaux composants a creer](#15-nouveaux-composants-a-creer)
16. [Roadmap d'implementation](#16-roadmap-dimplementation)
17. [Couts et limites](#17-couts-et-limites)
18. [Annexe A : Endpoints API verifies](#annexe-a--endpoints-api-verifies)
19. [Annexe B : Inventaire complet du repo actuel](#annexe-b--inventaire-complet-du-repo-actuel)

---

## 1. Vue d'ensemble du projet

### Ce qu'on construit

Un tracker interactif mondial de la crise du logement, construit sur l'architecture existante de track-policy. Le site permettra de :

- **Visualiser** la crise du logement sur un globe interactif avec drill-down par region/pays/province/etat
- **Tracker la legislation** sur le logement (zonage, loyers, logement abordable) dans chaque juridiction
- **Afficher des metriques quantitatives** (prix, loyers, taux de vacance, mises en chantier) par entite geographique
- **Agreger les nouvelles** sur le logement via des flux RSS avec resume automatique par Claude Haiku
- **Profiler les acteurs cles** (ministres du logement, maires, promoteurs)
- **Comparer les pays** via des indicateurs standardises (OECD, World Bank)

### Pourquoi cette architecture fonctionne

Le repo track-policy a une separation propre entre :
- **Donnees** (`data/`) — JSON plat, pas de base de donnees
- **Pipeline** (`scripts/sync/`) — ingest → classify → build
- **Types** (`types/index.ts`) — contrat strict entre donnees et UI
- **UI** (`components/`) — composants generiques parametres par les types

Cette architecture se transfere directement : on remplace le *contenu* (AI → logement) sans toucher la *structure*.

### Ce qui ne change PAS

- Le framework (Next.js 16 + React 19 + TypeScript)
- Le globe hero 3D (cobe) — la crise du logement est mondiale
- Le systeme de carte interactive (react-simple-maps + d3-geo)
- Le pattern de drill-down (region → pays → province/etat)
- Le systeme de panel lateral avec tabs
- Le pipeline RSS → Haiku → commit
- Le deploiement Vercel
- Le widget de visiteurs (Vercel KV)

---

## 2. Etat actuel du repo

### Statistiques du repo

| Metrique | Valeur |
|---|---|
| Fichiers TypeScript/TSX | ~70 |
| Fichiers JSON de donnees | 223 |
| Taille totale des donnees | ~13.7 MB |
| Composants React | 50 |
| Pages/Routes | 13+ routes dynamiques |
| Scripts (pipeline) | 42 |
| Dependencies NPM | ~20 production, 11+ dev |
| Juridictions couvertes | 50 etats US + DC + 15 internationales |

### Fichiers cles et leur taille

| Fichier | Taille | Role |
|---|---|---|
| `lib/placeholder-data.ts` | 954 KB | Blob de donnees pre-compile pour le SSR |
| `components/map/MapShell.tsx` | 77 KB | Orchestrateur principal de la carte |
| `lib/international-entities.ts` | 35 KB | Entites EU/Asia hand-curated |
| `components/panel/SidePanel.tsx` | 29 KB | Panel lateral avec tabs |
| `components/politicians/PoliticianCard.tsx` | 30 KB | Carte de politicien |
| `components/sections/DataCentersOverview.tsx` | 26 KB | Table des data centers |
| `scripts/sync/legislation-classify.ts` | 25 KB | Classification des bills |
| `components/sections/LegislationTable.tsx` | 23 KB | Table de legislation filtrable |
| `data/politicians/us-enriched.json` | 4.3 MB | Politiciens US enrichis |
| `data/news/summaries.json` | 311 KB | News avec resumes AI |

### Scripts npm actuels

```
dev             → next dev (serveur de developpement)
prebuild        → cp data/news/summaries.json public/news-summaries.json
build           → next build
start           → next start
lint            → eslint
blurbs:refresh  → tsx scripts/cleanup/refresh-blurbs.ts --force
data:rebuild    → tsx scripts/build-placeholder.ts
news:poll       → tsx scripts/sync/news-rss.ts
news:regen      → tsx scripts/sync/news-regen.ts
```

### GitHub Actions actuel

Un seul workflow : `.github/workflows/news-rss.yml`
- **Cron :** 3x/jour (9:00, 15:00, 23:00 UTC)
- **Actions :** Poll RSS → Haiku summaries → regional prose → rebuild placeholder → git commit
- **Secrets :** `ANTHROPIC_API_KEY`
- **Concurrence :** serialisee (pas de runs paralleles)

### RSS feeds actuels (`data/news/feeds.json`)

8 feeds, tous orientes AI/data-center :
- NPR Technology, AP AI, The Verge Policy, Ars Technica Policy
- Maine Morning Star, Planet Detroit (data centers regionaux)
- Google News : data center moratoriums + AI policy

---

## 3. Architecture d'adaptation

### Mapping conceptuel

| Concept track-policy | Concept housing-tracker | Notes |
|---|---|---|
| `Entity` (pays/etat) | `Entity` (pays/province/etat) | Meme structure, ajoute `housingMetrics` |
| `Legislation` (projet de loi) | `Legislation` (loi sur le logement) | Memes champs, categories differentes |
| `StanceType` (restrictive/favorable) | `StanceType` | Labels renommes dans le UI |
| `Stage` (Filed/Committee/Enacted) | `Stage` | Identique — les bills passent les memes etapes |
| `ImpactTag` (26 tags AI) | `ImpactTag` (~20 tags logement) | Remplaces entierement |
| `LegislationCategory` (10 cat. AI) | `LegislationCategory` (10 cat. logement) | Remplaces entierement |
| `Dimension` (10 dimensions AI) | `Dimension` (~8 dimensions logement) | Remplaces |
| `DimensionLens` ("datacenter"/"ai") | `DimensionLens` ("zoning"/"affordability") | Remplaces |
| `DataCenter` (installation) | `HousingProject` (projet de construction) | Champs adaptes |
| `Legislator` (politicien) | `Legislator` (officiel du logement) | Meme structure |
| `NewsItem` | `NewsItem` | Identique |
| LegiScan API | LegiScan (US) + LEGISinfo (CA) + UK Bills API | Sources multiples |
| RSS feeds AI | RSS feeds logement | Feeds differents, meme pipeline |
| Claude Haiku (resumes) | Claude Haiku (resumes) | Meme usage, prompts adaptes |

### Principe d'adaptation

**Regle d'or :** On ne reecrit pas les composants — on change les *constantes*, les *types*, et les *sources de donnees*. La logique de filtrage, tri, animation, et drill-down reste identique.

---

## 4. Region 1 : Canada (priorite)

### 4.1 Legislation canadienne

#### Source federale : LEGISinfo (Parlement du Canada)

**Statut : VERIFIE — API JSON/XML/RSS fonctionnelle**

LEGISinfo est la source officielle du Parlement du Canada pour le suivi des projets de loi. Elle expose des feeds structures en JSON, XML et RSS.

**Endpoints confirmes :**
```
JSON : https://www.parl.ca/legisinfo/en/bills/json?text=housing&parlsession=45-1
XML  : https://www.parl.ca/legisinfo/en/bills/xml?text=housing&parlsession=45-1
RSS  : https://www.parl.ca/legisinfo/en/bills/rss?text=housing&parlsession=45-1
```

**Parametres de requete :**
- `text=` — recherche par mot-cle (titre du bill)
- `parlsession=` — session parlementaire (`45-1` = actuelle, `all` = toutes)

**Champs retournes par bill (JSON) :**
- `BillId`, `BillNumberFormatted` (ex: "C-20")
- `LongTitleEn` / `LongTitleFr`
- `ShortTitleEn` / `ShortTitleFr`
- `SponsorEn` / `SponsorFr`
- `CurrentStatusEn` / `CurrentStatusFr`
- `LatestCompletedMajorStageEn`, `LatestActivityEn`, `LatestActivityDateTime`
- Dates de progression : `PassedHouseFirstReadingDateTime` → `ReceivedRoyalAssentDateTime`
- `BillTypeEn` (Senate Public Bill, Government Bill, Private Member's Bill, etc.)

**Bills logement trouves dans la 45e legislature (session actuelle) :**
- **C-20** — "An Act respecting the establishment of Build Canada Homes" (en comite)
- **C-26** — "An Act to authorize certain payments... for housing supply" (2e lecture)
- **C-205** — "An Act to amend the National Housing Strategy Act"
- **C-227** — "An Act to establish a national strategy on housing for young Canadians" (en comite)
- **C-5** — "An Act to enact the Free Trade and Labour Mobility in Canada Act and the Building Canada Act" (sanction royale)
- **C-4** — "An Act respecting certain affordability measures for Canadians" (sanction royale)

**Mots-cles a rechercher :** `housing`, `zoning`, `affordable`, `rental`, `residential`, `homelessness`, `mortgage`, `construction`, `logement` (pour les bills en francais)

**Limitation :** La recherche est par mot-cle dans le titre seulement, pas une classification thematique. Des bills pertinents (ex: C-4 "affordability") peuvent ne pas apparaitre dans une recherche "housing".

**Script a creer :** `scripts/sync/canada-legislation.ts`
- Poll LEGISinfo JSON pour chaque mot-cle
- Dedup par `BillId`
- Map `CurrentStatusEn` → `Stage` (ex: "At committee" → "Committee", "Royal Assent" → "Enacted")
- Cache dans `data/raw/legisinfo/`
- Ecrit dans `data/legislation/federal-ca.json`

#### Source provinciale : BC Laws API

**Statut : VERIFIE — API XML avec recherche full-text**

La Colombie-Britannique est la seule province avec une vraie API de legislation.

**Endpoint de recherche :**
```
https://www.bclaws.gov.bc.ca/civix/search/complete/fullsearch?q=housing&s=0&e=5&nFrag=5&lFrag=100
```

**Retourne :** XML avec `<results>` contenant `<doc>` elements
- 315 resultats pour "housing"
- Champs : `CIVIX_DOCUMENT_TITLE`, `CIVIX_DOCUMENT_ID`, `CIVIX_DOCUMENT_LOC`, `CIVIX_DOCUMENT_TYPE`
- Inclut statuts, reglements, ET bylaws municipaux (ex: bylaws d'Abbotsford)
- Documentation API : `https://www.bclaws.gov.bc.ca/civix/template/complete/api/index.html`
- Licence ouverte (King's Printer Licence)

**Script a creer :** `scripts/sync/bc-legislation.ts`

#### Autres provinces : pas d'API

| Province | Source | API? | Solution |
|---|---|---|---|
| Ontario | `www.ola.org/en/legislative-business/bills` | Non, HTML seulement | Scrape ou CanLII |
| Quebec | `assnat.qc.ca` | Non, HTML/PDF seulement | Scrape ou CanLII |
| Alberta | `assembly.ab.ca` | Non | Scrape ou CanLII |
| Autres | Sites des assemblees legislatives | Non | CanLII ou Claude research |

#### CanLII (Canadian Legal Information Institute)

**Statut : API existante, necessite une cle API (gratuite)**

CanLII couvre TOUTES les juridictions canadiennes — federal, provinces, territoires.

**Base URL :** `https://api.canlii.org/v1/`
**Auth :** Cle API requise (demande via formulaire CanLII, gratuite)
**Rate limits :** 5,000 queries/jour, 2 req/sec

**Endpoints :**
- `legislationBrowse/{lang}/` — lister toutes les bases de donnees
- `legislationBrowse/{lang}/{databaseId}/` — lister la legislation d'une juridiction
- `legislationBrowse/{lang}/{databaseId}/{legislationId}/` — metadata d'une loi specifique

**Limitation :** API de navigation seulement, pas de recherche par mot-cle. Il faut lister toutes les lois d'une juridiction puis filtrer localement.

**Documentation officielle :** `https://github.com/canlii/API_documentation/blob/master/EN.md`

#### Canada Gazette (reglements federaux)

**Statut : RSS confirmes fonctionnels**

```
Part I  (reglements proposes, hebdo)  : https://gazette.gc.ca/rss/p1-eng.xml
Part II (reglements officiels, bi-hebdo) : https://gazette.gc.ca/rss/p2-eng.xml
Part III (lois du Parlement)            : https://gazette.gc.ca/rss/en-ls-eng.xml
```

Chaque item RSS lie a l'edition complete — il faut parser le HTML pour trouver les reglements logement.

#### Donnees municipales (zonage)

Il n'existe **aucune source agregee** pour les reglements de zonage municipaux canadiens. Approches possibles :

- **Quebec :** Open Canada a un dataset de zonage municipal en CSV/GeoJSON/KML (`open.canada.ca/data/en/dataset/a56dfef1-ad07-4b21-9ef7-24a0c553a085`) — mis a jour mensuellement
- **Toronto :** Open Data Toronto a des shapefiles de zonage
- **OpenCouncil.ca :** Tracke le Housing Accelerator Fund, les Ontario HATF recommendations, et les MZOs (pas d'API, web seulement)
- **CMHC HAF :** 241 ententes avec des municipalites, mais pas de dataset telechargeablable (dashboard interactif seulement)

**Strategy recommandee pour le municipal :** Utiliser le meme pattern que `scripts/sync/municipal.ts` actuel — Claude research avec web_search pour les villes majeures (Toronto, Vancouver, Montreal, Calgary, Edmonton, Ottawa), puis enrichissement progressif.

### 4.2 Metriques logement Canada

#### Statistics Canada WDS API

**Statut : VERIFIE — API REST gratuite, sans authentification**

**Base URL :** `https://www150.statcan.gc.ca/t1/wds/rest/`

**Tables cles confirmees :**

| Table | ProductId | Contenu | Frequence | Geographies |
|---|---|---|---|---|
| NHPI | `18100205` | New Housing Price Index | Mensuel | Canada + 10 prov + 25 CMAs |
| Housing Starts | `34100135` | Mises en chantier/completions | Trimestriel | Canada + 13 provinces |
| CPI Shelter | `18100004` | Indice des prix - composante logement | Mensuel | Canada + 10 prov + CMAs |

**Endpoints WDS (POST) :**

```
# Metadata d'une table
POST https://www150.statcan.gc.ca/t1/wds/rest/getCubeMetadata
Body: [{"productId": 18100205}]

# Donnees (derniers N periodes)
POST https://www150.statcan.gc.ca/t1/wds/rest/getDataFromCubePidCoordAndLatestNPeriods
Body: [{"productId": 18100205, "coordinate": "1.1.0.0.0.0.0.0.0.0", "latestN": 12}]

# Download CSV complet
GET https://www150.statcan.gc.ca/t1/wds/rest/getFullTableDownloadCSV/18100205/en
→ Retourne URL vers un .zip contenant le CSV complet
```

**Structure de reponse par datapoint :**
```json
{
  "refPer": "2026-02-01",
  "value": 121.9,
  "decimals": 1,
  "statusCode": 0,
  "releaseTime": "2026-03-20T08:30"
}
```

**Coordonnees geographiques (table 18100205) :**
- `1` = Canada (geoLevel 0)
- `2-5` = Regions (Atlantic, Prairie, etc. — geoLevel 1)
- `6-15` = Provinces (geoLevel 2)
- `16-40` = CMAs : Toronto, Vancouver, Montreal, Calgary, Edmonton, Ottawa-Gatineau, etc. (geoLevel 503)

**Script a creer :** `scripts/sync/statcan-housing.ts`
- POST getCubeMetadata pour decouvrir les coordonnees
- POST getDataFromCubePidCoordAndLatestNPeriods pour les 12 derniers mois/trimestres
- Cache dans `data/raw/statcan/`
- Ecrit dans `data/housing/canada/nhpi.json`, `starts.json`

#### CMHC (Societe canadienne d'hypotheques et de logement)

**Statut : Pas d'API publique — export CSV via endpoint non-documente**

L'acces aux donnees CMHC passe par le portail HMIP (Housing Market Information Portal). Il n'y a pas d'API REST officielle, mais un endpoint d'export CSV existe :

```
POST https://www03.cmhc-schl.gc.ca/hmip-pimh/en/TableMapChart/ExportTable
Body: TableId=2.1.31.2&GeographyId=2410&GeographyTypeId=3&DisplayAs=Table
→ Retourne CSV
```

**Types de geographie CMHC :**
| GeographyTypeId | Niveau |
|---|---|
| 1 | Provinces |
| 2 | Centres (CMAs/CAs) |
| 3 | Survey Zones |
| 4 | Census Subdivision |
| 5 | Neighbourhoods |
| 6 | Census Tracts |

**Tables prioritaires pour le logement :**

| TableId | Contenu |
|---|---|
| `2.1.1.{geo}` | Taux de vacance par type de chambre |
| `2.1.11.{geo}` | Loyer moyen par type de chambre |
| `2.1.12.{geo}` | Variation du loyer moyen |
| `2.1.21.{geo}` | Loyer median par type de chambre |
| `2.1.26.{geo}` | Univers locatif par type de chambre |
| `2.1.31.{geo}` | Statistiques sommaires |
| `1.1.1.{geo}` | Mises en chantier par type de logement |
| `1.1.2.{geo}` | Completions par type de logement |
| `1.1.3.{geo}` | En construction par type de logement |

**Risque :** Cet endpoint n'est pas documente et peut changer sans preavis. Le package R `cmhc` (`mountainmath.github.io/cmhc/`) reverse-engineer ce meme endpoint.

**Script a creer :** `scripts/sync/cmhc-housing.ts`
- POST a ExportTable pour chaque TableId × GeographyTypeId
- Parse le CSV retourne
- Cache dans `data/raw/cmhc/`
- Ecrit dans `data/housing/canada/cmhc-rental.json` et `cmhc-starts.json`

### 4.3 Acteurs cles Canada

Les acteurs cles pour le logement au Canada incluent :
- Le ministre federal du Logement, de l'Infrastructure et des Collectivites
- Le president/CEO de la CMHC
- Les ministres provinciaux responsables du logement (un par province)
- Les maires des grandes villes (Toronto, Vancouver, Montreal, Calgary, Edmonton, Ottawa)

**Note :** Le Canada a eu une election federale en 2025. Les postes ministeriels ont potentiellement change. Il faudra verifier les noms actuels via le site du gouvernement du Canada (`canada.ca/en/privy-council/services/information-sessions/working-prime-minister.html`).

**Strategy :** Meme pattern que `scripts/sync/us-politicians-ai.ts` — Claude research avec web_search pour les profils + stances sur le logement.

### 4.4 Carte du Canada — drill-down

Le code actuel dans `MapShell.tsx` gere le drill-down NA comme suit :
- `naView: "countries"` → montre USA, Canada, Mexique
- `naView: "states"` → montre les 50 etats US
- `naView: "counties"` → montre les comtes d'un etat

**Adaptation necessaire :**
Le drill-down actuel est US-centric. Il faut generaliser pour supporter :
- Clic sur Canada → provinces canadiennes (13 prov/terr)
- Clic sur USA → etats americains (50 etats)

Le TopoJSON mondial utilise par react-simple-maps inclut deja les frontieres des provinces canadiennes. Le changement principal est dans la logique de `MapShell.tsx` :
- Ajouter un `naView: "provinces"` ou generaliser `"states"` pour les deux pays
- Mapper les geoIds des provinces (ISO 3166-2:CA codes)
- Resoudre l'entite selectionnee a partir du geoId provincial

**Fichiers a modifier :**
- `components/map/MapShell.tsx` — ajouter la logique de drill-down Canada
- `components/map/NorthAmericaMap.tsx` — gerer la selection provinciale
- `types/index.ts` — potentiellement ajouter `NaView = "countries" | "states" | "provinces" | "counties"`

---

## 5. Region 2 : USA

### 5.1 Legislation US

#### LegiScan API (deja en place)

Le script `scripts/sync/legislation-ingest.ts` fonctionne deja. Il suffit de changer les mots-cles :

**Mots-cles actuels :** `"data center"`, `"artificial intelligence"`, `"deepfake"`, `"facial recognition"`

**Mots-cles logement :**
- `"housing"`, `"zoning"`, `"affordable housing"`
- `"rent control"`, `"building permit"`, `"density bonus"`
- `"inclusionary zoning"`, `"eviction"`, `"homelessness"`
- `"tenant protection"`, `"short-term rental"`
- `"property tax"`, `"development"`, `"residential"`

**Budget API :** Meme enveloppe (~800 queries par run, 30,000/mois free tier). 4 mots-cles × 51 juridictions = 204 recherches + ~600 getBill = ~800 queries.

**Classification :** Adapter `scripts/sync/legislation-classify.ts` avec de nouvelles heuristiques :

| Categorie logement | Mots-cles de classification |
|---|---|
| `zoning-reform` | zoning, rezone, density, setback, lot split, ADU, duplex |
| `rent-regulation` | rent control, rent stabilization, rent cap, tenant |
| `affordable-housing` | affordable, inclusionary, below-market, subsidized |
| `development-incentive` | tax increment, opportunity zone, fast-track, expedited |
| `building-code` | building code, fire safety, accessibility, energy efficiency |
| `foreign-investment` | foreign buyer, non-resident, beneficial ownership |
| `homelessness-services` | homeless, shelter, supportive housing, encampment |
| `tenant-protection` | eviction, just cause, relocation, habitability |
| `transit-housing` | transit-oriented, TOD, station area, corridor |
| `property-tax` | property tax, assessment, exemption, abatement |

### 5.2 Metriques logement US

#### FRED (Federal Reserve Economic Data)

**Statut : VERIFIE — API REST, cle gratuite requise**

**Base URL :** `https://api.stlouisfed.org/fred/`
**Auth :** Cle API gratuite (inscription sur `fred.stlouisfed.org/docs/api/api_key.html`)

**Series confirmees :**

| Series ID | Contenu | Frequence | Granularite |
|---|---|---|---|
| `CSUSHPISA` | S&P Case-Shiller National Home Price Index | Mensuel | National (+ 20 metros via variantes) |
| `MSPUS` | Median Sales Price of Houses Sold | Trimestriel | National |
| `ASPUS` | Average Sales Price of Houses Sold | Trimestriel | National |
| `HOUST` | Housing Starts: Total New | Mensuel | National |
| `MORTGAGE30US` | 30-Year Fixed Mortgage Rate | Hebdomadaire | National |
| `RRVRUSQ156N` | Rental Vacancy Rate | Trimestriel | National |
| `PERMIT` | New Private Housing Units Building Permits | Mensuel | National |
| `USSTHPI` | All-Transactions House Price Index | Trimestriel | National + etat + metro |

**Endpoint :**
```
GET https://api.stlouisfed.org/fred/series/observations
  ?series_id=CSUSHPISA
  &api_key={YOUR_KEY}
  &file_type=json
  &sort_order=desc
  &limit=12
```

**Script a creer :** `scripts/sync/fred-housing.ts`

#### Zillow Home Value Index (ZHVI)

**Statut : VERIFIE — CSV en telechargement direct, aucune auth**

**URLs de download confirmes :**
```
Metro  : https://files.zillowstatic.com/research/public_csvs/zhvi/Metro_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv (4.4 MB)
State  : https://files.zillowstatic.com/research/public_csvs/zhvi/State_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv (298 KB)
County : https://files.zillowstatic.com/research/public_csvs/zhvi/County_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv (13 MB)
City   : https://files.zillowstatic.com/research/public_csvs/zhvi/City_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv (92 MB)
Zip    : https://files.zillowstatic.com/research/public_csvs/zhvi/Zip_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv (120 MB)
```

**Aussi disponible — Zillow Observed Rent Index (ZORI) :**
```
Metro  : https://files.zillowstatic.com/research/public_csvs/zori/Metro_zori_uc_sfrcondomfr_sm_sa_month.csv (981 KB)
```

**Structure CSV :** `RegionID, SizeRank, RegionName, RegionType, StateName, [colonnes mensuelles 2000-01 → 2026-02]`

**Script a creer :** `scripts/sync/zillow-housing.ts`
- Telecharger les CSV State + Metro
- Parser et extraire les dernieres valeurs
- Calculer le % de changement annuel
- Ecrire dans `data/housing/us/zillow-zhvi.json` et `zillow-zori.json`

#### US Census Bureau — American Community Survey

**Statut : VERIFIE — API JSON gratuite, pas d'auth requise**

**Endpoint :**
```
GET https://api.census.gov/data/2023/acs/acs1
  ?get=NAME,B25077_001E,B25064_001E,B25001_001E
  &for=state:*
```

**Champs confirmes :**
- `B25077_001E` — Median home value (ex: Californie $725,800)
- `B25064_001E` — Median gross rent (ex: Californie $1,992)
- `B25001_001E` — Total housing units (ex: Californie 14,762,527)

**Granularite :** etat, comte, census tract, block group

**Script a creer :** `scripts/sync/census-housing.ts`

#### HUD Fair Market Rents

**Statut : VERIFIE — XLSX/CSV en telechargement direct**

**Fichiers disponibles sur `huduser.gov/portal/datasets/fmr.html` :**
- `FMR_2Bed_1983_2026.csv` — Historical 2-bedroom FMR, 1983-2026
- `FMR_All_1983_2026.csv` — All bedroom sizes
- `fy2026_safmrs.xlsx` — Small Area FMRs (par ZIP code)

**Script a creer :** `scripts/sync/hud-fmr.ts` (download annuel)

### 5.3 Acteurs cles US

Le systeme actuel de `data/politicians/us-enriched.json` (4.3 MB, 515+ politiciens) peut etre reutilise. Il faudra :
- Re-scorer la `FEATURED_PRIORITY` pour favoriser les politiciens impliques dans le logement (HUD Secretary, Housing Committee members, gouverneurs pro-logement)
- Adapter les `impactTags` et votes pour les bills de logement
- Garder l'integration FEC pour les donors (les promoteurs immobiliers sont des donors majeurs)

---

## 6. Region 3 : Europe & UK

### 6.1 UK — La meilleure source europeenne

#### UK Parliament Bills API

**Statut : VERIFIE — API REST JSON excellente, aucune auth**

**Base URL :** `https://bills-api.parliament.uk/api/v1/Bills`

**Recherche logement confirmee :**
```
GET https://bills-api.parliament.uk/api/v1/Bills?SearchTerm=housing&SortOrder=DateUpdatedDescending
```

**Bills logement trouves :**
- **Housing Estates Bill** (billId 3943) — 2e lecture, prevu 2026-04-17
- **Co-operative Housing Tenure Bill** (billId 3959)
- **Housing Standards (Refugees and Asylum Seekers) Bill** (billId 3618)
- **Affordable Housing (Conversion of Commercial Property) Bill** (billId 3655)

**Champs par bill :**
- `billId`, `shortTitle`, `longTitle`
- `currentHouse`, `originatingHouse`
- `lastUpdate`, `isAct`, `isDefeated`, `billWithdrawn`
- `currentStage` (avec description, house, dates)
- `sponsors[]` (avec nom, parti, URL photo)

**Pagination :** `Skip` et `Take` (attention: `SortOrder=DateUpdatedDescending`, pas `DateUpdatedDesc`)

**Script a creer :** `scripts/sync/uk-bills.ts`

#### UK Land Registry — House Price Index API

**Statut : VERIFIE — API JSON Linked Data, aucune auth**

**Endpoint :**
```
GET https://landregistry.data.gov.uk/data/ukhpi/region/{region}/month/{YYYY-MM}.json
```

**14 regions confirmees :** united-kingdom, england, wales, scotland, northern-ireland, london, east-midlands, east-of-england, north-east, north-west, south-east, south-west, west-midlands, yorkshire-and-the-humber

**Champs (dec. 2025, UK) :**
- `averagePrice`: 269,108 (national), par type: Detached (438,053), SemiDetached (274,182), Terraced (228,250), Flat (192,562)
- `housePriceIndex`: 103.1 (par type aussi)
- `percentageAnnualChange`: +1.9%
- `percentageChange`: -1.2% (mensuel)
- London inclut aussi : Cash, Mortgage, FirstTimeBuyer, FormerOwnerOccupier

**Script a creer :** `scripts/sync/uk-landregistry.ts`

#### UK Homelessness Data

**Statut : VERIFIE — ODS telechargeable**
- `gov.uk/government/statistical-data-sets/live-tables-on-homelessness`
- Fichier : `Statutory_Homelessness_England_Time_Series_202509.ods`

### 6.2 EU — Legislation et metriques

#### EUR-Lex CELLAR SPARQL (legislation EU)

**Statut : VERIFIE — endpoint SPARQL gratuit, sans auth**

**Endpoint :** `https://publications.europa.eu/webapi/rdf/sparql`
**Format :** JSON, XML, ou CSV via content negotiation

**15 resultats pour "housing"** dans la legislation secondaire EU, incluant :
- Regulation (EC) No 763/2008 sur les recensements de population et **logement**
- Directives sur l'efficacite energetique des batiments (EPBD)
- Decisions de la Commission sur des fusions liees au logement

**Limitation :** La plupart de la legislation logement en Europe est **nationale**, pas EU. Les directives EU touchent indirectement le logement (EPBD pour l'efficacite energetique, regles sur les prets hypothecaires).

**Strategy :** Meme approche que track-policy actuel — EUR-Lex pour le niveau EU, Claude research pour les lois nationales.

**Script a creer :** `scripts/sync/eurlex-housing.ts`

#### Eurostat — House Price Index (prc_hpi_q)

**Statut : VERIFIE — API SDMX JSON, aucune auth**

**Endpoint :**
```
GET https://ec.europa.eu/eurostat/api/dissemination/sdmx/2.1/data/prc_hpi_q/Q.TOTAL.I15_Q.DE+FR+ES+IT+NL+IE+SE+PL+AT+EU27_2020?format=JSON&lastNPeriods=4
```

**35 pays couverts :** EU27, EA21, BE, BG, CZ, DK, DE, EE, IE, ES, FR, HR, IT, CY, LV, LT, LU, HU, MT, NL, AT, PL, PT, RO, SI, SK, FI, SE, IS, NO, CH, UK, TR

**Dimensions :**
- `purchase` : `TOTAL` (all), `DW_NEW` (neufs), `DW_EXST` (existants)
- `unit` : `I15_Q` (index 2015=100), `RCH_Q` (% trimestriel), `RCH_A` (% annuel)

**Mise a jour :** Trimestriel (derniere : 2026-04-07)

#### Eurostat — Loyers (prc_hicp_midx)

**Statut : VERIFIE — meme API SDMX**

```
GET https://ec.europa.eu/eurostat/api/dissemination/sdmx/2.1/data/prc_hicp_midx/M.I15.CP041.DE+FR+ES+IT+NL?format=JSON
```

- Code COICOP `CP041` = "Actual rentals for housing"
- Mensuel, index 2015=100
- Memes pays que le HPI

**Script a creer :** `scripts/sync/eurostat-housing.ts`
- Fetch HPI trimestriel + loyers mensuels
- Cache dans `data/raw/eurostat/`
- Ecrit dans `data/housing/eu/eurostat-hpi.json` et `eurostat-rents.json`

### 6.3 Pays EU a couvrir en priorite

| Pays | Pourquoi | Crise specifique |
|---|---|---|
| **Pays-Bas** | Pire penurie d'Europe, moratoriums construction | Files d'attente de 10+ ans pour le logement social |
| **Irlande** | Pire ratio prix/revenu d'Europe | Crise des sans-abri, prix x3 en 10 ans |
| **Allemagne** | Mietpreisbremse (frein aux loyers), crise Berlin | Referendum d'expropriation a Berlin |
| **France** | Loi SRU (25% logements sociaux), encadrement loyers Paris | Crise des banlieues |
| **Espagne** | Loi sur le logement 2023, plafonnement loyers | Protestations massives anti-tourisme |
| **Suede** | Systeme de queue unique (kösystem) | 10-20 ans d'attente a Stockholm |
| **Italie** | Sous-investissement chronique | Crise post-Superbonus |
| **Pologne** | Marche en surchauffe post-EU | Programmes gouvernementaux de subsides |
| **Autriche** | Modele Vienne (60% logement social) | Reference mondiale |

**Pour la legislation nationale :** Meme pattern que `lib/international-entities.ts` actuel — entites hand-curated avec legislation inline, enrichies par Claude research via `scripts/sync/international.ts`.

---

## 7. Region 4 : Australie & Asia-Pacific

### 7.1 Australie

#### ABS Residential Property Price Indexes

**Statut : VERIFIE — API SDMX-JSON, aucune auth**

```
GET https://api.data.abs.gov.au/data/ABS,RPPI/all?format=jsondata
```

**Regions couvertes :**
- National (AUS)
- 8 etats/territoires : NSW, VIC, QLD, SA, WA, TAS, NT, ACT
- 8 capitales : Greater Sydney, Melbourne, Brisbane, Adelaide, Perth, Hobart, Darwin, Canberra
- "Rest of [state]" pour chaque etat

**Donnees :** Index de prix, % de changement, volume de transactions

**Aussi disponible :** `ABS,LEND_HOUSING` — prets immobiliers (nombre et valeur)

**Script a creer :** `scripts/sync/abs-housing.ts`

#### Legislation australienne

- `legislation.gov.au` a une API JSON mais documentation sparse
- OpenAustralia API (`openaustralia.org.au/api/`) — Hansard debates, necessite cle gratuite
- **Strategy :** Claude research pour les lois en vigueur + OpenAustralia pour les debats

### 7.2 Singapour

#### HDB Resale Flat Prices

**Statut : VERIFIE — API CKAN JSON, aucune auth**

```
GET https://data.gov.sg/api/action/datastore_search?resource_id=f1765b54-a209-4718-8d38-a39237f502b3&limit=100
```

**228,732 transactions** depuis 2017

**Champs par transaction :**
- `month`, `town`, `flat_type`, `block`, `street_name`
- `storey_range`, `floor_area_sqm`, `flat_model`
- `lease_commence_date`, `remaining_lease`, `resale_price`

**Granularite :** 26 planning areas (towns), detail par bloc/rue

**Script a creer :** `scripts/sync/sg-hdb.ts`

### 7.3 Hong Kong

**RVD Price Index :** `https://www.rvd.gov.hk/doc/en/statistics/his_data_2.xls` — XLS mensuel, 480 KB
**Script :** `scripts/sync/hk-rvd.ts` (download + parse XLS)

### 7.4 Japon

**MLIT Real Estate Information Library :** `https://www.reinfolib.mlit.go.jp/?lang=en`
- API existe (`/ex-api/external/XIT001`) mais retourne 401 — registration requise
- **e-Stat API :** `https://www.e-stat.go.jp/en/stat-search/files` — necessite appId gratuit
- **Strategy :** Claude research + download manuel des rapports MLIT

### 7.5 Coree du Sud

**Korea REB :** `https://www.reb.or.kr/r-one/eng/statistics/statisticsViewer.do`
- Web viewer avec indices de prix des appartements
- Pas d'API publique confirmee
- **Strategy :** Claude research

### 7.6 Carte Asia-Pacific

Le composant `AsiaMap.tsx` actuel rend deja 50 pays ISO avec selection. Aucun changement de carte necessaire — seulement les entites de donnees.

---

## 8. Donnees globales cross-region

### OECD Housing Data (38 pays)

**Statut : VERIFIE — API SDMX REST, aucune auth**

**ATTENTION :** L'ancien endpoint `stats.oecd.org/restsdmx/` est **MORT** (404). Utiliser le nouveau :

```
GET https://sdmx.oecd.org/public/rest/data/OECD.ECO.MPD,DSD_AN_HOUSE_PRICES@DF_HOUSE_PRICES,/CAN.A..?startPeriod=2020&format=csvfilewithlabels
```

**7 metriques disponibles :**

| Code | Metrique |
|---|---|
| `HPI` | Nominal house price indices |
| `RHP` | Real house price indices |
| `RPI` | Rent prices |
| `HPI_RPI` | Price to rent ratio |
| `HPI_YDH` | Price to income ratio |
| `HPI_RPI_AVG` | Standardised price-rent ratio |
| `HPI_YDH_AVG` | Standardised price-income ratio |

**Format CSV (26 colonnes) :** `REF_AREA, FREQ, MEASURE, UNIT_MEASURE, TIME_PERIOD, OBS_VALUE, ...`

**Script a creer :** `scripts/sync/oecd-housing.ts`
- Query par pays individuellement (les requetes multi-pays retournent parfois "NoRecordsFound")
- Frequence annuelle
- Cache dans `data/raw/oecd/`
- Ecrit dans `data/housing/global/oecd-hpi.json`

### World Bank API (217 pays)

**Statut : VERIFIE — API JSON, aucune auth**

```
GET https://api.worldbank.org/v2/country/CAN/indicator/110400?format=json
```

**54 indicateurs logement** parmi 29,511 indicateurs totaux, incluant :
- `110400` — Housing, Water, Electricity, Gas and Other Fuels
- `9060000` — Actual Housing expenditure
- `ad_hsng_*` — ~40+ indicateurs sur le logement adequat par age, genre, handicap, urbain/rural

**Script a creer :** `scripts/sync/worldbank-housing.ts`

### Dallas Fed International House Price Database

**Meilleure source pour les series temporelles historiques :**
- Donnees trimestrielles depuis 1975
- HPI nominal, HPI reel, revenu disponible
- ~25 pays
- Format XLSX

---

## 9. Structure des fichiers de donnees

### Arborescence cible

```
data/
├── legislation/
│   ├── federal-ca.json            ← NOUVEAU (LEGISinfo)
│   ├── federal-us.json            ← RENOMME de federal.json (LegiScan)
│   ├── provinces/                 ← NOUVEAU
│   │   ├── ON.json
│   │   ├── BC.json
│   │   ├── QC.json
│   │   ├── AB.json
│   │   ├── MB.json
│   │   ├── SK.json
│   │   ├── NS.json
│   │   ├── NB.json
│   │   ├── NL.json
│   │   ├── PE.json
│   │   ├── NT.json
│   │   ├── YT.json
│   │   └── NU.json
│   ├── states/                    ← GARDE (LegiScan, mots-cles changes)
│   │   ├── Alabama.json → Wyoming.json (50 fichiers)
│   ├── uk/
│   │   └── bills.json             ← NOUVEAU (UK Parliament Bills API)
│   └── _irrelevant.json           ← GARDE
│
├── housing/                       ← ENTIEREMENT NOUVEAU
│   ├── canada/
│   │   ├── nhpi.json              ← StatsCan 18100205
│   │   ├── starts.json            ← StatsCan 34100135
│   │   ├── cpi-shelter.json       ← StatsCan 18100004
│   │   ├── cmhc-rental.json       ← CMHC vacancy + loyers
│   │   └── cmhc-starts.json       ← CMHC mises en chantier
│   ├── us/
│   │   ├── case-shiller.json      ← FRED CSUSHPISA
│   │   ├── fred-starts.json       ← FRED HOUST
│   │   ├── fred-mortgage.json     ← FRED MORTGAGE30US
│   │   ├── zillow-zhvi.json       ← Zillow home values par etat
│   │   ├── zillow-zori.json       ← Zillow rents par metro
│   │   ├── census-housing.json    ← ACS median values + rents par etat
│   │   └── hud-fmr.json           ← HUD Fair Market Rents
│   ├── uk/
│   │   └── land-registry.json     ← UK HPI par region
│   ├── eu/
│   │   ├── eurostat-hpi.json      ← prc_hpi_q (35 pays)
│   │   └── eurostat-rents.json    ← prc_hicp_midx CP041
│   ├── asia/
│   │   ├── aus-rppi.json          ← ABS prix par etat
│   │   ├── sg-hdb.json            ← HDB resale prices agreges
│   │   ├── hk-rvd.json            ← HK price index
│   │   └── jp-mlit.json           ← Japan price index
│   └── global/
│       ├── oecd-hpi.json          ← OECD 38 pays, 7 metriques
│       └── worldbank.json         ← World Bank indicateurs
│
├── projects/                      ← RENOMME de datacenters/
│   ├── major-developments.json    ← Grands projets (>500 unites)
│   └── international.json         ← Projets internationaux
│
├── figures/                       ← GARDE STRUCTURE
│   ├── federal-ca.json            ← NOUVEAU (ministres federaux CA)
│   ├── federal-us.json            ← RENOMME
│   ├── provinces/                 ← NOUVEAU
│   │   └── {Prov}.json
│   └── states/                    ← GARDE
│       └── {State}.json
│
├── international/                 ← GARDE (Claude research)
│   ├── netherlands.json → singapore.json (adapte au logement)
│
├── politicians/                   ← GARDE STRUCTURE
│   ├── ca-enriched.json           ← NOUVEAU (deputes + senateurs CA)
│   ├── us-enriched.json           ← GARDE (re-score pour logement)
│   ├── uk.json                    ← GARDE (re-score pour logement)
│   ├── eu.json                    ← GARDE (re-score pour logement)
│   └── global-leaders.json        ← GARDE (adapte)
│
├── news/
│   ├── feeds.json                 ← REMPLACE (feeds logement)
│   ├── summaries.json             ← MEME FORMAT
│   └── .rss-started               ← GARDE
│
├── municipal/                     ← GARDE (zonage municipal)
│   └── {province/state}.json
│
├── meta/
│   ├── last-sync.json
│   ├── legiscan-query-count.json
│   └── statcan-last-fetch.json    ← NOUVEAU
│
├── backup/                        ← GARDE (snapshots)
│
└── raw/                           (gitignored)
    ├── legiscan/                  ← GARDE
    ├── legisinfo/                 ← NOUVEAU (cache LEGISinfo)
    ├── claude/                    ← GARDE
    ├── statcan/                   ← NOUVEAU
    ├── cmhc/                      ← NOUVEAU
    ├── fred/                      ← NOUVEAU
    ├── zillow/                    ← NOUVEAU
    ├── eurostat/                  ← NOUVEAU
    ├── uk-bills/                  ← NOUVEAU
    ├── oecd/                      ← NOUVEAU
    └── abs/                       ← NOUVEAU
```

---

## 10. Adaptation des types TypeScript

### Fichier : `types/index.ts`

#### Types qui RESTENT identiques
- `Region` ("na" | "eu" | "asia")
- `Stage` ("Filed" | "Committee" | "Floor" | "Enacted" | "Carried Over" | "Dead")
- `StanceType` ("restrictive" | "concerning" | "review" | "favorable" | "none")
- `ViewTarget`, `NaView`
- `NewsItem`
- `Legislator` (structure)
- `Entity` (structure de base)

#### Types a REMPLACER

**ImpactTag (actuellement 26 tags AI) → ~20 tags logement :**
```
"affordability" | "displacement" | "density" |
"lot-splitting" | "inclusionary-zoning" |
"rent-stabilization" | "social-housing" |
"foreign-buyer" | "first-time-buyer" |
"homelessness" | "transit-oriented" |
"environmental-review" | "nimby" |
"community-opposition" | "vacancy-tax" |
"short-term-rental" | "heritage-protection" |
"mortgage-regulation" | "public-land" |
"indigenous-housing"
```

**LegislationCategory (actuellement 10 cat. AI) → 10 cat. logement :**
```
"zoning-reform" | "rent-regulation" |
"affordable-housing" | "development-incentive" |
"building-code" | "foreign-investment" |
"homelessness-services" | "tenant-protection" |
"transit-housing" | "property-tax"
```

**Dimension (actuellement 10 dimensions AI) → ~8 dimensions logement :**
```
"overall" | "affordability" | "supply" |
"rental-market" | "ownership" |
"social-housing" | "environmental" |
"community-impact"
```

**DimensionLens :**
```
"datacenter" | "ai"  →  "zoning" | "affordability"
```

#### Types a AJOUTER

**HousingMetrics (nouveau — n'existe pas dans le code actuel) :**
```typescript
interface HousingMetrics {
  // Prix
  nhpiIndex?: number;          // New Housing Price Index (StatsCan / equivalent)
  nhpiChangeYoY?: number;      // % changement annuel
  medianHomePrice?: number;    // Prix median en devise locale
  priceToIncomeRatio?: number; // OECD price-to-income

  // Location
  vacancyRate?: number;        // Taux de vacance (%)
  avgRent?: number;            // Loyer moyen
  avgRentChangeYoY?: number;   // % changement annuel du loyer
  priceToRentRatio?: number;   // OECD price-to-rent

  // Construction
  startsQuarterly?: number;    // Mises en chantier (trimestrielles)
  completionsQuarterly?: number;

  // Hypotheque
  mortgageRate?: number;       // Taux hypothecaire moyen

  // Metadata
  currency?: string;           // "CAD" | "USD" | "GBP" | "EUR" | "AUD" | ...
  lastUpdated?: string;        // ISO date
}
```

**HousingProject (remplace DataCenter) :**
```typescript
interface HousingProject {
  id: string;
  developer: string;           // Promoteur
  projectName?: string;
  location: string;
  state?: string;              // Province/etat
  country?: string;
  lat: number;
  lng: number;
  unitCount?: number;          // Nombre d'unites
  affordableUnits?: number;    // Unites abordables
  projectCost?: number;        // Cout du projet
  projectType?: "rental" | "condo" | "mixed" | "social" | "cooperative";
  status: "proposed" | "under-construction" | "operational";
  yearProposed?: number;
  yearCompleted?: number;
  notes?: string;
  concerns?: ImpactTag[];
  source: string;
}
```

**Modification a Entity :**
```typescript
interface Entity {
  // ... champs existants ...
  housingMetrics?: HousingMetrics;  // AJOUTE
  stanceZoning?: StanceType;        // REMPLACE stanceDatacenter
  stanceAffordability?: StanceType; // REMPLACE stanceAI
}
```

---

## 11. Adaptation des composants UI

### Composants qui ne changent PAS (95% du UI)

Ces composants sont parametres par les types — changer les types suffit :

| Composant | Fichier | Pourquoi ca marche |
|---|---|---|
| `StanceBadge` | `ui/StanceBadge.tsx` | Affiche `StanceType` → memes valeurs |
| `StagePill` | `ui/StagePill.tsx` | Affiche `Stage` → memes valeurs |
| `BillTimeline` | `ui/BillTimeline.tsx` | Generique |
| `SearchPill` | `ui/SearchPill.tsx` | Generique |
| `TopToolbar` | `ui/TopToolbar.tsx` | Generique |
| `DepthStepper` | `ui/DepthStepper.tsx` | Generique |
| `FadeInOnView` | `ui/FadeInOnView.tsx` | Generique |
| `Card` | `ui/Card.tsx` | Generique |
| `Breadcrumb` | `ui/Breadcrumb.tsx` | Generique |
| `VisitorsWidget` | `ui/VisitorsWidget.tsx` | Generique |
| `SidePanel` | `panel/SidePanel.tsx` | Tabs parametres par data |
| `LegislationList` | `panel/LegislationList.tsx` | Generique |
| `BillExpanded` | `panel/BillExpanded.tsx` | Generique |
| `NewsSection` | `panel/NewsSection.tsx` | Generique |
| `KeyFigures` | `panel/KeyFigures.tsx` | Generique |

### Composants a ADAPTER (changer les constantes)

#### `lib/dimensions.ts`

Ce fichier definit toute la logique de coloration de la carte. Il faut remplacer :

- `DIMENSION_TAGS` — mapper chaque dimension logement vers ses impact tags
- `DIMENSION_COLOR` — couleurs par dimension (palette logement)
- `DIMENSION_TEXT` — couleur du texte pour contraste
- `DIMENSION_GRADIENT` — gradients `{from, to}` pour l'interpolation sur la carte
- `DIMENSION_BLURB` — texte explicatif de chaque dimension
- `DATACENTER_DIMENSIONS` → `ZONING_DIMENSIONS`
- `AI_DIMENSIONS` → `AFFORDABILITY_DIMENSIONS`

#### `components/sections/DimensionToggle.tsx`

Changer les labels du lens segmented control :
- "Data Centers" → "Zoning"
- "AI Regulation" → "Affordability"

#### `components/sections/SummaryBar.tsx`

Changer les labels :
- "X of 50 states advancing AI regulation" → "X of 13 provinces with active housing reform" (ou equivalent US)
- La barre segmentee par stance reste identique

#### `components/sections/LegislationTable.tsx`

Changer les chip labels de filtres :

| Filtre | Actuel | Housing |
|---|---|---|
| Jurisdiction | all/us-federal/us-states/europe/asia | all/ca-federal/ca-provinces/us-federal/us-states/uk/europe/asia |
| Topic | data-center/governance/public-services/privacy | zoning/rent/affordable/development/tenant |
| Status | proposed/voting/passed/dead | IDENTIQUE |

#### `components/sections/DataCentersOverview.tsx` → `HousingProjectsOverview.tsx`

Renommer les colonnes et stats :

| Actuel | Housing |
|---|---|
| "Tracked" (count) | "Projects" |
| "Power" (MW/GW) | "Units" |
| "Investment" (USD) | "Investment" |
| "Compute" (H100e) | "Affordable %" |
| Column: operator | developer |
| Column: user | projectType |
| Column: power | unitCount |
| Column: cost | projectCost |
| Column: compute | affordableUnits |

#### `components/sections/LiveNews.tsx`

Changer les regex de topic detection :

| Actuel | Housing |
|---|---|
| `HIGH_SIGNAL`: lawsuit, moratorium, executive order... | moratorium, upzoning, rent freeze, eviction ban, housing emergency |
| `MED_SIGNAL`: policy, regulation, data center, grid... | development, permit, condo, CMHC, vacancy, zoning, affordable |
| Scope: us-federal/us-states/international | ca-federal/ca-provinces/us/uk/eu/asia |
| Topic: policy/data-centers/protests | legislation/construction/affordability/protests |

#### `components/sections/AIOverview.tsx`

Adapter :
- Les tabs restent NA / EU / AP
- Le prompt dans `news-regional-summary.ts` doit generer du contenu logement
- Les `CURATED` phrases de fallback doivent couvrir le logement
- Les topics de highlights : `legislation` / `infrastructure` / `cooperation` → `legislation` / `construction` / `affordability`

#### `components/sections/PoliticiansOverview.tsx`

Changer `FEATURED_PRIORITY` :
- Au lieu de Trump, Xi, Sanders, AOC → Ministre du logement CA, CMHC CEO, HUD Secretary US, maires cles
- Re-scorer par votes/positions sur le logement

#### `scripts/sync/news-rss.ts`

Changer `RELEVANCE_RE` (regex de pertinence) :
```
Actuel : /data.center|artificial.intelligence|AI.bill|ftc|moratorium|gigawatt/i
Housing : /housing|zoning|affordable|rent.control|CMHC|vacancy|condo|mortgage|homelessness|eviction|tenant|building.permit|rezoning|density|upzoning/i
```

#### `scripts/sync/legislation-classify.ts`

Remplacer les heuristiques de classification :
- `classifyCategory()` → nouveaux mots-cles logement
- `classifyTags()` → nouveaux impact tags
- `deriveStance()` → logique adaptee (moratorium = restrictive, incentive = favorable, etc.)

#### `components/map/MapShell.tsx`

**Le changement le plus significatif :** Generaliser le drill-down pour supporter Canada + US.

Modifications cles :
- `naView` → ajouter support pour les provinces canadiennes
- Selection d'une province → charger l'entite provinciale
- GeoId mapping : provinces canadiennes utilisent les codes ISO 3166-2:CA
- `selectedStateName` → generaliser en `selectedSubnationalName`

### Composants a CREER (n'existent pas)

Voir Section 15 ci-dessous.

---

## 12. Adaptation des scripts de sync

### Scripts existants a ADAPTER

| Script | Modification |
|---|---|
| `scripts/sync/news-rss.ts` | Nouveaux feeds + keywords + prompt Haiku |
| `scripts/sync/legislation-ingest.ts` | Nouveaux mots-cles LegiScan (US seulement) |
| `scripts/sync/legislation-classify.ts` | Nouvelles categories/tags/stances |
| `scripts/sync/legislation-dimension-stance.ts` | Nouvelles dimensions |
| `scripts/sync/news-regional-summary.ts` | Prompt Sonnet pour logement |
| `scripts/sync/international.ts` | Recherche logement par pays |
| `scripts/sync/municipal.ts` | Zonage municipal |
| `scripts/build-placeholder.ts` | Ajouter housingMetrics, provinces CA, UK |

### Scripts NOUVEAUX a creer

| Script | Source | Frequence recommandee |
|---|---|---|
| `scripts/sync/canada-legislation.ts` | LEGISinfo JSON feed | Hebdomadaire |
| `scripts/sync/bc-legislation.ts` | BC Laws XML API | Mensuel |
| `scripts/sync/uk-bills.ts` | UK Parliament Bills API | Hebdomadaire |
| `scripts/sync/eurlex-housing.ts` | EUR-Lex SPARQL | Mensuel |
| `scripts/sync/statcan-housing.ts` | StatsCan WDS API | Hebdomadaire |
| `scripts/sync/cmhc-housing.ts` | CMHC HMIP export | Hebdomadaire |
| `scripts/sync/fred-housing.ts` | FRED API | Hebdomadaire |
| `scripts/sync/zillow-housing.ts` | Zillow CSV direct download | Mensuel |
| `scripts/sync/census-housing.ts` | US Census ACS API | Mensuel |
| `scripts/sync/eurostat-housing.ts` | Eurostat SDMX API | Mensuel |
| `scripts/sync/uk-landregistry.ts` | UK Land Registry JSON API | Mensuel |
| `scripts/sync/abs-housing.ts` | ABS Australia SDMX API | Trimestriel |
| `scripts/sync/sg-hdb.ts` | data.gov.sg CKAN API | Mensuel |
| `scripts/sync/oecd-housing.ts` | OECD SDMX API | Trimestriel |
| `scripts/sync/worldbank-housing.ts` | World Bank API | Annuel |

### Scripts existants a SUPPRIMER (plus necessaires)

| Script | Raison |
|---|---|
| `scripts/sync/datacenters-epoch.ts` | Pas de data centers dans le housing tracker |
| `scripts/sync/datacenters-international.ts` | Idem |
| `scripts/sync/datacenters-researched.ts` | Idem |
| `scripts/sync/eia-plants.ts` | Donnees energetiques US |
| `scripts/sync/eia-state-profiles.ts` | Idem |
| `scripts/sync/water-features.ts` | Donnees eau pour data centers |
| `scripts/sync/votes-congress.ts` | A adapter si on veut tracker les votes logement |
| `scripts/sync/votes-enrich.ts` | Idem |

---

## 13. GitHub Actions & automatisation

### Workflows cibles (3 au lieu de 1)

#### Workflow 1 : `news-rss.yml` (adapte)

```yaml
name: Housing News RSS Poll
on:
  schedule:
    - cron: "0 9,15,23 * * *"    # 3x/jour
  workflow_dispatch:
    inputs:
      restart:
        description: "Reset the 14-day RSS window"
        type: boolean

jobs:
  poll:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 1 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npx tsx scripts/sync/news-rss.ts
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
      # ... commit si changements
```

**Secrets :** `ANTHROPIC_API_KEY`

#### Workflow 2 : `metrics-sync.yml` (NOUVEAU)

```yaml
name: Housing Metrics Sync
on:
  schedule:
    - cron: "0 6 * * 1"    # Chaque lundi a 6h UTC
  workflow_dispatch: {}

jobs:
  sync:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci

      # Canada
      - run: npx tsx scripts/sync/statcan-housing.ts
      - run: npx tsx scripts/sync/cmhc-housing.ts

      # USA
      - run: npx tsx scripts/sync/fred-housing.ts
        env:
          FRED_API_KEY: ${{ secrets.FRED_API_KEY }}
      - run: npx tsx scripts/sync/zillow-housing.ts
      - run: npx tsx scripts/sync/census-housing.ts

      # UK + EU
      - run: npx tsx scripts/sync/uk-landregistry.ts
      - run: npx tsx scripts/sync/eurostat-housing.ts

      # Asia-Pacific
      - run: npx tsx scripts/sync/abs-housing.ts
      - run: npx tsx scripts/sync/sg-hdb.ts

      # Global
      - run: npx tsx scripts/sync/oecd-housing.ts

      # Rebuild
      - run: npx tsx scripts/build-placeholder.ts
      # ... commit si changements
```

**Secrets :** `FRED_API_KEY` (cle gratuite)

#### Workflow 3 : `legislation-sync.yml` (NOUVEAU)

```yaml
name: Housing Legislation Sync
on:
  schedule:
    - cron: "0 7 * * 3"    # Chaque mercredi a 7h UTC
  workflow_dispatch: {}

jobs:
  sync:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci

      # Canada federal
      - run: npx tsx scripts/sync/canada-legislation.ts

      # Canada provincial (BC)
      - run: npx tsx scripts/sync/bc-legislation.ts

      # USA (LegiScan)
      - run: npx tsx scripts/sync/legislation-ingest.ts
        env:
          LEGISCAN_API_KEY: ${{ secrets.LEGISCAN_API_KEY }}
      - run: npx tsx scripts/sync/legislation-classify.ts
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}

      # UK
      - run: npx tsx scripts/sync/uk-bills.ts

      # EU
      - run: npx tsx scripts/sync/eurlex-housing.ts

      # Rebuild
      - run: npx tsx scripts/build-placeholder.ts
      # ... commit si changements
```

**Secrets :** `LEGISCAN_API_KEY`, `ANTHROPIC_API_KEY`

---

## 14. News RSS — feeds par region

### Feeds confirmes fonctionnels (remplacement de `data/news/feeds.json`)

| # | Region | Feed | URL | Statut |
|---|---|---|---|---|
| 1 | CA | Globe & Mail Real Estate | `https://www.theglobeandmail.com/arc/outboundfeeds/rss/category/real-estate/` | Verifie |
| 2 | CA | Financial Post | `https://financialpost.com/feed` | Verifie |
| 3 | CA | BNN Bloomberg | `https://www.bnnbloomberg.ca/arc/outboundfeeds/rss/?outputType=xml` | Verifie |
| 4 | CA | CBC Canada | `https://rss.cbc.ca/lineup/canada.xml` | Verifie |
| 5 | CA | Bank of Canada | `https://www.bankofcanada.ca/feed/` | Verifie |
| 6 | CA | Google News Housing CA | `https://news.google.com/rss/search?q=%22housing+affordability%22+OR+%22housing+crisis%22+Canada&hl=en-CA&gl=CA&ceid=CA:en` | Verifie, 100 items |
| 7 | US | Google News Housing US | `https://news.google.com/rss/search?q=%22housing+crisis%22+OR+%22zoning+reform%22+US&hl=en-US&gl=US&ceid=US:en` | Non teste mais pattern Google News fonctionne |
| 8 | UK | The Guardian Housing | `https://www.theguardian.com/society/housing/rss` | Verifie |
| 9 | UK | BBC Your Money | `https://feeds.bbci.co.uk/news/business/your_money/rss.xml` | Verifie |
| 10 | EU | EUobserver | `https://euobserver.com/rss` | Verifie (general, filtrer par keywords) |
| 11 | AU | SBS Australia | `https://www.sbs.com.au/news/feed` | Verifie (general, filtrer par keywords) |
| 12 | CA | Canada Gazette Part I | `https://gazette.gc.ca/rss/p1-eng.xml` | Verifie (reglements) |
| 13 | CA | Canada Gazette Part II | `https://gazette.gc.ca/rss/p2-eng.xml` | Verifie (reglements) |
| 14 | Global | Google News Housing Global | `https://news.google.com/rss/search?q=%22housing+affordability%22+OR+%22housing+crisis%22&hl=en` | Pattern Google News |

**Feeds NON fonctionnels (a eviter) :**
- CMHC Blog (`/blog/feed`) → retourne HTML
- CMHC News Releases → 404
- StatCan Daily → 404
- Euractiv → 403
- Domain.com.au → connection error
- AFR Property → 404
- Inside Housing UK → connection error

---

## 15. Nouveaux composants a creer

### MetricsStrip

**But :** Afficher 3-4 KPIs numeriques animes en haut de la page (ou dans la SummaryBar).

**Contenu :**
- NHPI national : +X.X% YoY (ou equivalent par region)
- Vacancy rate : X.X%
- Housing starts : X,XXX / trimestre
- Median price : $XXX,XXX

**Implementation :** Utiliser `@number-flow/react` (deja installe) pour les animations de chiffres. Composant simple : une rangee de 3-4 stat boxes avec label + valeur animee + fleche de tendance.

**Placement :** Au-dessus ou a cote de `SummaryBar`, section "At a Glance" de la page d'accueil.

### MetricsPanel

**But :** Tab dans le SidePanel montrant les metriques quantitatives de l'entite selectionnee.

**Contenu :** Remplace le tab "Energy" actuel. Affiche les `housingMetrics` de l'entite :
- Prix median, % changement
- Loyer moyen, % changement
- Taux de vacance
- Mises en chantier
- Price-to-income ratio (si OECD disponible)

**Implementation :** Composant de ~200 lignes dans `components/panel/MetricsPanel.tsx`. Structure : grille de stat cards avec sparklines optionnels.

### TrendSparkline (optionnel)

**But :** Mini-graphique SVG inline (12 mois de NHPI) dans les cartes de metrique.

**Implementation :** SVG simple de ~50 lignes, pas de librairie de charts. Un `<polyline>` avec les 12 derniers points.

### AffordabilityHeatmap (optionnel, phase ulterieure)

**But :** Overlay de couleur continue sur la carte, base sur le price-to-income ratio par entite.

**Implementation :** Utiliser le meme systeme `getEntityColorForDimension()` de `lib/dimensions.ts` — il interpole deja un gradient par score. Il suffit de definir un `DIMENSION_GRADIENT` pour "affordability" et de calculer le score a partir de `housingMetrics.priceToIncomeRatio`.

---

## 16. Roadmap d'implementation

### Phase 0 : Setup (1-2 jours)

- [ ] Forker le repo (ou creer une branche `housing-tracker`)
- [ ] Modifier `package.json` : nom, description
- [ ] Creer `.env.local` avec les cles necessaires :
  - `ANTHROPIC_API_KEY` (deja existante)
  - `LEGISCAN_API_KEY` (deja existante)
  - `FRED_API_KEY` (nouvelle, gratuite)
- [ ] Creer les dossiers : `data/housing/canada/`, `data/housing/us/`, etc.
- [ ] Creer les dossiers raw : `data/raw/legisinfo/`, `data/raw/statcan/`, etc.
- [ ] Mettre a jour `.gitignore` pour les nouveaux dossiers raw

### Phase 1 : Canada — donnees et pipeline (3-5 jours)

**Priorite absolue — le Canada doit fonctionner en premier.**

- [ ] Creer `scripts/sync/canada-legislation.ts` (LEGISinfo JSON feed)
- [ ] Creer `scripts/sync/statcan-housing.ts` (NHPI + starts + CPI)
- [ ] Creer `scripts/sync/cmhc-housing.ts` (vacancy + rents)
- [ ] Modifier `types/index.ts` : nouveaux ImpactTag, LegislationCategory, Dimension, DimensionLens, HousingMetrics, HousingProject
- [ ] Creer `data/legislation/federal-ca.json` (premier run de canada-legislation.ts)
- [ ] Creer `data/legislation/provinces/` (BC via bc-legislation.ts, autres via Claude research)
- [ ] Creer `data/housing/canada/nhpi.json` etc. (premier run de statcan-housing.ts)
- [ ] Modifier `scripts/build-placeholder.ts` pour inclure les entites canadiennes avec housingMetrics
- [ ] Run `npm run data:rebuild` et verifier le build

### Phase 2 : Canada — UI (3-5 jours)

- [ ] Modifier `lib/dimensions.ts` : nouvelles dimensions, couleurs, gradients, blurbs
- [ ] Modifier `components/map/MapShell.tsx` : drill-down provinces canadiennes
- [ ] Modifier `components/sections/DimensionToggle.tsx` : labels "Zoning" / "Affordability"
- [ ] Modifier `components/sections/SummaryBar.tsx` : labels canadiens
- [ ] Modifier `components/sections/LegislationTable.tsx` : nouveaux filtres
- [ ] Creer `components/panel/MetricsPanel.tsx`
- [ ] Creer `components/sections/MetricsStrip.tsx`
- [ ] Modifier `app/page.tsx` : integrer MetricsStrip, renommer les sections
- [ ] Tester le drill-down : Globe → Canada → Provinces → details

### Phase 3 : USA (2-3 jours)

- [ ] Modifier `scripts/sync/legislation-ingest.ts` : nouveaux mots-cles
- [ ] Modifier `scripts/sync/legislation-classify.ts` : nouvelles heuristiques
- [ ] Creer `scripts/sync/fred-housing.ts`
- [ ] Creer `scripts/sync/zillow-housing.ts`
- [ ] Creer `scripts/sync/census-housing.ts`
- [ ] Run les scripts et verifier les donnees
- [ ] Les 50 etats US fonctionneront automatiquement (meme pipeline, mots-cles differents)

### Phase 4 : UK + EU (2-3 jours)

- [ ] Creer `scripts/sync/uk-bills.ts` (UK Parliament Bills API)
- [ ] Creer `scripts/sync/uk-landregistry.ts`
- [ ] Creer `scripts/sync/eurostat-housing.ts`
- [ ] Creer `scripts/sync/eurlex-housing.ts`
- [ ] Adapter `lib/international-entities.ts` : entites EU avec legislation logement
- [ ] Run `scripts/sync/international.ts` avec prompts logement

### Phase 5 : Australie & Asia-Pacific (1-2 jours)

- [ ] Creer `scripts/sync/abs-housing.ts`
- [ ] Creer `scripts/sync/sg-hdb.ts`
- [ ] Adapter les entites Asia-Pacific dans `lib/international-entities.ts`

### Phase 6 : News & automatisation (1-2 jours)

- [ ] Remplacer `data/news/feeds.json` avec les feeds logement
- [ ] Adapter les regex dans `scripts/sync/news-rss.ts`
- [ ] Adapter le prompt dans `scripts/sync/news-regional-summary.ts`
- [ ] Creer `.github/workflows/metrics-sync.yml`
- [ ] Creer `.github/workflows/legislation-sync.yml`
- [ ] Tester les 3 workflows manuellement via `workflow_dispatch`

### Phase 7 : Polish & donnees globales (1-2 jours)

- [ ] Creer `scripts/sync/oecd-housing.ts`
- [ ] Creer `scripts/sync/worldbank-housing.ts`
- [ ] Adapter `components/sections/DataCentersOverview.tsx` → HousingProjectsOverview
- [ ] Adapter `components/sections/PoliticiansOverview.tsx` : nouveaux featured
- [ ] Adapter `app/about/page.tsx`, `app/methodology/page.tsx` : nouveau contenu
- [ ] Nettoyer les scripts inutiles (datacenters-*, eia-*, water-*)
- [ ] Verifier le build final : `npm run build`

### Estimation totale : 15-25 jours de travail

---

## 17. Couts et limites

### Couts mensuels estimes

| Poste | Cout |
|---|---|
| Claude Haiku — news summaries (3x/jour, ~50 items/jour) | ~$4.50 |
| Claude Sonnet — regional prose (5 regions, on demand) | ~$2.00 |
| Claude Sonnet — international research (mensuel) | ~$3.00 |
| Claude — bill classification (hebdomadaire) | ~$3.60 |
| FRED API | $0 (gratuit) |
| LegiScan API | $0 (free tier, 30k queries/mois) |
| StatsCan WDS API | $0 (gratuit, sans auth) |
| CMHC | $0 (endpoint non-documente) |
| Eurostat API | $0 (gratuit, sans auth) |
| UK Land Registry API | $0 (gratuit, sans auth) |
| UK Bills API | $0 (gratuit, sans auth) |
| ABS Australia API | $0 (gratuit, sans auth) |
| Singapore HDB API | $0 (gratuit, sans auth) |
| OECD SDMX API | $0 (gratuit, sans auth) |
| World Bank API | $0 (gratuit, sans auth) |
| Zillow CSV | $0 (telechargement direct) |
| US Census API | $0 (gratuit) |
| **Total mensuel** | **~$13/mois** |

### Limites et risques identifies

| Risque | Impact | Mitigation |
|---|---|---|
| CMHC endpoint non-documente | Peut casser sans preavis | Cache agressif, fallback vers StatsCan |
| LEGISinfo recherche titre seulement | Bills pertinents manques | Rechercher plusieurs mots-cles, enrichir avec Claude |
| Pas d'API provinciale (sauf BC) | Couverture provinciale limitee | CanLII API + Claude research + scraping |
| RASFF (EU) API non-documentee | Peut changer | Pas critique pour le housing tracker |
| LegiScan = US seulement | Pas de bills canadiens via LegiScan | LEGISinfo pour le federal, BC Laws pour BC |
| OECD multi-country queries | Retournent parfois "NoRecordsFound" | Query par pays individuellement |
| Zillow CSV = 120 MB (ZIP level) | Trop gros pour le repo | Utiliser State (298 KB) ou Metro (4.4 MB) |
| Pas de source agregee de zonage municipal CA | Donnees municipales fragmentees | Claude research + OpenCouncil.ca |

### Secrets GitHub Actions necessaires

| Secret | Source | Gratuit? |
|---|---|---|
| `ANTHROPIC_API_KEY` | Deja configure | Payant (~$13/mois) |
| `LEGISCAN_API_KEY` | Deja configure | Gratuit (30k/mois) |
| `FRED_API_KEY` | `fred.stlouisfed.org/docs/api/api_key.html` | Gratuit (inscription) |

---

## Annexe A : Endpoints API verifies

Tous les endpoints ci-dessous ont ete testes et confirmes fonctionnels au 2026-04-15.

### Canada
```
# LEGISinfo (bills federaux)
GET  https://www.parl.ca/legisinfo/en/bills/json?text=housing&parlsession=45-1

# StatsCan WDS (metriques)
POST https://www150.statcan.gc.ca/t1/wds/rest/getCubeMetadata
POST https://www150.statcan.gc.ca/t1/wds/rest/getDataFromCubePidCoordAndLatestNPeriods
GET  https://www150.statcan.gc.ca/t1/wds/rest/getFullTableDownloadCSV/{productId}/en

# BC Laws (legislation provinciale BC)
GET  https://www.bclaws.gov.bc.ca/civix/search/complete/fullsearch?q=housing&s=0&e=5

# CMHC (donnees locatives — non-documente)
POST https://www03.cmhc-schl.gc.ca/hmip-pimh/en/TableMapChart/ExportTable

# Canada Gazette (reglements federaux)
GET  https://gazette.gc.ca/rss/p1-eng.xml
GET  https://gazette.gc.ca/rss/p2-eng.xml
```

### USA
```
# LegiScan (bills US)
GET  https://api.legiscan.com/?key={KEY}&op=getSearch&state=US&query=housing

# FRED (metriques US)
GET  https://api.stlouisfed.org/fred/series/observations?series_id=CSUSHPISA&api_key={KEY}&file_type=json

# Zillow (prix/loyers)
GET  https://files.zillowstatic.com/research/public_csvs/zhvi/State_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv
GET  https://files.zillowstatic.com/research/public_csvs/zori/Metro_zori_uc_sfrcondomfr_sm_sa_month.csv

# US Census (ACS)
GET  https://api.census.gov/data/2023/acs/acs1?get=NAME,B25077_001E,B25064_001E&for=state:*
```

### UK
```
# UK Parliament Bills
GET  https://bills-api.parliament.uk/api/v1/Bills?SearchTerm=housing&SortOrder=DateUpdatedDescending

# UK Land Registry HPI
GET  https://landregistry.data.gov.uk/data/ukhpi/region/united-kingdom/month/2025-12.json
```

### EU
```
# Eurostat HPI
GET  https://ec.europa.eu/eurostat/api/dissemination/sdmx/2.1/data/prc_hpi_q/Q.TOTAL.I15_Q.EU27_2020?format=JSON

# Eurostat Rents
GET  https://ec.europa.eu/eurostat/api/dissemination/sdmx/2.1/data/prc_hicp_midx/M.I15.CP041.DE+FR?format=JSON

# EUR-Lex SPARQL
POST https://publications.europa.eu/webapi/rdf/sparql
```

### Australie & Asia-Pacific
```
# ABS Australia
GET  https://api.data.abs.gov.au/data/ABS,RPPI/all?format=jsondata

# Singapore HDB
GET  https://data.gov.sg/api/action/datastore_search?resource_id=f1765b54-a209-4718-8d38-a39237f502b3&limit=100

# Hong Kong RVD
GET  https://www.rvd.gov.hk/doc/en/statistics/his_data_2.xls
```

### Global
```
# OECD Housing
GET  https://sdmx.oecd.org/public/rest/data/OECD.ECO.MPD,DSD_AN_HOUSE_PRICES@DF_HOUSE_PRICES,/CAN.A..?format=csvfilewithlabels

# World Bank
GET  https://api.worldbank.org/v2/country/CAN/indicator/110400?format=json
```

### News RSS (confirmes)
```
https://www.theglobeandmail.com/arc/outboundfeeds/rss/category/real-estate/
https://financialpost.com/feed
https://www.bnnbloomberg.ca/arc/outboundfeeds/rss/?outputType=xml
https://rss.cbc.ca/lineup/canada.xml
https://www.bankofcanada.ca/feed/
https://news.google.com/rss/search?q=%22housing+affordability%22+Canada&hl=en-CA&gl=CA&ceid=CA:en
https://www.theguardian.com/society/housing/rss
https://feeds.bbci.co.uk/news/business/your_money/rss.xml
https://euobserver.com/rss
https://www.sbs.com.au/news/feed
```

---

## Annexe B : Inventaire complet du repo actuel

### Fichiers racine
```
package.json          (1.4K)    — Dependencies & scripts
tsconfig.json         (700B)    — TypeScript config
next.config.ts        (1.5K)    — Next.js config (image hosts, tree-shake)
eslint.config.mjs     (483B)    — ESLint config
postcss.config.mjs    (~200B)   — PostCSS / Tailwind v4
.npmrc                (23B)     — NPM config
next-env.d.ts         (257B)    — Next.js types (auto-generated)
README.md             (781B)    — Description du projet
AGENTS.md             (332B)    — Agent documentation
CLAUDE.md             (12B)     — Claude instructions
.gitignore            (684B)    — Exclut .next, node_modules, .env, /data/raw
```

### Nombre de fichiers par dossier
```
app/                  20 fichiers   (pages + API + sandboxes)
components/           50 fichiers   (hero, map, panel, politicians, sections, ui)
scripts/              42 fichiers   (sync, cleanup, smoke)
lib/                  15 fichiers   (data loaders, utils)
types/                 1 fichier    (index.ts — 17K)
data/                223 fichiers   (~13.7 MB total)
public/                7 fichiers   (assets statiques)
.github/workflows/     1 fichier    (news-rss.yml)
```

### Dependencies production
```
next@16.2.3, react@19.2.4, react-dom@19.2.4
@vercel/analytics@2.0.1, @vercel/kv@3.0.0
framer-motion@12.38.0, maplibre-gl@5.23.0
react-simple-maps@3.0.0, d3-geo@3.1.1, topojson-client@3.1.0
cobe@2.0.1, @number-flow/react@0.6.0, react-grab@0.1.31
```

### Dependencies dev
```
typescript@5, @anthropic-ai/sdk@0.88.0
tailwindcss@4, @tailwindcss/postcss@4
eslint@9, eslint-config-next@16.2.3
tsx@4.21.0, dotenv@17.4.1
@types/react, @types/node, @types/d3-geo, @types/topojson-client
```
