export type Region = "na" | "eu" | "asia";

/** Sub-view inside the NA region: countries → states/provinces → counties/census-divisions drill-down. */
export type NaView = "countries" | "states" | "provinces" | "counties" | "census-divisions";

export interface ViewTarget {
  region: Region;
  naView: NaView;
  selectedGeoId: string | null;
  /** State to drill into for county view. Full name, e.g. "Virginia". */
  selectedStateName?: string | null;
  /** 5-digit FIPS of the selected county (when naView === "counties"). */
  selectedCountyFips?: string | null;
  /** 2-digit PRUID of the province to drill into for census-division view. */
  selectedProvinceUid?: string | null;
  /** Province name for census-division breadcrumb. */
  selectedProvinceName?: string | null;
  /** 4-digit CDUID of the selected census division. */
  selectedCduid?: string | null;
}

export type MunicipalActionStatus =
  | "enacted"
  | "proposed"
  | "under-review"
  | "failed";

export interface MunicipalAction {
  title: string;
  date: string;
  status: MunicipalActionStatus;
  summary: string;
  sourceUrl?: string;
}

export interface MunicipalEntity {
  id: string;
  name: string;
  /** 5-digit FIPS code matching the us-atlas counties-10m.json feature id. */
  fips: string;
  state: string;
  stateCode: string;
  type: "county" | "city" | "town" | "township";
  actions: MunicipalAction[];
  concerns: ImpactTag[];
  contextBlurb: string;
}

/** State name → 2-digit FIPS prefix. */
export const STATE_FIPS: Record<string, string> = {
  Alabama: "01",
  Alaska: "02",
  Arizona: "04",
  Arkansas: "05",
  California: "06",
  Colorado: "08",
  Connecticut: "09",
  Delaware: "10",
  Florida: "12",
  Georgia: "13",
  Hawaii: "15",
  Idaho: "16",
  Illinois: "17",
  Indiana: "18",
  Iowa: "19",
  Kansas: "20",
  Kentucky: "21",
  Louisiana: "22",
  Maine: "23",
  Maryland: "24",
  Massachusetts: "25",
  Michigan: "26",
  Minnesota: "27",
  Mississippi: "28",
  Missouri: "29",
  Montana: "30",
  Nebraska: "31",
  Nevada: "32",
  "New Hampshire": "33",
  "New Jersey": "34",
  "New Mexico": "35",
  "New York": "36",
  "North Carolina": "37",
  "North Dakota": "38",
  Ohio: "39",
  Oklahoma: "40",
  Oregon: "41",
  Pennsylvania: "42",
  "Rhode Island": "44",
  "South Carolina": "45",
  "South Dakota": "46",
  Tennessee: "47",
  Texas: "48",
  Utah: "49",
  Vermont: "50",
  Virginia: "51",
  Washington: "53",
  "West Virginia": "54",
  Wisconsin: "55",
  Wyoming: "56",
};

/** Province/territory name → 2-digit PRUID (SGC code). */
export const PROVINCE_UID: Record<string, string> = {
  "Newfoundland and Labrador": "10",
  "Prince Edward Island": "11",
  "Nova Scotia": "12",
  "New Brunswick": "13",
  "Quebec": "24",
  "Ontario": "35",
  "Manitoba": "46",
  "Saskatchewan": "47",
  "Alberta": "48",
  "British Columbia": "59",
  "Yukon": "60",
  "Northwest Territories": "61",
  "Nunavut": "62",
};

/** 2-digit PRUID → ISO 3166-2:CA two-letter abbreviation. */
export const PROVINCE_ABBR: Record<string, string> = {
  "10": "NL",
  "11": "PE",
  "12": "NS",
  "13": "NB",
  "24": "QC",
  "35": "ON",
  "46": "MB",
  "47": "SK",
  "48": "AB",
  "59": "BC",
  "60": "YT",
  "61": "NT",
  "62": "NU",
};

/** 2-digit PRUID → English province name (reverse of PROVINCE_UID). */
export const PROVINCE_NAME: Record<string, string> = Object.fromEntries(
  Object.entries(PROVINCE_UID).map(([name, uid]) => [uid, name]),
);

export type Stage =
  | "Filed"
  | "Committee"
  | "Floor"
  | "Enacted"
  | "Carried Over"
  | "Dead";

