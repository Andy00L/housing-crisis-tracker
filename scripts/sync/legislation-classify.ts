/**
 * Classify ingested bills into the app's Legislation shape.
 *
 * Reads:   data/raw/legiscan/bills/{STATE}.json
 * Writes:  data/legislation/{stateCode}.json  (states)
 *          data/legislation/federal-us.json      (US)
 *
 * The classification is heuristic — keyword matches in title + description
 * drive category + impactTags + stance. A later pass can upgrade this with
 * Claude if needed, but heuristics give decent coverage for free.
 *
 * The LegiScan progress events are mapped to our Stage enum:
 *   1 = Introduced        -> "Filed"
 *   2 = Engrossed         -> "Floor"
 *   3 = Enrolled          -> "Floor"
 *   4 = Passed            -> "Enacted"
 *   5 = Vetoed            -> "Dead"
 *   6 = Failed / Died     -> "Dead"
 *   7 = Override          -> "Enacted"
 *   8 = Chaptered         -> "Enacted"
 *   9 = Refer/Committee   -> "Committee"
 *   10= Report Pass       -> "Committee"
 *   11= Report DNP        -> "Dead"
 *   12= Draft             -> "Filed"
 *  otherwise -> "Filed" (safe default)
 */

import "../env.js";
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  Dimension,
  ImpactTag,
  Legislation,
  LegislationCategory,
  Stage,
  StanceType,
} from "../../types/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const RAW_BILLS_DIR = join(ROOT, "data/raw/legiscan/bills");
const CLAUDE_CACHE_PATH = join(ROOT, "data/raw/claude/classifications.json");
const DIM_STANCE_CACHE_PATH = join(
  ROOT,
  "data/raw/claude/dimension-stances.json",
);
const OUT_DIR = join(ROOT, "data/legislation");
const OUT_STATES_DIR = join(OUT_DIR, "states");

interface ClaudeClassification {
  category: LegislationCategory;
  impactTags: ImpactTag[];
  stance: StanceType;
  summary: string;
  classifiedAt: string;
}

const claudeCache: Record<string, ClaudeClassification> = existsSync(
  CLAUDE_CACHE_PATH,
)
  ? JSON.parse(readFileSync(CLAUDE_CACHE_PATH, "utf8"))
  : {};

type DimKey = Exclude<Dimension, "overall">;
const dimStanceCache: Record<
  string,
  Partial<Record<DimKey, StanceType>>
> = existsSync(DIM_STANCE_CACHE_PATH)
  ? JSON.parse(readFileSync(DIM_STANCE_CACHE_PATH, "utf8"))
  : {};

interface RawBill {
  bill_id: number;
  bill_number: string;
  title: string;
  description?: string;
  state?: string;
  url?: string;
  state_link?: string;
  session?: { session_name?: string; year_start?: number };
  status?: number;
  status_date?: string;
  progress?: Array<{ date: string; event: number }>;
  history?: Array<{ date: string; action: string }>;
  sponsors?: Array<{
    name: string;
    party?: string;
    role?: string;
  }>;
  subjects?: Array<{ subject_name: string }>;
}

interface OutFile {
  state: string;
  stateCode: string;
  region: "na";
  /** Overall / lens-agnostic stance. Max severity of DC + AI so a state
   *  that has clearly acted on AI doesn't read as "No Action" just
   *  because its bills didn't touch data-center tags. */
  stance: StanceType;
  stanceZoning: StanceType;
  stanceAffordability: StanceType;
  lastUpdated: string;
  contextBlurb: string;
  legislation: Legislation[];
}

const STANCE_SEVERITY: Record<StanceType, number> = {
  restrictive: 4,
  concerning: 3,
  review: 2,
  favorable: 1,
  none: 0,
};

function overallStance(dc: StanceType, ai: StanceType): StanceType {
  return STANCE_SEVERITY[dc] >= STANCE_SEVERITY[ai] ? dc : ai;
}

const STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas",
  CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho",
  IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas",
  KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi",
  MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada",
  NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma",
  OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia",
  WI: "Wisconsin", WY: "Wyoming",
};

function mapStage(bill: RawBill): Stage {
  // Walk progress events backward to find the latest meaningful one
  const events = bill.progress ?? [];
  if (!events.length) return "Filed";
  const latest = events[events.length - 1];
  switch (latest.event) {
    case 4:
    case 7:
    case 8:
      return "Enacted";
    case 2:
    case 3:
      return "Floor";
    case 9:
    case 10:
      return "Committee";
    case 5:
    case 6:
    case 11:
      return "Dead";
    case 1:
    case 12:
    default:
      return "Filed";
  }
}

// Keyword rules → impact tags. A bill gets every tag whose keywords
// appear in its title or description. Tags are lowercase-matched.
const TAG_RULES: Array<{ tag: ImpactTag; kw: RegExp }> = [
  { tag: "affordability", kw: /\b(affordab|below.?market|cost.?burden|housing cost|price.?to.?income)\b/i },
  { tag: "displacement", kw: /\b(displac|gentrif|relocat|demoli|redevelop)\b/i },
  { tag: "density", kw: /\b(density|upzon|fourplex|triplex|multi.?family|missing middle|ADU|accessory dwelling)\b/i },
  { tag: "lot-splitting", kw: /\b(lot split|subdivision|parcel|setback|floor.?area ratio|FAR\b)\b/i },
  { tag: "inclusionary-zoning", kw: /\b(inclusionary|below.?market|affordable unit requirement)\b/i },
  { tag: "rent-stabilization", kw: /\b(rent (control|stabiliz|cap|freeze|increase limit))\b/i },
  { tag: "social-housing", kw: /\b(social housing|public housing|community housing|co.?op housing|non.?profit housing)\b/i },
  { tag: "foreign-buyer", kw: /\b(foreign (buyer|purchas|own|invest)|non.?resident (own|purchas|tax))\b/i },
  { tag: "first-time-buyer", kw: /\b(first.?time (buyer|home|purchas)|homebuyer (credit|program|assist))\b/i },
  { tag: "homelessness", kw: /\b(homeless|unhoused|rough sleep|shelter|encampment|supportive housing)\b/i },
  { tag: "transit-oriented", kw: /\b(transit.?oriented|TOD\b|station area|transit (corridor|village|hub))\b/i },
  { tag: "environmental-review", kw: /\b(environmental (impact|review|assessment)|EIA|NEPA|CEQA)\b/i },
  { tag: "nimby", kw: /\b(NIMBY|community opposition|neighbourhood (oppos|resist)|local (oppos|resist))\b/i },
  { tag: "community-opposition", kw: /\b(community (benefit|impact|engag)|public (hearing|consult))\b/i },
  { tag: "vacancy-tax", kw: /\b(vacan(cy|t) tax|empty home|speculation tax|underused housing)\b/i },
  { tag: "short-term-rental", kw: /\b(short.?term rental|Airbnb|vacation rental|STR\b)\b/i },
  { tag: "heritage-protection", kw: /\b(heritage|historic (preserv|protect|district)|landmark)\b/i },
  { tag: "mortgage-regulation", kw: /\b(mortgage (regulat|rule|stress test|rate)|down payment|amortiz)\b/i },
  { tag: "public-land", kw: /\b(public land|crown land|surplus (land|property)|land (bank|trust))\b/i },
  { tag: "indigenous-housing", kw: /\b(indigenous housing|First Nations|native (housing|land)|reserve housing)\b/i },
];

