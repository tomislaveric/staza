# mobile-ux-audit

## Goal

Audit the authenticated app's mobile experience in a real browser, then implement focused responsive improvements that preserve Staza's visual style and desktop behavior. Give the World/map experience particular attention because it is expected to be the most-used destination.

## Scope

- Inspect Home, World, Skill Atlas, Progress, Activities, Profile, Activity detail and Add Activity at representative small and standard phone widths, a tablet breakpoint, and desktop.
- Validate layout, scroll behavior, safe-area clearance, labels and touch targets, overlays, navigation state, and World map controls through browser interactions.
- Apply mobile-specific fixes identified by the audit without broad visual redesign.
- Add browser-level regression coverage alongside the existing Vitest tests.

## Decisions

- Keep Home, World, Skill Atlas and Progress as the four primary mobile destinations.
- Add a fifth More destination for Activities and Profile.
- Keep Add Activity persistently accessible, but visually demote it; ensure it does not obstruct the World map or bottom navigation.
- Preserve the desktop sidebar and existing design language.
- Use Playwright (or an equivalent real-browser tool if required by the environment); the repository currently has no Playwright setup.

## Implementation plan

1. Establish and record a browser-tested baseline across the key screens and viewport sizes, noting responsive and interaction issues.
2. Refine mobile navigation and Add Activity hierarchy while preserving route handling and selected states, including secondary destinations.
3. Implement focused mobile layout fixes from audit findings, prioritizing World/map usability, scroll and safe-area clearance, and usable touch targets.
4. Add browser regression checks for viewport overflow, primary and secondary navigation, Add Activity, and key mobile interactions.
5. Run the browser checks and relevant existing tests/build checks, and summarize the findings and changes.

## Acceptance criteria

- The mobile bottom navigation exposes Home, World, Skill Atlas, Progress and More; Activities and Profile remain discoverable through More.
- The current destination is identified correctly, including when navigating to secondary screens.
- Add Activity remains directly accessible but is less visually dominant and does not cover important map controls or navigation.
- The audited screens work at small phone, standard phone, tablet and desktop widths without unintended horizontal overflow or controls hidden behind fixed UI.
- World remains the primary mobile browsing experience, with usable map controls and page scrolling.
- Desktop navigation and the app's visual identity remain intact.
- Automated browser coverage verifies the critical responsive and navigation behavior, and relevant existing checks pass.

## Validation

- Run Playwright or equivalent browser checks at representative phone, tablet and desktop viewport sizes.
- Exercise the key navigation flows and inspect layout/scroll behavior on World and the other listed app screens.
- Run the focused existing Vitest tests and project build after changes.
