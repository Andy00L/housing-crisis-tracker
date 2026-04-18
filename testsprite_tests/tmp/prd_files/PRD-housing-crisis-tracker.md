# Housing Crisis Tracker - Product Requirements Document

## Product Overview

Housing Crisis Tracker is a public web application (no login required) that visualizes housing legislation, projects, and officials across Canada, US, Europe, and Asia-Pacific on interactive choropleth maps.

**Local URL:** http://localhost:3000
**No authentication required. All pages are public.**

## User Stories and Acceptance Criteria

### US-01: Home Page Globe-to-Map Reveal

**As a** visitor, **I want to** see an animated globe that transitions into an interactive map when I scroll down, **so that** I can explore housing data geographically.

**Acceptance Criteria:**
1. Page loads with a globe animation visible at the top.
2. A "Scroll to reveal the map" hint is visible near the bottom of the screen.
3. When the user scrolls down approximately 2 full viewport heights, the globe fades out and a choropleth map of North America appears.
4. The map shows colored provinces (Canada) and states (US) based on housing stance.
5. Three region tabs are visible above the map: "N. America", "Europe", "Asia".

**Steps to test:**
- Navigate to `/`
- Verify the page loads (look for heading "Tracking housing policy across Canada")
- Scroll down slowly (window.scrollTo with increments)
- After scrolling ~2x viewport height, verify the map container is visible
- Verify region tabs "N. America", "Europe", "Asia" are present

### US-02: Map Province Click Opens Side Panel

**As a** visitor, **I want to** click a province on the map to see its housing data, **so that** I can explore legislation and projects per region.

**Acceptance Criteria:**
1. Clicking on a colored province/state on the map opens a side panel on the left.
2. The side panel shows the province/state name as a heading.
3. The side panel has navigation tabs: Bills, Figures, News, Projects, Metrics (tabs may be abbreviated on smaller screens).
4. The Bills tab shows a list of legislation for that province.
5. Closing the panel returns to the full map view.

**Steps to test:**
- Navigate to `/`, scroll past the hero to reveal the map
- Click on a colored province shape on the SVG map (e.g., look for a path element representing Ontario or Quebec)
- Verify a side panel appears with the province name
- Verify tabs are present (Bills tab should be visible)
- Verify bill items appear in the list

### US-03: Census Division Drill-Down

**As a** visitor, **I want to** drill into a province to see census division boundaries and project dots, **so that** I can explore housing at the municipal level.

**Acceptance Criteria:**
1. When a user clicks on Quebec, Ontario, Alberta, or New Brunswick, the map zooms into a census division view.
2. Project dots appear on the map, colored by project type.
3. A "Project types" legend appears in the right sidebar showing: Rental (blue), Social (green), Cooperative (purple), Condo (orange), Mixed (gray).
4. Breadcrumb navigation shows: "North America > Canada > [Province]".
5. The user can navigate back to the Canada view.

**Steps to test:**
- Navigate to `/`, scroll to reveal map
- Click on Quebec (or another drill-down province)
- Verify breadcrumb shows "Quebec" in the navigation
- Verify project dots are visible on the map (circle or path SVG elements)
- Verify "Project types" legend section appears

### US-04: Dimension Toggle Changes Map Colors

**As a** visitor, **I want to** switch between different data dimensions to see different views of housing data, **so that** I can understand affordability, supply, and crisis severity.

**Acceptance Criteria:**
1. A "Color map by" section is visible below the map on the home page.
2. Toggle buttons include: Overall stance, Crisis severity, Affordability, Housing supply, Rental market, Home ownership.
3. Clicking "Crisis severity" changes the map colors and shows a legend: Severe (7+), Moderate (4-6), Mild (1-3), Manageable (0), No data.
4. Clicking other dimensions shows a gradient legend with "Low activity" to "High activity".

**Steps to test:**
- Navigate to `/`, scroll past map to the "Color map by" section
- Click "Crisis severity" button
- Verify legend text contains "Severe" and "Manageable"
- Click "Affordability" button
- Verify a gradient legend appears

### US-05: Bills Page Table and Search

**As a** visitor, **I want to** search and browse all tracked legislation, **so that** I can find specific bills.