const CATEGORY_RULES: Array<{ cat: LegislationCategory; kw: RegExp }> = [
  { cat: "zoning-reform", kw: /\b(zon(e|ing)|rezone|density|setback|lot split|ADU|duplex|fourplex|upzon|missing middle)\b/i },
  { cat: "rent-regulation", kw: /\b(rent (control|stabiliz|cap|freeze|increase)|rental (regulat|protect))\b/i },
  { cat: "affordable-housing", kw: /\b(affordab|inclusionary|below.?market|subsidiz|social housing)\b/i },
  { cat: "development-incentive", kw: /\b(tax (increment|credit|incentive)|opportunity zone|fast.?track|expedit|density bonus)\b/i },
  { cat: "building-code", kw: /\b(building code|fire safety|accessibility|energy efficien|construction standard)\b/i },
  { cat: "foreign-investment", kw: /\b(foreign (buyer|invest|purchas)|non.?resident|beneficial ownership|vacancy tax)\b/i },
  { cat: "homelessness-services", kw: /\b(homeless|shelter|supportive housing|encampment|unhoused)\b/i },
  { cat: "tenant-protection", kw: /\b(evict|just cause|relocation (assist|benefit)|habitability|tenant (protect|right))\b/i },
  { cat: "transit-housing", kw: /\b(transit.?oriented|TOD\b|station area|corridor (plan|develop))\b/i },
  { cat: "property-tax", kw: /\b(property tax|assessment|exemption|abatement|mill rate)\b/i },
];

function classifyCategory(text: string): LegislationCategory {
  for (const { cat, kw } of CATEGORY_RULES) {
    if (kw.test(text)) return cat;
  }
  return "affordable-housing";
}

/** True when the text explicitly matched a category keyword (vs falling through to the default). */
function hasExplicitCategory(text: string): boolean {
  return CATEGORY_RULES.some(({ kw }) => kw.test(text));
}

function classifyTags(text: string): ImpactTag[] {
  const tags: ImpactTag[] = [];
  for (const { tag, kw } of TAG_RULES) {
    if (kw.test(text)) tags.push(tag);
  }
  return tags.slice(0, 5); // keep display manageable
}

function deriveStance(bill: RawBill, stage: Stage, category: LegislationCategory, _tags: ImpactTag[]): StanceType {
  const text = `${bill.title} ${bill.description ?? ""}`.toLowerCase();

  // Restrictive signals: reduces supply, removes protections, cuts funding
  const isRestrictive = /moratorium|downzon|height limit|single.?family only|large.?lot minimum|exclusionary|repeal.*(rent|tenant)|weaken.*(rent|tenant|protect)|cut.*(housing|afford)|reduce.*(density|housing)|eliminat.*(rent control|tenant)/.test(text);

  // Favorable signals: increases supply, funds housing, protects tenants
  const isFavorable = /incentive|upzon|density bonus|fast.?track|expedit|exempt|credit|accelerat|supply|build.*homes|streamlin|expand|preempt|by.?right|ADU|accessory dwelling|fourplex|triplex|duplex|multi.?family|inclusionary|affordab|social housing|co.?op|subsid|LIHTC|section 8|rent (control|stabiliz|cap|freeze|protect)|eviction protect|tenant (protect|right)|right to housing|housing fund|national housing|rapid housing|permit reform|parking (minimum|reform|eliminat)|missing middle|homelessness|shelter|supportive housing|public housing|housing first|rental assist|voucher|down.?payment assist|first.?time (buyer|home)|transit.?oriented|zoning reform|housing accelerat/.test(text);

  // Purely procedural: no substantive policy content
  const isProcedural = /^(an )?act (respecting|to establish) (a )?(study|commission|task.?force|working group|advisory)|^appropriation|^supply bill/.test(text);

  if (isRestrictive && (stage === "Enacted" || stage === "Floor")) return "restrictive";
  if (isRestrictive) return "concerning";
  if (isFavorable) return "favorable";
  if (isProcedural) return "review";

  // Category-driven classification only when the text explicitly matched a
  // category keyword. Bills that fell through to the default "affordable-housing"
  // with no specific keyword match stay as "review" since we have no strong signal.
  if (!hasExplicitCategory(text)) return "review";

  switch (category) {
    case "affordable-housing":
    case "homelessness-services":
    case "development-incentive":
    case "transit-housing":
      return "favorable";
    case "tenant-protection":
    case "rent-regulation":
    case "zoning-reform":
      return stage === "Enacted" || stage === "Floor" ? "favorable" : "review";
    case "foreign-investment":
      return "concerning";
    case "building-code":
    case "property-tax":
      return "review";
  }
  return "review";
}