/**
 * Where a jurisdiction stands on housing policy. The semantic axis runs
 * from "actively restricting development" (restrictive) to "actively
 * encouraging supply / affordability" (favorable).
 *
 *  - restrictive  — Active moratoriums, hard caps, or major barriers.
 *  - concerning   — Significant regulation with teeth, but not an
 *                   outright stop. Mixed signals.
 *  - review       — Studying, hearings, non-binding frameworks, bills
 *                   filed but stalled.
 *  - favorable    — Pro-supply: upzoning, density bonuses, incentives,
 *                   fast-track permitting.
 *  - none         — No major activity tracked.
 */
export type StanceType =
  | "restrictive"
  | "review"
  | "favorable"
  | "concerning"
  | "none";

/**
 * Single label map used for both US states and countries. Replaces the
 * older Restricting / Cautionary / Under Review / No Activity / Encouraging
 * system — those were vague and didn't work equally for both contexts.
 */
export const STANCE_LABEL: Record<StanceType, string> = {
  restrictive: "Active Restrictions",
  concerning: "Legislative Process",
  review: "Under Discussion",
  none: "No Action",
  favorable: "Innovation-Friendly",
};

export type GovLevel = "federal" | "state" | "bloc";

export type ImpactTag =
  | "affordability"
  | "displacement"
  | "density"
  | "lot-splitting"
  | "inclusionary-zoning"
  | "rent-stabilization"
  | "social-housing"
  | "foreign-buyer"
  | "first-time-buyer"
  | "homelessness"
  | "transit-oriented"
  | "environmental-review"
  | "nimby"
  | "community-opposition"
  | "vacancy-tax"
  | "short-term-rental"
  | "heritage-protection"
  | "mortgage-regulation"
  | "public-land"
  | "indigenous-housing";

export type LegislationCategory =
  | "zoning-reform"
  | "rent-regulation"
  | "affordable-housing"
  | "development-incentive"
  | "building-code"
  | "foreign-investment"
  | "homelessness-services"
  | "tenant-protection"
  | "transit-housing"
  | "property-tax";

export type Dimension =
  | "overall"
  // Zoning lens
  | "affordability"
  | "supply"
  | "rental-market"
  | "ownership"
  // Affordability lens
  | "social-housing"
  | "environmental"
  | "community-impact";

export type DimensionLens = "zoning" | "affordability";

export const ZONING_DIMENSIONS: Dimension[] = [
  "affordability",
  "supply",
  "rental-market",
  "ownership",
];

export const AFFORDABILITY_DIMENSIONS: Dimension[] = [
  "social-housing",
  "environmental",
  "community-impact",
];

export const IMPACT_TAG_LABEL: Record<ImpactTag, string> = {
  affordability: "Affordability",
  displacement: "Displacement",
  density: "Density",
  "lot-splitting": "Lot Splitting",
  "inclusionary-zoning": "Inclusionary Zoning",
  "rent-stabilization": "Rent Stabilization",
  "social-housing": "Social Housing",
  "foreign-buyer": "Foreign Buyer",
  "first-time-buyer": "First-Time Buyer",
  homelessness: "Homelessness",
  "transit-oriented": "Transit-Oriented",
  "environmental-review": "Environmental Review",
  nimby: "NIMBY",
  "community-opposition": "Community Opposition",
  "vacancy-tax": "Vacancy Tax",
  "short-term-rental": "Short-Term Rental",
  "heritage-protection": "Heritage Protection",
  "mortgage-regulation": "Mortgage Regulation",
  "public-land": "Public Land",
  "indigenous-housing": "Indigenous Housing",
};

export const CATEGORY_LABEL: Record<LegislationCategory, string> = {
  "zoning-reform": "Zoning",
  "rent-regulation": "Rent Regulation",
  "affordable-housing": "Affordable Housing",
  "development-incentive": "Development Incentive",
  "building-code": "Building Code",
  "foreign-investment": "Foreign Investment",
  "homelessness-services": "Homelessness",
  "tenant-protection": "Tenant Protection",
  "transit-housing": "Transit Housing",
  "property-tax": "Property Tax",
};

