# Load the app's declared fonts

Written against: bac216d5c608d99c8ae662cd14b2e452610043d7

## Evidence chain

- Surface: every authenticated route served from `public/index.html` (Home, Activities, Activity detail, World, Skill Atlas, Progress, Profile, Add Activity), phone 390×844 and desktop 1440×900.
- Problem: `--font-display: "Barlow Condensed"`, `--font-mono: "DM Mono"` and `--font-body: Inter` are never loaded. A Playwright run showed `document.fonts.size === 0` and no font requests, other than the map's own glyph PBFs. Text renders in system fallbacks (Courier-like mono in the sidebar and Add Activity body copy, Arial Narrow headings), so the look varies by device on web and mobile.
- Design evidence: `public/styles/design-tokens.css` lines 18-20 define the three families. `app-shell.css`, `world.css` and `skill-tree.css` use them: 156× `var(--font-display)`, 60× `var(--font-mono)`, 17× `var(--font-body)`. `index.html` links only stylesheets, and no stylesheet contains `@font-face`, `@import` or a font `<link>`.
- Owner: `public/styles/design-tokens.css`, loaded first by `public/index.html`.
- Scope and affected surfaces: all authenticated screens. `public/landing/landing.css` declares the same families (line 19) and also never loads them. Handle it only if its own `index.html` is confirmed to be served separately.
- Uncertainty: font file licences and weights. Barlow Condensed, DM Mono and Inter are all SIL OFL on Google Fonts. Weights actually used must be confirmed by grepping `font-weight` per family (the CSS uses 400, 500, 600, 700 and one 800).

## Design decision

Self-host the three families and declare them with `@font-face`, so the existing tokens resolve to the intended faces on every device. Self-hosting avoids a third-party request and works offline. No token values change.

## Reuse

- `--font-display`, `--font-mono`, `--font-body` (unchanged)
- Exemplar: `app.use(express.static(path.resolve("public")))` in `src/server.ts` (~line 809) already serves `public/`, so `public/assets/fonts/` needs no server change.

## Changes

1. `public/assets/fonts/`
   - Change: add WOFF2 files, latin subset only (the app has en and de, so include latin-ext). Barlow Condensed in the weights the CSS uses for display text; DM Mono 400 and 500; Inter as a variable file or 400/500/600/700. Include the OFL licence text next to the files.
   - Preserve: all existing assets.
   - Verify: files are served at `/assets/fonts/<name>.woff2` with 200.
2. `public/styles/design-tokens.css`
   - Change: add `@font-face` blocks above `:root` with `font-display: swap`, `font-style: normal`, and the weight each file covers.
   - Preserve: all variable values and fallback stacks.
   - Verify: `document.fonts.size > 0` and each family reports `status === "loaded"` after load.
3. `public/index.html`
   - Change: add `<link rel="preload" as="font" type="font/woff2" crossorigin>` for the display (Barlow) 600 and 700 file and Inter 400 only, to limit layout shift in headings.
   - Preserve: stylesheet order.
   - Verify: no preload warning in the console.

## Scope

- Inherit: all screens using the three tokens.
- Verify: 10px mono labels, the Skill Atlas SVG labels and the Progress cards, since widths change when the real faces replace the fallbacks. Check for wrapping and truncation at 320px width.
- Exclude: map glyphs (served by the map provider), the landing page, and any new type scale.

## Validation

- Product: open each screen and see the sidebar and body copy in DM Mono, headings in Barlow Condensed and body text in Inter.
- Interface: Playwright at 320, 390 and 1440 wide. Check no horizontal overflow and no layout jump on load.
- System: no other `font-family` literal introduced. Fonts load only through the tokens.
- Repository: `npm test` → pass. `npm run test:e2e` → pass (needs `DATABASE_URL`).

## Stop conditions

- Stop if a family's licence does not allow self-hosting.
- Stop if the real fonts cause overflow that needs spacing changes. That is a separate plan.

## Design documentation

- After acceptance and validation: none (no design documentation file exists).