function stateStance(bills: Legislation[]): StanceType {
  const tally: Record<StanceType, number> = {
    restrictive: 0,
    concerning: 0,
    review: 0,
    favorable: 0,
    none: 0,
  };
  // Track ENACTED restrictive bills separately. A single filed moratorium
  // bill (e.g. Sanders/AOC at the federal level, or a long-shot state
  // proposal) shouldn't be enough to flip the whole jurisdiction to
  // "restrictive" — only bills that actually became law should lock
  // that bucket. This was the federal-level bug: one filed moratorium
  // overrode the prevailing innovation-friendly federal posture.
  let enactedRestrictive = 0;

  for (const b of bills) {
    const s: StanceType =
      b.stance ??
      (/\bmoratorium|prohibit|ban\b/i.test(b.title) && b.stage === "Enacted"
        ? "restrictive"
        : /\bmoratorium|prohibit|ban\b/i.test(b.title)
          ? "concerning"
          : /\bincentive|exempt|credit\b/i.test(b.title)
            ? "favorable"
            : "review");
    tally[s] += 1;
    if (s === "restrictive" && b.stage === "Enacted") enactedRestrictive++;
  }

  // Only an enacted restrictive bill (real moratorium that became law)
  // can lock the jurisdiction as restrictive.
  if (enactedRestrictive >= 1) return "restrictive";

  // Filed/committee restrictive bills count toward the concerning bucket
  // for tally purposes, since they signal regulatory pressure without
  // having become law yet.
  const opposition = tally.concerning + tally.restrictive;

  // Multiple opposition bills (concerning + filed restrictions) → concerning
  if (opposition >= 3) return "concerning";

  // More incentive bills than opposition AND at least 2 → favorable
  if (tally.favorable >= 2 && tally.favorable >= opposition) return "favorable";

  // Single incentive vs no opposition → still favorable
  if (tally.favorable >= 1 && opposition === 0) return "favorable";

  // Some opposition but not enough to dominate, plus discussion → review
  if (opposition >= 1 || tally.review >= 1) return "review";

  return "none";
}

const DC_DIMENSION_TAGS: ImpactTag[] = [
  "affordability",
  "environmental-review",
  "public-land",
  "environmental-review",
  "transit-oriented",
  "density",
  "mortgage-regulation",
  "social-housing",
  "community-opposition",
  "inclusionary-zoning",
  "nimby",
  "displacement",
  "affordability",
];

const AI_DIMENSION_TAGS: ImpactTag[] = [
  "rent-stabilization",
  "homelessness",
  "foreign-buyer",
  "community-opposition",
  "displacement",
  "social-housing",
  "indigenous-housing",
  "short-term-rental",
];

const DC_DIMS: DimKey[] = ["environmental", "supply", "community-impact", "community-impact"];
const AI_DIMS: DimKey[] = [
  "social-housing",
  "affordability",
  "supply",
  "rental-market",
  "ownership",
];