export const DIMENSION_LABEL: Record<Dimension, string> = {
  overall: "Overall stance",
  // Zoning lens
  affordability: "Affordability",
  supply: "Housing supply",
  "rental-market": "Rental market",
  ownership: "Home ownership",
  // Affordability lens
  "social-housing": "Social housing",
  environmental: "Environmental impact",
  "community-impact": "Community impact",
};

export interface Legislation {
  id: string;
  billCode: string;
  title: string;
  summary: string;
  stage: Stage;
  /** Per-bill stance, primarily from Claude semantic classification. */
  stance?: StanceType;
  /**
   * Per-dimension stance overrides. A bill can read differently across
   * dimensions (e.g. pro-development on data-center-energy, restrictive
   * on ai-consumer). Only set for multi-dimension bills — single-dim
   * bills defer to `stance`.
   */
  dimensionStances?: Partial<Record<Exclude<Dimension, "overall">, StanceType>>;
  impactTags: ImpactTag[];
  category: LegislationCategory;
  updatedDate: string;
  partyOrigin?: "R" | "D" | "B";
  sourceUrl?: string;
  /** Project IDs referenced by this bill/action. Populated for municipal
   *  actions where the action's title/summary mentions a specific housing
   *  project by developer + location. Used to render "Related projects"
   *  chips inside the expanded bill card. */
  relatedFacilityIds?: string[];
  legiscanUrl?: string;
  legiscanId?: number;
  sponsors?: string[];
  /** Roll call vote results, if the bill reached a floor vote. */
  voteTally?: {
    yea: number;
    nay: number;
    abstain: number;
    notVoting: number;
    passed: boolean;
    voteDate: string;
    rollCallId?: string;
  };
}

export type VotePosition = "yea" | "nay" | "abstain" | "not-voting";

/** A single recorded vote on a specific bill. */
export interface VoteRecord {
  /** Links to Legislation.id in our dataset. */
  billId: string;
  billCode: string;
  voteDate: string;
  position: VotePosition;
  /** Source roll call identifier for provenance. */
  rollCallId?: string;
  sourceUrl?: string;
}

/**
 * Vote alignment score — compares stated stance against actual votes.
 * Only computed when totalVotes >= 3.
 */
export interface AlignmentScore {
  /** 0–100. 100 = perfect alignment between stated position and votes. */
  score: number;
  totalVotes: number;
  alignedVotes: number;
  contradictoryVotes: number;
  /** Notable contradictions worth surfacing in the UI. */
  flaggedVotes?: Array<{
    billId: string;
    billCode: string;
    expectedPosition: VotePosition;
    actualPosition: VotePosition;
    reason: string;
  }>;
}

/**
 * A "suspicious vote" from the corruption-map dataset — a vote that
 * appears to align with a legislator's top donor industries rather
 * than their party or constituents. Cleaned + deduplicated form of
 * the raw entries in data/donors/politicians.json.
 */
export interface SuspiciousVote {
  billCode: string;
  billTitle: string;
  position: VotePosition;
  /** Which donor industry this vote appears to serve. */
  industry: string;
  /** Why this vote is flagged. One sentence. */
  reason: string;
  confidence: "high" | "medium";
}

export interface Legislator {
  id: string;
  name: string;
  role: string;
  party: string;
  stance: StanceType;
  /** Stable external ID for cross-referencing.
   *  - US: bioguide ID (e.g. "V000128")
   *  - UK: TheyWorkForYou person_id (e.g. "25320") */
  externalId?: string;
  /** FEC candidate ID from politicians.json (e.g. "H2TX00064"). */
  fecId?: string;
  /** "US" | "GB" | "EU" */
  country?: string;
  /** "senate" | "house" | "commons" | "lords" | "ep" */
  chamber?: string;
  /** State (US) or constituency (UK). */
  constituency?: string;
  /** Official portrait URL. Only set if confirmed working. */
  photoUrl?: string;
  votes?: VoteRecord[];
  alignment?: AlignmentScore;
  suspiciousVotes?: SuspiciousVote[];
  /** Combined capture score from donor data. 0–100. */
  captureScore?: number;
  totalRaised?: number;
  /** 1–2 sentence narrative of their housing policy work (mainly UK/EU). */
  summary?: string;
  /** Up to ~4 bullet points highlighting positions, statements, or bills. */
  keyPoints?: string[];
  /** Bills they've worked on per the AI overview research — broader than
   *  what we formally track in data/legislation/. Sourced from Claude. */
  researchedBills?: Array<{
    code: string;
    title: string;
    role: string;
    year: number;
    summary?: string;
  }>;
  /** National party when `party` is an EP group (e.g. "SPD" under S&D). */
  nationalParty?: string;
  /** Top PACs by amount raised — same shape as donors/politicians.json. */
  topDonors?: Array<{ name: string; amount: number; industry: string }>;
  /** DIME score: -2 (most liberal) to +2 (most conservative). */
  dimeScore?: number;
  yearsInOffice?: number;
  formerLobbyist?: boolean;
  lobbyistBundled?: number;
  revolvingDoorConnections?: Array<{ name: string; firm?: string; industry?: string }>;
}

