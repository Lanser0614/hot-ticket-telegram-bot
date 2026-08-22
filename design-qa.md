# Hot Ticket UI visual QA

## Evidence

- Source visual truth: `/Users/bellissimopizza/Desktop/Hot Ticket Mini App (standalone).html`
- Source capture: `/Users/bellissimopizza/WebstormProjects/hot-ticket-telegram-bot/docs/design-qa/reference-board.png`
- Implementation URL: `http://127.0.0.1:4317/`
- Implementation captures:
  - `/Users/bellissimopizza/WebstormProjects/hot-ticket-telegram-bot/docs/design-qa/normalized-home.jpg`
  - `/Users/bellissimopizza/WebstormProjects/hot-ticket-telegram-bot/docs/design-qa/normalized-tracking.jpg`
  - `/Users/bellissimopizza/WebstormProjects/hot-ticket-telegram-bot/docs/design-qa/normalized-watchlist.jpg`
  - `/Users/bellissimopizza/WebstormProjects/hot-ticket-telegram-bot/docs/design-qa/normalized-profile.jpg`
- Combined comparison input: `/Users/bellissimopizza/WebstormProjects/hot-ticket-telegram-bot/docs/design-qa/comparison.png`
- Target CSS viewport: 390 × 844 px, dark mode.
- Browser capture: in-app browser reported 543 × 837 px at DPR 2. The application shell was fixed to the source width of 390 CSS px; implementation screenshots were center-cropped to 390 × 837 px for comparison. The source capture is 390 × 844 px.
- States: Home, tracking sheet, Watchlist, Profile. Ticket detail was also rendered and interaction-tested.

## Full-view comparison

The combined comparison was inspected after normalization. The implementation preserves the source hierarchy: compact toolbar, price-led HotTicket hero, route price scale, three-day movers, notification CTA, persistent navigation, tracking sheet, live Watchlist cards, and compact profile settings.

## Focused region comparison

Focused checks were made for the Home hero/price scale, tracking presets/slider/toggles, Watchlist goal progress/actions, and Profile notification controls. These regions contain the most fidelity-sensitive typography, spacing, controls, and copy.

## Required fidelity surfaces

- Fonts and typography: system/SF Pro stack, weights, hierarchy, compact labels, numeric emphasis, and wrapping match the reference closely.
- Spacing and layout rhythm: 390 px shell, 18 px page gutters, compact card spacing, radii, fixed bottom navigation, and sheet proportions align with the source.
- Colors and tokens: source dark background/surface/accent/orange/green palette is mapped to shared CSS variables.
- Image and asset fidelity: the reference has no raster imagery. All visible icons use the existing Tabler icon assets; no emoji or handcrafted SVG replacements were introduced.
- Copy and content: route analytics and concrete HotTicket facts remain separate; tracking, Watchlist, and profile copy follows the standalone reference and the agreed product behavior.

## Comparison history

### Iteration 1 — blocked

- P1: the implementation shell used a 520 px maximum instead of the 390 px source frame.
- P1: the Home hero used oversized airport codes and an added page title, changing the above-the-fold hierarchy.
- P2: the tracking sheet exposed native date fields for every preset and used a number input instead of the source's preset-first flow and price slider.

Fixes applied:

- Reduced the app shell, navigation, purchase bar, and bottom sheet to a 390 px maximum.
- Rebuilt the Home toolbar and compact price-led hero to match the source.
- Kept dates behind “Свои даты” and added the prefilled price slider plus advanced-condition disclosure.

### Iteration 2 — passed

Post-fix browser captures show no remaining actionable P0/P1/P2 mismatch. Residual differences are content-level and intentional: real API data may produce different prices/routes, and the Watchlist uses exact subscription conditions rather than static mock values.

## Primary interactions tested

- Open ticket detail and change history period.
- Open/close the tracking sheet from the Home bell.
- Open existing Watchlist tracking for editing.
- Navigate among Deals, Watchlist, and Profile.
- Render profile auto-save controls and quiet-hours editor.
- Inspect browser console: no application errors. Telegram SDK capability warnings appear only in standalone browser demo mode.

## Findings

No actionable P0/P1/P2 findings remain.

## Follow-up polish

- P3: add a dedicated real-device Telegram screenshot pass after deployment because browser demo mode cannot reproduce Telegram safe-area chrome exactly.

final result: passed