function lensStance(bills: Legislation[], lens: "zoning" | "affordability"): StanceType {
  const lensTags = lens === "affordability" ? AI_DIMENSION_TAGS : DC_DIMENSION_TAGS;
  const lensDims = lens === "affordability" ? AI_DIMS : DC_DIMS;
  const tagSet = new Set(lensTags);

  // Build a synthetic bill list whose `stance` is the lens-scoped stance:
  // if dimensionStances has entries for any lens dim, aggregate those;
  // else, if tags match the lens, use bill-level stance; else skip.
  const lensBills: Legislation[] = [];
  for (const b of bills) {
    const dimVotes = lensDims
      .map((d) => b.dimensionStances?.[d])
      .filter((s): s is StanceType => !!s);
    const tagMatch = (b.impactTags ?? []).some((t) => tagSet.has(t));
    if (dimVotes.length > 0) {
      // Pick the most severe stance across the lens's dimensions for this bill
      const severity: Record<StanceType, number> = {
        restrictive: 4,
        concerning: 3,
        review: 2,
        favorable: 1,
        none: 0,
      };
      let pick: StanceType = dimVotes[0];
      for (const v of dimVotes) if (severity[v] > severity[pick]) pick = v;
      lensBills.push({ ...b, stance: pick });
    } else if (tagMatch) {
      lensBills.push(b);
    }
  }
  return stateStance(lensBills);
}

function derivePartyOrigin(bill: RawBill): "R" | "D" | "B" | undefined {
  const parties = new Set<string>();
  for (const s of bill.sponsors ?? []) {
    if (s.party) parties.add(s.party);
  }
  if (parties.size > 1) return "B";
  if (parties.has("R")) return "R";
  if (parties.has("D")) return "D";
  return undefined;
}

function lastActionDate(bill: RawBill): string {
  if (bill.status_date) return bill.status_date;
  if (bill.progress?.length) return bill.progress[bill.progress.length - 1].date;
  if (bill.history?.length) return bill.history[bill.history.length - 1].date;
  return new Date().toISOString().slice(0, 10);
}

function officialSourceUrl(bill: RawBill): string | undefined {
  return bill.state_link ?? undefined;
}

function toLegislation(bill: RawBill): Legislation {
  const text = `${bill.title} ${bill.description ?? ""}`;
  const stage = mapStage(bill);

  // Prefer Claude's semantic classification if we have it; fall back to
  // the keyword heuristics for bills that Claude hasn't been run on
  // (or that failed JSON parsing).
  const claude = claudeCache[String(bill.bill_id)];
  const category = claude?.category ?? classifyCategory(text);
  const tags = claude?.impactTags ?? classifyTags(text);
  const summary =
    claude?.summary ??
    (bill.description
      ? bill.description.length > 280
        ? bill.description.slice(0, 277) + "..."
        : bill.description
      : bill.title);

  // Claude returns its own stance. Trust it when present; otherwise use
  // the heuristic `deriveStance` which considers stage, category, and
  // moratorium/incentive cues.
  const stance: StanceType =
    claude?.stance ?? deriveStance(bill, stage, category, tags);

  const dimensionStances = dimStanceCache[String(bill.bill_id)];

  return {
    id: `${bill.state}-${bill.bill_number}`
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-"),
    billCode: bill.bill_number,
    title: bill.title,
    summary,
    stage,
    stance,
    ...(dimensionStances && Object.keys(dimensionStances).length > 0
      ? { dimensionStances }
      : {}),
    impactTags: tags,
    category,
    updatedDate: lastActionDate(bill),
    partyOrigin: derivePartyOrigin(bill),
    sourceUrl: officialSourceUrl(bill),
    legiscanUrl: bill.url,
    legiscanId: bill.bill_id,
    sponsors: (bill.sponsors ?? []).map((s) => s.name).slice(0, 4),
  };
}

const STANCE_PHRASE: Record<StanceType, string> = {
  restrictive: "leaning restrictive",
  concerning: "advancing regulation",
  review: "under discussion",
  favorable: "leaning innovation-friendly",
  none: "no action",
};