export interface NewsItem {
  id: string;
  headline: string;
  source: string;
  date: string;
  url: string;
  summary?: string;
  /** Provenance of `summary` — "article" = fetched + summarized, "headline-only"
   *  = source was paywalled/unreachable so the summary was drafted from the
   *  headline alone. Used by the UI to show a "from headline" chip. */
  summarySource?: "article" | "headline-only";
}

export interface Entity {
  id: string;
  geoId: string;
  name: string;
  region: Region;
  level: GovLevel;
  /** True for the regional overview entity (one per region). */
  isOverview?: boolean;
  /** True if this entity has a state-level drill-down (currently only US). */
  canDrillDown?: boolean;
  /** Lens-agnostic overall stance — max severity of stanceZoning
   *  and stanceAffordability. Used for the sidebar headline badge so
   *  a state with clear action on only one lens doesn't read as
   *  "No Action" when viewed under the other lens. */
  stance?: StanceType;
  /** Lens-scoped stance: aggregated over bills relevant to the zoning lens. */
  stanceZoning: StanceType;
  /** Lens-scoped stance: aggregated over bills relevant to the affordability lens. */
  stanceAffordability: StanceType;
  contextBlurb: string;
  legislation: Legislation[];
  keyFigures: Legislator[];
  news: NewsItem[];
  housingMetrics?: HousingMetrics;
  /** Housing development projects scoped to this entity. Populated for
   *  Canadian provinces from data/projects/canada.json. Empty by default. */
  projects?: HousingProject[];
}

export interface HousingMetrics {
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

export type HousingProjectStatus = "proposed" | "under-construction" | "operational";

export type ProposalGateStatus = "done" | "pending" | "blocked";

/** One gate in the project's approval pipeline — land, zoning, interconnect, etc. */
export interface ProposalGate {
  label: string;
  status: ProposalGateStatus;
  date?: string;
}

/** Structured detail about a proposed / under-construction facility. */
export interface ProposalInfo {
  /** Ordered milestones left-to-right. Rendered as a dot row in the tooltip. */
  process?: ProposalGate[];
  /** Who decides next, on what, when. */
  nextDecision?: { body: string; what: string; date?: string };
  /** What the site draws power from. */
  powerSource?: string;
  /** Water source or cooling strategy. */
  waterSource?: string;
  /** Named opposition groups or lawmakers. */
  opposition?: string[];
  /** Outstanding items before the project can move forward. */
  requirements?: string[];
}

export interface HousingProject {
  id: string;
  developer: string;
  projectName?: string;
  /** Free-text location. Optional because some feeds only give a province/city. */
  location?: string;
  state?: string;
  country?: string;
  /** Geocoded lat/lng. Optional: projects without coords are excluded from map dots. */
  lat?: number;
  lng?: number;
  unitCount?: number;
  affordableUnits?: number;
  projectCost?: number;
  projectType?: "rental" | "condo" | "mixed" | "social" | "cooperative";
  status: HousingProjectStatus;
  yearProposed?: number;
  yearCompleted?: number;
  notes?: string;
  concerns?: ImpactTag[];
  /** Primary source URL for provenance. Optional. */
  source?: string;
  proposal?: ProposalInfo;
}

export const REGION_LABEL: Record<Region, string> = {
  na: "North America",
  eu: "European Union",
  asia: "Asia",
};

export const REGION_ORDER: Region[] = ["na", "eu", "asia"];
