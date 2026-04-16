import type { Entity } from "@/types";
import { RESEARCHED_INTERNATIONAL } from "./international-researched";

/**
 * EU + Asia + Canada (non-US North America) entities. Hand-curated baseline
 * entities live in HAND_CURATED below. Pipeline-researched additions are
 * imported from data/international/*.json through ./international-researched
 * and merged in below. Entries here are housing-focused; the pre-pivot
 * tracker's residue has been replaced with housing minister data and bill
 * summaries drawn from data/legislation/europe and
 * data/legislation/asia-pacific.
 */
const HAND_CURATED: Entity[] = [
  // ─────────── EU REGION ───────────
  {
    id: "eu-bloc",
    geoId: "eu-bloc",
    name: "European Union",
    region: "eu",
    level: "bloc",
    isOverview: true,
    stanceZoning: "favorable",
    stanceAffordability: "favorable",
    contextBlurb:
      "The European Union is advancing a coordinated response to housing affordability through the European Affordable Housing Plan, presented by the Commission in December 2025. The European Parliament adopted report A10-0025/2026 in March 2026, calling for incentive-based tax systems for low and middle income households, a 60 day cap on planning permit processing, and measures to prevent short-term rentals from threatening city affordability. Dan Jorgensen serves as the first European Commissioner for Energy and Housing.",
    legislation: [
      {
        id: "eu-eu-a10-0025-2026",
        billCode: "A10-0025/2026",
        title:
          "Housing Crisis in the European Union with the Aim of Proposing Solutions for Decent, Sustainable and Affordable Housing",
        summary:
          "Report adopted by the European Parliament in plenary on 10 March 2026, setting out MEPs' recommendations to tackle the EU housing crisis. Includes incentive-based tax systems for low- and middle-income households, limits on planning permit processing to 60 days, and measures to prevent short-term rentals from threatening city affordability.",
        stage: "Floor",
        stance: "favorable",
        impactTags: ["affordability"],
        category: "affordable-housing",
        updatedDate: "2026-03-10",
        sourceUrl:
          "https://www.europarl.europa.eu/news/en/agenda/plenary-news/2026-03-09/1/parliament-s-proposals-to-address-europe-s-housing-crisis",
        sponsors: ["Borja Giménez Larraz"],
      },
      {
        id: "eu-eu-eahp-2025",
        billCode: "EAHP-2025",
        title: "European Affordable Housing Plan",
        summary:
          "Presented by the Commission on 16 December 2025. The Plan supports Member States, regions, and cities in expanding access to affordable housing, and is accompanied by consultations on a prospective Affordable Housing Act.",
        stage: "Filed",
        stance: "favorable",
        impactTags: ["affordability"],
        category: "affordable-housing",
        updatedDate: "2025-12-16",
        sourceUrl:
          "https://www.europarl.europa.eu/legislative-train/theme-supporting-people-strengthening-our-societies-and-our-social-model/file-the-european-affordable-housing-plan",
      },
      {
        id: "eu-eu-a-10-2025-0139",
        billCode: "A-10-2025-0139",
        title:
          "Report on the Role of Cohesion Policy Investment in Resolving the Current Housing Crisis",
        summary:
          "European Parliament report examining how EU cohesion policy funds can be deployed to address the housing crisis. Provides recommendations on investment strategies to improve housing availability and affordability across Member States.",
        stage: "Committee",
        stance: "favorable",
        impactTags: ["affordability"],
        category: "affordable-housing",
        updatedDate: "2025-01-01",
        sourceUrl:
          "https://www.europarl.europa.eu/doceo/document/A-10-2025-0139_EN.html",
      },
    ],
    keyFigures: [
      {
        id: "eu-jorgensen",
        name: "Dan Jørgensen",
        role: "European Commission · Commissioner for Energy and Housing",
        party: "S&D",
        stance: "review",
      },
      {
        id: "eu-gimenez-larraz",
        name: "Borja Giménez Larraz",
        role: "MEP · Rapporteur, A10-0025/2026 housing crisis report",
        party: "EPP",
        stance: "favorable",
      },
    ],
    news: [],
  },
  {
    id: "germany",
    geoId: "276",
    name: "Germany",
    region: "eu",
    level: "federal",
    stanceZoning: "review",
    stanceAffordability: "review",
    contextBlurb:
      "Germany's federal housing portfolio is led by Verena Hubertz (SPD), Bundesbauministerin (Federal Minister for Housing, Urban Development and Building). English-language coverage of Bundestag housing legislation is thin in this release. The tracker continues to monitor federal housing activity but has not yet captured German-language housing bills with sufficient detail to surface here.",
    legislation: [],
    keyFigures: [
      {
        id: "de-hubertz",
        name: "Verena Hubertz",
        role: "Federal Minister for Housing, Urban Development and Building",
        party: "SPD",
        stance: "review",
      },
    ],
    news: [],
  },
  {
    id: "france",
    geoId: "250",
    name: "France",
    region: "eu",
    level: "federal",
    stanceZoning: "review",
    stanceAffordability: "review",
    contextBlurb:
      "France's housing portfolio is led by Vincent Jeanbrun (LR), Ministre de la Ville et du Logement, appointed on 12 October 2025. Coverage of Assemblée Nationale housing legislation is limited in this release. The tracker continues to monitor French parliamentary activity for affordability and rental measures.",
    legislation: [],
    keyFigures: [
      {
        id: "fr-jeanbrun",
        name: "Vincent Jeanbrun",
        role: "Ministre de la Ville et du Logement",
        party: "LR",
        stance: "review",
      },
    ],
    news: [],
  },
  {
    id: "united-kingdom",
    geoId: "826",
    name: "United Kingdom",
    region: "eu",
    level: "federal",
    stanceZoning: "favorable",
    stanceAffordability: "favorable",
    contextBlurb:
      "The United Kingdom's housing portfolio is led by Steve Reed, Secretary of State for Housing, Communities and Local Government, with Matthew Pennycook as Minister for Housing and Planning. The 39 billion pound Social and Affordable Homes Programme 2026 to 2036, administered by Homes England and the Greater London Authority, opened bidding in early 2026 to scale delivery of social and affordable housing across England.",
    legislation: [
      {
        id: "eu-uk-sahp-2026-2036",
        billCode: "SAHP-2026-2036",
        title: "Social and Affordable Homes Programme 2026 to 2036",
        summary:
          "A 39 billion pound ten-year programme administered by Homes England and the Greater London Authority to accelerate the delivery of social and affordable housing across England. Bidding opened in early 2026. The programme incorporates new design elements alongside the best of previous programmes to maximise housebuilding at scale.",
        stage: "Filed",
        stance: "favorable",
        impactTags: ["affordability"],
        category: "affordable-housing",
        updatedDate: "2026-01-28",
        sourceUrl:
          "https://www.gov.uk/government/publications/launching-the-social-and-affordable-homes-programme-2026-to-2036",
      },
    ],
    keyFigures: [
      {
        id: "uk-reed",
        name: "Steve Reed",
        role: "Secretary of State for Housing, Communities and Local Government",
        party: "Labour",
        stance: "favorable",
      },
      {
        id: "uk-pennycook",
        name: "Matthew Pennycook",
        role: "Minister for Housing and Planning",
        party: "Labour",
        stance: "favorable",
      },
    ],
    news: [],
  },

  // ─────────── ASIA REGION ───────────
  {
    id: "asia-region",
    geoId: "asia-region",
    name: "Asia",
    region: "asia",
    level: "bloc",
    isOverview: true,
    stanceZoning: "review",
    stanceAffordability: "review",
    contextBlurb:
      "Housing portfolios across the Asia-Pacific region are held by ministers ranging from Yasushi Kaneko (Japan, Minister of Land, Infrastructure, Transport and Tourism) to Ni Hong (China, Minister of Housing and Urban-Rural Development). South Korea, India, and Australia each maintain dedicated housing ministries, with Clare O'Neil (Australia, Labor) and Manohar Lal Khattar (India, BJP) leading affordability and supply programs in their respective markets.",
    legislation: [],
    keyFigures: [
      {
        id: "asia-kaneko",
        name: "Yasushi Kaneko",
        role: "Japan · Minister of Land, Infrastructure, Transport and Tourism",
        party: "LDP",
        stance: "review",
      },
      {
        id: "asia-kim-yun-duk",
        name: "Kim Yun-duk",
        role: "South Korea · Minister of Land, Infrastructure and Transport",
        party: "Democratic Party",
        stance: "review",
      },
      {
        id: "asia-ni-hong",
        name: "Ni Hong",
        role: "China · Minister of Housing and Urban-Rural Development (MOHURD)",
        party: "Communist Party of China",
        stance: "review",
      },
      {
        id: "asia-khattar",
        name: "Manohar Lal Khattar",
        role: "India · Minister of Housing and Urban Affairs",
        party: "BJP",
        stance: "review",
      },
      {
        id: "asia-oneil",
        name: "Clare O'Neil",
        role: "Australia · Minister for Housing",
        party: "Labor",
        stance: "favorable",
      },
    ],
    news: [],
  },
  {
    id: "japan",
    geoId: "392",
    name: "Japan",
    region: "asia",
    level: "federal",
    stanceZoning: "review",
    stanceAffordability: "review",
    contextBlurb:
      "Japan's housing portfolio is led by Yasushi Kaneko (LDP), Minister of Land, Infrastructure, Transport and Tourism. Recent activity captured by the tracker includes a House of Representatives review of real estate acquisition by foreign nationals (January 2026) and a 2024 MLIT policy document on housing support for vulnerable populations including data on vacant houses (akiya) available for rent or sale nationwide.",
    legislation: [
      {
        id: "ap-jp-202602-rea",
        billCode: "202602-REA",
        title:
          "Overview of Real Estate Acquisition by Foreign Nationals (House of Representatives review)",
        summary:
          "Document from the House of Representatives reviewing policy frameworks around real estate acquisition by foreign nationals in Japan. References a January 2026 expert panel opinion and inter-ministerial measures for an orderly coexistence society. Relevant party proposals from the LDP and Nippon Ishin no Kai are noted.",
        stage: "Committee",
        stance: "restrictive",
        impactTags: ["affordability"],
        category: "foreign-investment",
        updatedDate: "2026-02-01",
        sourceUrl:
          "https://www.shugiin.go.jp/internet/itdb_rchome.nsf/html/rchome/shiryo/202602_real_estate_acquisition_by_foreign_nationals.pdf/$File/202602_real_estate_acquisition_by_foreign_nationals.pdf",
      },
      {
        id: "ap-jp-mlit-hsp-2024",
        billCode: "MLIT-HSP-2024",
        title: "Japanese Housing Policies for Persons Requiring Housing Support",
        summary:
          "Ministry of Land, Infrastructure, Transport and Tourism (MLIT) policy document addressing housing support measures for vulnerable populations. Includes data on vacant houses (akiya) available for rent or sale nationwide and outlines necessary support measures when renting to persons requiring assistance.",
        stage: "Enacted",
        stance: "favorable",
        impactTags: ["affordability"],
        category: "affordable-housing",
        updatedDate: "2024-01-01",
        sourceUrl: "https://www.mlit.go.jp/en/jutakukentiku/content/001972618.pdf",
      },
    ],
    keyFigures: [
      {
        id: "jp-kaneko",
        name: "Yasushi Kaneko",
        role: "Minister of Land, Infrastructure, Transport and Tourism",
        party: "LDP",
        stance: "review",
      },
    ],
    news: [],
  },
  {
    id: "china",
    geoId: "156",
    name: "China",
    region: "asia",
    level: "federal",
    stanceZoning: "favorable",
    stanceAffordability: "favorable",
    contextBlurb:
      "China's housing portfolio is led by Ni Hong, Minister of Housing and Urban-Rural Development (MOHURD). Recent regulation includes the State Council Housing Rental Regulations (2025), setting safety and structural integrity rules for landlords. Beijing's Wangjing International Talent Apartments opened in 2025 with rent-free promotion periods of up to 120 days for tenants signing one-year leases.",
    legislation: [
      {
        id: "ap-cn-sc-rental-2025",
        billCode: "SC-RENTAL-2025",
        title: "State Council Housing Rental Regulations",
        summary:
          "Housing Rental Regulations passed by State Council administrative meeting. Requires rented properties to comply with current laws and mandatory standards, prohibits any change to load-bearing structures or damage to fire-prevention facilities, and bars unapproved modifications to other property fixtures without landlord consent.",
        stage: "Enacted",
        stance: "favorable",
        impactTags: ["affordability"],
        category: "tenant-protection",
        updatedDate: "2025-08-07",
        sourceUrl: "http://en.moj.gov.cn/2025-08/07/c_1115214.htm",
      },
      {
        id: "ap-cn-bj-talent-apt-2025",
        billCode: "BJ-TALENT-APT-2025",
        title: "Beijing Wangjing International Talent Apartments Leasing Policy",
        summary:
          "Beijing's Wangjing International Talent Apartments opened for lease, offering minimum 5 day and maximum 120 day rent-free promotion periods for tenants signing one-year leases. Aimed at attracting international talent to settle in Beijing.",
        stage: "Enacted",
        stance: "favorable",
        impactTags: ["affordability"],
        category: "affordable-housing",
        updatedDate: "2025-07-14",
        sourceUrl:
          "https://english.beijing.gov.cn/workinginbeijing/whybeijing/favorabletreatment/list/202507/t20250714_4148681.html",
      },
    ],
    keyFigures: [
      {
        id: "cn-ni-hong",
        name: "Ni Hong",
        role: "Minister of Housing and Urban-Rural Development (MOHURD)",
        party: "Communist Party of China",
        stance: "review",
      },
    ],
    news: [],
  },
  {
    id: "south-korea",
    geoId: "410",
    name: "South Korea",
    region: "asia",
    level: "federal",
    stanceZoning: "favorable",
    stanceAffordability: "favorable",
    contextBlurb:
      "South Korea's housing portfolio is led by Kim Yun-duk, Minister of Land, Infrastructure and Transport. Korea Land and Housing Corporation (LH) operates the Housing Welfare Business and Rental Housing Supply program, which together provide jeonse-based and rental support targeted at vulnerable groups under the broader Haengbok Housing and Urban Regeneration policy framework.",
    legislation: [
      {
        id: "ap-kr-lh-hw-2022",
        billCode: "LH-HW-2022",
        title:
          "LH Housing Welfare Business: Housing Supports for Vulnerable and Marginalized Groups",
        summary:
          "Korea Land and Housing Corporation (LH) provides tailored housing welfare services so that current and prospective tenants can access safe, clean, and affordable housing. Includes housing support (rental included) for vulnerable and marginalized groups, operated based on December 2022 statistics.",
        stage: "Enacted",
        stance: "favorable",
        impactTags: ["affordability"],
        category: "affordable-housing",
        updatedDate: "2022-12-31",
        sourceUrl: "https://lh.or.kr/menu.es?mid=a20400000000",
      },
      {
        id: "ap-kr-lh-rental-org",
        billCode: "LH-RENTAL-ORG",
        title:
          "Rental Housing Supply and Jeonse Support Program",
        summary:
          "LH's public housing supply system operates rental housing and jeonse-based housing support programs. Includes Haengbok Housing, Urban Regeneration projects, and rental subsidies as part of a comprehensive housing welfare policy.",
        stage: "Enacted",
        stance: "favorable",
        impactTags: ["affordability"],
        category: "rent-regulation",
        updatedDate: "2023-01-01",
        sourceUrl:
          "https://www.lh.or.kr/boardDownload.es?bid=0049&list_no=651251&seq=1",
      },
    ],
    keyFigures: [
      {
        id: "kr-kim-yun-duk",
        name: "Kim Yun-duk",
        role: "Minister of Land, Infrastructure and Transport",
        party: "Democratic Party",
        stance: "review",
      },
    ],
    news: [],
  },
  {
    id: "australia",
    geoId: "36",
    name: "Australia",
    region: "asia",
    level: "federal",
    stanceZoning: "review",
    stanceAffordability: "favorable",
    contextBlurb:
      "Australia's housing portfolio is led by Clare O'Neil (Labor), Minister for Housing. English-language coverage of Commonwealth housing legislation is thin in the current release. The tracker continues to monitor federal Labor government activity around the Housing Australia Future Fund and supporting affordability measures.",
    legislation: [],
    keyFigures: [
      {
        id: "au-oneil",
        name: "Clare O'Neil",
        role: "Minister for Housing",
        party: "Labor",
        stance: "favorable",
      },
    ],
    news: [],
  },
];

// Merge hand-curated baseline with whatever the international pipeline has
// produced so far. Researched entries override hand-curated ones if IDs
// collide (the pipeline is the more authoritative source for any country
// it covers).
const RESEARCHED_BY_ID = new Map<string, Entity>();
for (const e of RESEARCHED_INTERNATIONAL) RESEARCHED_BY_ID.set(e.id, e);

export const INTERNATIONAL_ENTITIES: Entity[] = [
  ...HAND_CURATED.filter((e) => !RESEARCHED_BY_ID.has(e.id)),
  ...RESEARCHED_INTERNATIONAL,
];