function lensSlice(
  bills: Legislation[],
  lens: "zoning" | "affordability",
): Legislation[] {
  const tagSet = new Set<ImpactTag>(
    lens === "affordability" ? AI_DIMENSION_TAGS : DC_DIMENSION_TAGS,
  );
  const dims = lens === "affordability" ? AI_DIMS : DC_DIMS;
  return bills.filter((b) => {
    if (b.stance === "none") return false;
    if (dims.some((d) => b.dimensionStances?.[d])) return true;
    return (b.impactTags ?? []).some((t) => tagSet.has(t));
  });
}

const STAGE_RANK: Record<string, number> = {
  Enacted: 5,
  Floor: 4,
  Committee: 3,
  Filed: 2,
  "Carried Over": 1,
  Dead: 0,
};

const STANCE_WEIGHT: Record<StanceType, number> = {
  restrictive: 4,
  concerning: 3,
  favorable: 3,
  review: 1,
  none: 0,
};

/**
 * Rank bills by a combination of stage (enacted outranks filed) and stance
 * intensity (restrictive/concerning/favorable all beat review), breaking
 * ties on recency. The top bill is what we highlight in the blurb.
 */
function rankBills(bills: Legislation[]): Legislation[] {
  return [...bills].sort((a, b) => {
    const as = STAGE_RANK[a.stage] ?? 0;
    const bs = STAGE_RANK[b.stage] ?? 0;
    if (as !== bs) return bs - as;
    const aw = STANCE_WEIGHT[a.stance ?? "review"];
    const bw = STANCE_WEIGHT[b.stance ?? "review"];
    if (aw !== bw) return bw - aw;
    return (b.updatedDate ?? "").localeCompare(a.updatedDate ?? "");
  });
}

const STAGE_VERB: Record<string, string> = {
  Enacted: "enacted",
  Floor: "on the floor",
  Committee: "in committee",
  Filed: "filed",
  "Carried Over": "carried over",
  Dead: "dead",
};

/**
 * First clean sentence of a bill summary, trimmed to ~140 chars. Summaries
 * from Claude are already plain language, so we just need to clip them.
 */
function highlight(bill: Legislation): string {
  let raw = (bill.summary ?? bill.title).trim();
  // Bills whose summary is still the raw legalese "To <verb>..." haven't
  // been re-summarized by Claude. Fall back to the title — often cleaner.
  if (/^to\s+\w/i.test(raw) && bill.title) {
    raw = bill.title.trim();
  }
  // Prefer the first sentence; truncate only if it runs long.
  const firstSentence = raw.match(/^[^.!?]+[.!?]/)?.[0] ?? raw;
  const trimmed =
    firstSentence.length > 200
      ? firstSentence.slice(0, 197).replace(/[.…\s]+$/, "") + "…"
      : firstSentence.replace(/[.…\s]+$/, "");
  // Strip redundant "This bill" / "This <qualifier> bill" leads — the
  // framing is already clear from the "On data centers: / On AI:" prefix.
  const cleaned = trimmed
    .replace(/^This\s+(?:\w+\s+)?bill\s+/i, "")
    .replace(/^The\s+bill\s+/i, "");
  const body = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  const terminal = body.endsWith("…") ? "" : ".";
  return `${bill.billCode} (${STAGE_VERB[bill.stage] ?? bill.stage.toLowerCase()}) — ${body}${terminal}`;
}

