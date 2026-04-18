
# TestSprite AI Testing Report(MCP)

---

## 1️⃣ Document Metadata
- **Project Name:** track-policy
- **Date:** 2026-04-17
- **Prepared by:** TestSprite AI Team

---

## 2️⃣ Requirement Validation Summary

#### Test TC001 Reveal map and switch region lens to Europe
- **Test Code:** [TC001_Reveal_map_and_switch_region_lens_to_Europe.py](./TC001_Reveal_map_and_switch_region_lens_to_Europe.py)
- **Test Error:** TEST FAILURE

Clicking the Europe region lens did not recenter the globe to Europe.

Observations:
- The globe remains centered on North America in the current view (screenshot).
- The Europe region button was clicked but the map did not update to show Europe.
- There is no visible UI indication that the Europe region is selected.
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/db665240-344d-4dd4-8dfc-f3d439332d90/5fb4c25d-5f2c-41a5-9d6d-f105dadd274d
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC002 Open global search from the home page and navigate to a result
- **Test Code:** [TC002_Open_global_search_from_the_home_page_and_navigate_to_a_result.py](./TC002_Open_global_search_from_the_home_page_and_navigate_to_a_result.py)
- **Test Error:** TEST FAILURE

The global search modal could not be opened from the home page — the search feature appears absent or non-functional.

Observations:
- Pressing Ctrl+K and '/' did not open any search modal or input.
- No clickable 'Open search' control is present in the page's interactive elements.
- The page remained on the home hero (globe) with no search UI or results visible.
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/db665240-344d-4dd4-8dfc-f3d439332d90/c72a19e1-15c4-40c6-a285-f41ac56a2b31
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC003 Open province/state side panel from map selection
- **Test Code:** [TC003_Open_provincestate_side_panel_from_map_selection.py](./TC003_Open_provincestate_side_panel_from_map_selection.py)
- **Test Error:** TEST FAILURE

Clicking a colored province on the choropleth map did not open a province-specific side panel. The side panel shows the country 'Canada' rather than the selected province name.

Observations:
- The side panel header reads 'Canada'.
- After clicking a colored SVG path (a province), no province-specific name or details appeared.
- The side panel tabs (Figures, News, Projects, Metrics) are visible but they are for 'Canada', not a province.
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/db665240-344d-4dd4-8dfc-f3d439332d90/ff833950-b250-453e-a236-feea0e63f8b3
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC004 Pan and zoom stability on the dashboard map
- **Test Code:** [TC004_Pan_and_zoom_stability_on_the_dashboard_map.py](./TC004_Pan_and_zoom_stability_on_the_dashboard_map.py)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/db665240-344d-4dd4-8dfc-f3d439332d90/1f72fa85-7dbb-4994-af64-be5f0c310276
- **Status:** ✅ Passed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC005 Open global search from another page and keep context
- **Test Code:** [TC005_Open_global_search_from_another_page_and_keep_context.py](./TC005_Open_global_search_from_another_page_and_keep_context.py)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/db665240-344d-4dd4-8dfc-f3d439332d90/85f14bb7-8743-4f91-b790-affc76845336
- **Status:** ✅ Passed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC006 Browse Bills tab in the map side panel
- **Test Code:** [TC006_Browse_Bills_tab_in_the_map_side_panel.py](./TC006_Browse_Bills_tab_in_the_map_side_panel.py)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/db665240-344d-4dd4-8dfc-f3d439332d90/1ed53827-790e-4a83-9234-e3a15197b906
- **Status:** ✅ Passed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC007 Open a bill from the table to view its detail page
- **Test Code:** [TC007_Open_a_bill_from_the_table_to_view_its_detail_page.py](./TC007_Open_a_bill_from_the_table_to_view_its_detail_page.py)
- **Test Error:** TEST FAILURE

Selecting a bill did not open the bill detail view — clicking the bill row and the 'Read full bill →' link left the UI on the bills list.

Observations:
- Clicking the 'Read full bill →' link twice produced no navigation or visible bill detail; the page stayed on the bills list.
- Clicking the bill card once also did not open a detail view; the list items and progress bar remained visible.
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/db665240-344d-4dd4-8dfc-f3d439332d90/89769931-7217-4048-9293-27c0db36d7bd
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC008 Close side panel and return to full map view
- **Test Code:** [TC008_Close_side_panel_and_return_to_full_map_view.py](./TC008_Close_side_panel_and_return_to_full_map_view.py)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/db665240-344d-4dd4-8dfc-f3d439332d90/c4860b46-9e1a-48e4-a2e8-83cf993c3c0e
- **Status:** ✅ Passed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC009 Bills table renders core columns and row metadata
- **Test Code:** [TC009_Bills_table_renders_core_columns_and_row_metadata.py](./TC009_Bills_table_renders_core_columns_and_row_metadata.py)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/db665240-344d-4dd4-8dfc-f3d439332d90/a887fb80-1c7e-42dd-bf8b-3a5e4d07ef6d
- **Status:** ✅ Passed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC010 Browse projects list and open a project detail
- **Test Code:** [TC010_Browse_projects_list_and_open_a_project_detail.py](./TC010_Browse_projects_list_and_open_a_project_detail.py)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/db665240-344d-4dd4-8dfc-f3d439332d90/52cdc776-47f2-4476-937e-86edc0ab5c2d
- **Status:** ✅ Passed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC011 Browse news list
- **Test Code:** [TC011_Browse_news_list.py](./TC011_Browse_news_list.py)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/db665240-344d-4dd4-8dfc-f3d439332d90/30e7c672-2f06-42aa-85f2-26dfff1bd193
- **Status:** ✅ Passed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC012 Bill detail shows stage timeline, stance, and summary when opened from a listing
- **Test Code:** [TC012_Bill_detail_shows_stage_timeline_stance_and_summary_when_opened_from_a_listing.py](./TC012_Bill_detail_shows_stage_timeline_stance_and_summary_when_opened_from_a_listing.py)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/db665240-344d-4dd4-8dfc-f3d439332d90/6c964be8-6669-4d6a-a9e3-975240eaab0e
- **Status:** ✅ Passed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC013 See politicians directory with country control available
- **Test Code:** [TC013_See_politicians_directory_with_country_control_available.py](./TC013_See_politicians_directory_with_country_control_available.py)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/db665240-344d-4dd4-8dfc-f3d439332d90/f8f30171-ed1e-4dc4-99ab-106d98b974c4
- **Status:** ✅ Passed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC014 Open a news article from the index
- **Test Code:** [TC014_Open_a_news_article_from_the_index.py](./TC014_Open_a_news_article_from_the_index.py)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/db665240-344d-4dd4-8dfc-f3d439332d90/5bfba7b8-ea99-4652-b766-287ec0a11c4c
- **Status:** ✅ Passed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC015 Use in-page link to reach bills content from the dashboard
- **Test Code:** [TC015_Use_in_page_link_to_reach_bills_content_from_the_dashboard.py](./TC015_Use_in_page_link_to_reach_bills_content_from_the_dashboard.py)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/db665240-344d-4dd4-8dfc-f3d439332d90/f06571ab-9508-47d1-956f-6c3a80496673
- **Status:** ✅ Passed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---


## 3️⃣ Coverage & Matching Metrics

- **73.33** of tests passed

| Requirement        | Total Tests | ✅ Passed | ❌ Failed  |
|--------------------|-------------|-----------|------------|
| ...                | ...         | ...       | ...        |
---


## 4️⃣ Key Gaps / Risks
{AI_GNERATED_KET_GAPS_AND_RISKS}
---