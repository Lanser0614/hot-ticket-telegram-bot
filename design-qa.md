# Design QA — Hot Ticket Mini App

## Evidence

- Source visual truth: `/Users/bellissimopizza/Desktop/Waiting on scope answers.zip` → `.thumbnail` and `Hot Ticket.dc.html` (working extraction: `/private/tmp/hot-ticket-design.8EZ6BJ/`).
- Normalized source capture: `docs/design-qa/design-qa-reference.png`.
- Browser-rendered implementation: `docs/design-qa/design-qa-home.png`.
- Combined full-view comparison: `docs/design-qa/design-qa-comparison.png`.
- Additional implementation state: `docs/design-qa/design-qa-detail.png`.
- State: default Hot Deals screen, dark theme, realistic local demo data matching the design content.
- CSS viewport: `402 × 874` at device scale factor `1`.
- Source pixels: original thumbnail `640 × 409`; phone region normalized from `169 × 368` to `402 × 874`.
- Implementation pixels: `402 × 874`.
- Density normalization: both comparison panels are `402 × 874`; the source phone crop was resized only to normalize the low-resolution thumbnail supplied by the design archive.

## Findings

- No actionable P0, P1, or P2 visual differences remain.
- Typography: the system sans-serif family, bold price hierarchy, uppercase orange eyebrow, muted supporting text, and compact control labels follow the source. The supplied thumbnail is low resolution, but visible sizes, weights, wrapping, and hierarchy align.
- Spacing and layout: the 18 px side margins, horizontal chip strip, compact deal-card rhythm, 16 px card radii, card padding, and fixed bottom navigation align with the source composition.
- Colors and tokens: deep navy background, raised blue-gray cards, muted gray text, Telegram-blue controls, orange hot-deal treatment, and green active states match the source palette.
- Image and icon fidelity: the product has no photography or illustration. UI icons use the official Tabler outline assets; there are no emoji, handcrafted inline SVGs, or CSS-drawn replacement icons.
- Copy and content: the primary route, price, dates, deal-confidence message, baggage/direct labels, filters, and navigation labels match the supplied mock while using real API fields.
- Platform normalization: the source thumbnail includes an iOS status bar, Dynamic Island, device bezel, and home indicator. The implementation intentionally omits those elements because Telegram supplies the host chrome; duplicating them inside a real Mini App would be incorrect.

## Full-view comparison evidence

`docs/design-qa/design-qa-comparison.png` places the normalized source on the left and the browser implementation on the right. Above-the-fold hierarchy, card widths, background/surface balance, horizontal filter overflow, card density, and persistent bottom navigation are visibly consistent. The implementation is sharper because it is a native browser capture rather than the archive's compressed thumbnail.

## Focused-region evidence

A separate crop was not needed: at `402 × 874`, the combined comparison keeps the header, chips, two complete cards, route/price typography, badges, metadata icons, captions, and bottom navigation readable. The ticket-detail/chart state was captured separately in `docs/design-qa/design-qa-detail.png` to verify the secondary screen's spacing, chart clarity, information rows, and range selector.

## Interaction and runtime checks

- Filters: destination and price draft can be cancelled without changing results; Apply updates the result list and active-filter count.
- Ticket detail: route data, fare facts, deal score, and price chart render; 7/30/90-day range controls update the history.
- Watchlist: a route can be created from a ticket and appears as active with its saved conditions.
- Profile: travel class and baggage preference can be changed and saved.
- Loading, empty, error, toast, and locked Telegram-auth states are implemented.
- Browser console: no application errors. The standalone Telegram SDK haptic warning found during the first check was removed by skipping haptics in local demo mode.

## Comparison history

### Pass 1

- Earlier P0/P1/P2 findings: none.
- Non-visual runtime finding: Telegram's SDK warned that haptic feedback was unavailable in the standalone local preview.
- Fix made: haptic calls are disabled only in local demo mode; Telegram production behavior is unchanged.
- Post-fix evidence: refreshed `docs/design-qa/design-qa-home.png`; core flows retested; no application errors.

## Follow-up polish

- P3: if the designer supplies lossless exports of individual screens, typography and icon stroke weight can be compared at higher fidelity than the compressed archive thumbnail allows.

final result: passed