**Acceptance Criteria:**
1. `/bills` page loads with a table of legislation.
2. Each row shows: bill code, title, jurisdiction, stage, and a stance badge (colored dot).
3. Stance badge colors: green (favorable), red (restrictive), amber/yellow (concerning), gray (review).
4. A search input allows filtering by title or bill code.
5. Typing in the search box filters the table in real time.
6. Clicking a bill row navigates to its detail page.

**Steps to test:**
- Navigate to `/bills`
- Verify the table is rendered with at least one row
- Verify stance badge elements exist (small colored circles)
- Type "housing" in the search input
- Verify table rows update/filter
- Click on a bill row
- Verify navigation to `/legislation/[id]` page

### US-06: Bill Detail Page

**As a** visitor, **I want to** see full details of a specific bill, **so that** I can understand its status and impact.

**Acceptance Criteria:**
1. `/legislation/canada-federal` page loads.
2. Page shows: bill title, jurisdiction, stage.
3. A stage timeline or progress indicator is visible (Filed, Committee, Floor, Enacted).
4. A stance badge is visible.
5. A summary paragraph describes the bill.

**Steps to test:**
- Navigate to `/legislation/canada-federal`
- Verify page loads with bill information
- Verify a stage timeline or stage labels are present
- Verify a summary text block exists

### US-07: Projects Page

**As a** visitor, **I want to** browse housing projects, **so that** I can see what is being built.

**Acceptance Criteria:**
1. `/projects` page loads with project cards.
2. Each card shows: project name (or descriptive label), location, unit count, status.
3. Status options: Operational, Under construction, Proposed.
4. Clicking a card navigates to a project detail page.

**Steps to test:**
- Navigate to `/projects`
- Verify project cards are rendered
- Verify at least one card shows a unit count
- Click on a project card
- Verify navigation to `/projects/[id]`

### US-08: Project Detail Page

**As a** visitor, **I want to** see full details of a housing project, **so that** I can understand its scope.

**Acceptance Criteria:**
1. `/projects/canada-federal` page loads.
2. Page shows project name, location.
3. Unit count and status are displayed.
4. A description or blurb is present.

**Steps to test:**
- Navigate to `/projects/canada-federal`
- Verify page loads with project information
- Verify location and unit count are present

### US-09: Politicians Page with Country Filter

**As a** visitor, **I want to** browse housing officials and filter by country, **so that** I can see who shapes policy in each region.

**Acceptance Criteria:**
1. `/politicians` page loads with official cards.
2. A country filter dropdown is visible with options: Canada, United States, United Kingdom, Europe, Asia-Pacific.
3. Default selection is Canada.
4. Changing the filter updates the displayed officials.
5. Each card shows: official name and title.

**Steps to test:**
- Navigate to `/politicians`
- Verify official cards are rendered
- Verify a country filter/dropdown is present
- Verify "Canada" is selected by default (or officials shown are Canadian)
- Select "United States" from the filter
- Verify the displayed officials change

### US-10: News Page

**As a** visitor, **I want to** read housing news with AI summaries, **so that** I can stay informed.

**Acceptance Criteria:**
1. `/news` page loads with news article cards.
2. Each card shows a title and summary text.
3. Clicking a card navigates to a news detail page.

**Steps to test:**
- Navigate to `/news`
- Verify news cards are rendered
- Verify at least one card has a title and summary
- Click on a card
- Verify navigation to `/news/[id]`

### US-11: Globe Page

**As a** visitor, **I want to** see a 3D globe showing tracked countries, **so that** I can understand the global scope.

**Acceptance Criteria:**
1. `/globe` page loads.
2. A 3D canvas or SVG globe element is rendered.
3. The globe is interactive (can be rotated by mouse drag).

**Steps to test:**
- Navigate to `/globe`
- Verify a canvas element is present
- Verify the page does not show any error states

### US-12: Contact Form

**As a** visitor, **I want to** send a message via the contact form, **so that** I can reach the team.

**Acceptance Criteria:**
1. `/contact` page loads with a form.
2. Form has fields: Name, Email, Message.
3. A submit button is present.
4. Submitting with empty fields shows validation feedback.

**Steps to test:**
- Navigate to `/contact`
- Verify form fields are present (name, email, message inputs)
- Verify a submit button exists
- Click submit without filling fields
- Verify validation feedback appears (error messages or required field indicators)

### US-13: About Page

**As a** visitor, **I want to** learn about the project and its data sources.

**Acceptance Criteria:**
1. `/about` page loads with descriptive content.
2. A link to data sources is present.