function writeContextBlurb(
  state: string,
  stateFull: string,
  bills: Legislation[],
  stanceZoning: StanceType,
  stanceAffordability: StanceType,
): string {
  const name = state === "US" ? "The US federal government" : stateFull;
  const relevant = bills.filter((b) => b.stance !== "none");
  if (relevant.length === 0) {
    return `${name} has no AI or data-center legislation currently tracked.`;
  }

  // Dead bills are noise for a highlight — they're neither shaping policy
  // nor advancing. Rank only from the live set.
  const liveDC = lensSlice(bills, "zoning").filter((b) => b.stage !== "Dead");
  const liveAI = lensSlice(bills, "affordability").filter((b) => b.stage !== "Dead");
  const dcBills = rankBills(liveDC);
  const aiBills = rankBills(liveAI);

  const parts: string[] = [];

  // Lead — per-lens posture in one sentence. Collapse matching stances so
  // we don't read "advancing regulation on data centers and advancing
  // regulation on AI" — unify into "across both data centers and AI".
  if (dcBills.length > 0 && aiBills.length > 0) {
    if (stanceZoning === stanceAffordability) {
      parts.push(
        `${name} is ${STANCE_PHRASE[stanceZoning]} across both data centers and AI.`,
      );
    } else {
      parts.push(
        `${name} is ${STANCE_PHRASE[stanceZoning]} on data centers and ${STANCE_PHRASE[stanceAffordability]} on AI.`,
      );
    }
  } else if (dcBills.length > 0) {
    parts.push(
      `${name} is ${STANCE_PHRASE[stanceZoning]} on data centers, with no AI legislation currently tracked.`,
    );
  } else if (aiBills.length > 0) {
    parts.push(
      `${name} is ${STANCE_PHRASE[stanceAffordability]} on AI, with no data-center legislation currently tracked.`,
    );
  }

  // Highlight the most consequential bill per lens.
  if (dcBills.length > 0) {
    parts.push(`On data centers: ${highlight(dcBills[0])}`);
  }
  if (aiBills.length > 0) {
    parts.push(`On AI: ${highlight(aiBills[0])}`);
  }

  return parts.join(" ");
}

function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(OUT_STATES_DIR, { recursive: true });

  const files = readdirSync(RAW_BILLS_DIR).filter((f) => f.endsWith(".json"));
  let totalBills = 0;
  let totalJurisdictions = 0;

  for (const file of files) {
    const state = file.replace(".json", "");
    const raw = JSON.parse(readFileSync(join(RAW_BILLS_DIR, file), "utf8")) as RawBill[];
    const legislation = raw.map(toLegislation);
    const stateFull = state === "US" ? "United States" : STATE_NAMES[state] ?? state;
    const stanceZoning = lensStance(legislation, "zoning");
    const stanceAffordability = lensStance(legislation, "affordability");
    const stance = overallStance(stanceZoning, stanceAffordability);

    const target =
      state === "US"
        ? join(OUT_DIR, "federal-us.json")
        : join(OUT_STATES_DIR, `${stateFull.toLowerCase().replace(/\s+/g, "-")}.json`);

    // Preserve hand-written blurbs: if the target already has a
    // `contextBlurb`, keep it. The template-generated blurb is only a
    // fallback for fresh jurisdictions. Prior runs of this script were
    // overwriting editorial prose on every reclassify — we'd rather
    // occasionally ship a stale blurb than silently nuke someone's
    // writing. To force regeneration, delete the field in the JSON
    // first or pass `--force-blurbs` (see below).
    let contextBlurb: string | null = null;
    if (existsSync(target) && !process.argv.includes("--force-blurbs")) {
      try {
        const existing = JSON.parse(readFileSync(target, "utf8")) as Partial<OutFile>;
        if (existing.contextBlurb && existing.contextBlurb.trim().length > 0) {
          contextBlurb = existing.contextBlurb;
        }
      } catch {
        // fall through to regeneration
      }
    }
    if (!contextBlurb) {
      contextBlurb = writeContextBlurb(
        state,
        stateFull,
        legislation,
        stanceZoning,
        stanceAffordability,
      );
    }

    const out: OutFile = {
      state: stateFull,
      stateCode: state,
      region: "na",
      stance,
      stanceZoning,
      stanceAffordability,
      lastUpdated: new Date().toISOString().slice(0, 10),
      contextBlurb,
      legislation,
    };

    writeFileSync(target, JSON.stringify(out, null, 2));
    totalBills += legislation.length;
    totalJurisdictions += 1;
  }

  console.log(
    `[classify] wrote ${totalJurisdictions} jurisdictions, ${totalBills} bills total`,
  );
}

main();
