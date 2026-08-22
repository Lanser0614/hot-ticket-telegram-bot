# Design QA — Hot Ticket main screen

- Source visual truth: `/var/folders/2r/rnv2z_8d4j7g96n917qglsy00000gn/T/codex-clipboard-9a77eb10-c683-4898-9c68-9d86e9cdb990.png`
- Normalized source crop: `/private/tmp/hot-ticket-approved-source-normalized.png`
- Implementation screenshot: `/private/tmp/hot-ticket-approved-implementation-final.png`
- Focused active-filter screenshot: `/private/tmp/hot-ticket-approved-filters-active.png`
- Viewport: 390 × 844 CSS px, device scale factor 1
- Source dimensions: 548 × 1508 px; app crop 504 × 1088 px; normalized comparison crop 390 × 842 px
- Implementation dimensions: 390 × 844 px
- State: Deals tab, dark theme, demo API data, default unfiltered catalog

## Full-view comparison evidence

The normalized source crop and final browser screenshot were opened together in one comparison view. The implementation matches the source hierarchy and density: search and quick filters, highlighted HotTicket hero, route-price scale, one compact price-movement row, compact full catalog, and fixed three-item bottom navigation.

The displayed destinations and prices intentionally come from the current API/demo dataset rather than the static values in the design. Default quick filters are not preselected because doing so would hide part of the requested full HotTicket list. Their active appearance was checked separately in the focused screenshot.

## Focused comparison evidence

- Hero: orange outline, orange saving badge, route/price alignment, median marker, CTA and tracking bell match the reference treatment.
- Search/filter controls: city/IATA search, horizontal chips, active chip state, filter counter and advanced filter sheet were rendered and tested.
- Compact lists: the featured movement row and two-line HotTicket rows match the reference density. Catalog rows retain their tracking bell so every HotTicket can create a watch.
- Typography: system SF/Segoe fallback, weights, compact uppercase labels, number hierarchy and truncation were checked at 390 px.
- Colors/tokens: navy background, raised blue-gray cards, blue actions, orange hero state and green savings copy match the source palette.
- Image/assets: the screen has no raster imagery. Existing Tabler-derived icon assets are used for search, filters, ticket, bell and navigation; no placeholder imagery is present.
- Copy/content: UI labels follow the source; ticket-specific values remain live-data driven.

## Interaction and runtime checks

- Search for `ALA` promoted the matching Tashkent → Almaty ticket into the hero; clearing restored two compact list rows.
- Quick-filter activation displayed a counter and filtered the catalog.
- Advanced filters opened and closed correctly.
- A compact HotTicket row opened the ticket detail and returned to the catalog.
- A row bell opened its prefilled tracking sheet.
- Pull-to-refresh is wired for the home screen.
- Browser console errors: none.
- Project verification: 38 test files passed, 274 tests passed, production build passed.

## Comparison history

### Iteration 1

- [P2] Hero header wrapped into two lines and made the card materially taller than the reference.
- [P2] Filter-to-hero spacing and card vertical rhythm pushed the second catalog row under the bottom navigation.

Fixes: reduced chip height and top gap, kept hero labels on one line, tightened hero padding/caption/action spacing, and recaptured the same 390 × 844 state.

Post-fix evidence: `/private/tmp/hot-ticket-approved-implementation-final.png` shows both catalog rows above the bottom navigation with the hero proportions aligned to the normalized source.

## Findings

No actionable P0, P1 or P2 differences remain. Live data values and the unfiltered default state are intentional product constraints rather than visual drift.

## Follow-up polish

- [P3] A future pass can add a subtle pull-to-refresh progress indicator; refresh behavior already works.

## Implementation checklist

- [x] Match the approved mobile composition.
- [x] Preserve real HotTicket data and existing detail/watch flows.
- [x] Make search, quick filters, advanced filters and sorting interactive.
- [x] Verify the rendered screen and primary interactions.
- [x] Run lint, typecheck, tests and production build.

final result: passed