**Steps to test:**
- Navigate to `/about`
- Verify the page loads with content
- Verify a link to data sources exists

### US-14: Methodology Page

**As a** visitor, **I want to** understand how bills are classified.

**Acceptance Criteria:**
1. `/methodology` page loads.
2. Page explains stance definitions: favorable, restrictive, concerning, review.

**Steps to test:**
- Navigate to `/methodology`
- Verify the page loads with content about classification

### US-15: Health API Endpoint

**As a** developer, **I want to** check data source health via API.

**Acceptance Criteria:**
1. `GET /api/health` returns JSON.
2. Response includes source status information.

**Steps to test:**
- Send GET request to `/api/health`
- Verify response is valid JSON
- Verify response contains source health data

### US-16: Navigation Between Regions

**As a** visitor, **I want to** switch between North America, Europe, and Asia views.

**Acceptance Criteria:**
1. Clicking "Europe" tab on the home page map switches to a European map view.
2. Clicking "Asia" tab switches to an Asia-Pacific map view.
3. Clicking "N. America" returns to the North America view.

**Steps to test:**
- Navigate to `/`, scroll to reveal map
- Click "Europe" tab
- Verify the map view changes (different geographical shapes visible)
- Click "Asia" tab
- Verify the map changes again
- Click "N. America" tab
- Verify return to North America view

### US-17: Search Functionality

**As a** visitor, **I want to** search across bills, projects, and officials, **so that** I can find specific items quickly.

**Acceptance Criteria:**
1. Pressing Ctrl+K (or Cmd+K) opens a search modal/overlay.
2. Typing a query shows results across bills, projects, and officials.
3. Clicking a result navigates to the relevant page.

**Steps to test:**
- Navigate to `/`
- Trigger Ctrl+K keyboard shortcut
- Verify a search modal or overlay appears
- Type "housing" in the search input
- Verify search results appear

### US-18: Legislative Funnel Visualization

**As a** visitor, **I want to** see how bills flow through legislative stages, **so that** I can understand the pipeline.

**Acceptance Criteria:**
1. A legislative funnel section is visible on the home page below the map.
2. The funnel shows stages: Filed, Committee, Floor, Enacted.
3. Each stage has a count or bar showing the number of bills.

**Steps to test:**
- Navigate to `/`, scroll down past the map and summary sections
- Verify a section with "Filed", "Committee", "Floor", "Enacted" labels exists
- Verify numeric counts or visual bars are present

### US-19: Health Footer

**As a** visitor, **I want to** see data freshness information, **so that** I know the data is current.

**Acceptance Criteria:**
1. A footer element shows "All sources live" or similar health text.
2. Clicking it opens a data source status popup/modal.
3. The popup shows individual source health statuses.

**Steps to test:**
- Navigate to `/`
- Scroll to the bottom of the page
- Verify health footer text is present (contains "sources" and "synced")
- Click the health footer
- Verify a popup/modal appears with source health details

## UI Component Inventory

| Component | Location | Interaction |
|-----------|----------|-------------|
| Globe hero | `/` top | Scroll to reveal map |
| Region tabs | `/` map header | Click to switch N.America/Europe/Asia |
| Choropleth map | `/` main | Click province to open panel |
| Side panel | `/` left | Tabs: Bills, Figures, News, Projects, Metrics |
| Dimension toggle | `/` below map | Click to change map coloring |
| Legislative funnel | `/` below map | Hover for details |
| Search modal | Any page | Ctrl+K to open |
| Health footer | Every page | Click for source details |
| Bills table | `/bills` | Search, sort, click rows |
| Country filter | `/politicians` | Dropdown selection |
| Contact form | `/contact` | Fill and submit |
| Project cards | `/projects` | Click for detail |
| News cards | `/news` | Click for detail |

## Page Routes

| Route | Type | Auth |
|-------|------|------|
| `/` | Static | None |
| `/bills` | Static | None |
| `/legislation/[id]` | SSG | None |
| `/projects` | Static | None |
| `/projects/[id]` | SSG | None |
| `/politicians` | Static | None |
| `/news` | Static | None |
| `/news/[id]` | SSG | None |
| `/globe` | Static | None |
| `/about` | Static | None |
| `/about/data-sources` | Static | None |
| `/methodology` | Static | None |
| `/contact` | Static | None |
| `/api/health` | Dynamic | None |
| `/api/visitors` | Dynamic | None |
