# uiux.md — AI CreatorForce

This file documents the frontend tech stack, design principles, navigation structure, and interaction patterns for the AI CreatorForce web application. For feature-level descriptions see [features.md](features.md); for underlying dependencies and package versions see [techstack.md](techstack.md).

---

## Design Principles

- **Pipeline made visible.** The product is a pipeline; the UI always shows where a project is and what's next.
- **Channel-first.** All workflows begin with channel selection, not project selection.
- **Minimal friction for the primary workflow.** Create → script → approve → publish is the happy path; everything else is secondary.
- **Real-time feedback.** Job progress is pushed via Socket.io. No polling, nothing feels frozen.
- **Human-in-the-loop made explicit.** The approval step is visually prominent and never hidden or incidental.
- **Trust through transparency.** Sources, compliance reasons, provenance, and credit cost are shown alongside outputs — not buried.

---

## Tech Stack (UI Layer)

| Concern | Library / Version |
|---|---|
| Framework | Next.js 15 App Router |
| Component model | Server Components by default; Client Components (`'use client'`) only when interactive |
| Primitives | Radix UI (Dialog, DropdownMenu, Progress, Tabs, Toast) |
| Styling | Tailwind CSS 3.4 + tailwind-merge + clsx |
| Icons | Lucide React |
| Server state | TanStack Query v5 |
| Virtualized lists | TanStack Virtual v3 |
| Forms | react-hook-form + @hookform/resolvers/zod (validates against shared Zod schemas from `@cf/shared`) |
| Real-time | socket.io-client |
| Date formatting | date-fns v4 |
| Session management | next-auth v4 (coordinates with API JWT) |
| API mocking (dev) | MSW v2 (`public/mockServiceWorker.js`) |

---

## Sidebar Navigation Structure

```
Dashboard / Overview
Channels (channel selector)
Shorts Studio (channel-first)
Projects / Content pipeline
Analytics
Growth / Referrals
Developer Portal
Settings
  - Library
  - YouTube Channel access
Notifications
```

Settings contains Library and YouTube Channel access as nested sub-links (not top-level items).

---

## Shorts Studio UI

The Shorts Studio is channel-first: the user selects a channel before any library content is shown.

**Library picker:** An explicit video selection modal — nothing is imported automatically. The picker splits Shorts and Videos (playlists grouped under Videos). Users select which videos to import.

**Per-video reference notes:** Each imported video card shows a sticky-note indicator when the user has attached reference notes. Notes are per-video and user-authored.

**Import entry point:** A dashed row beneath the imported video list, or an empty-state button, opens the picker. The import action is not placed in the page header.

**Timeline editor:** Drag-and-drop clip ordering within the ShortsTimeline component.

---

## Real-Time Job Progress

Socket.io connects to the API gateway. Job status changes are pushed to connected clients without polling. The progress bar component uses Radix Progress. Toast notifications (Radix Toast) fire on job completion or failure.

---

## Forms

All forms use react-hook-form with Zod schema validation (schemas sourced from `@cf/shared`). The submit button is disabled until the form is valid. Server-side errors are surfaced in the form error state, not as page-level alerts.

---

## Accessibility

- `eslint-plugin-jsx-a11y` is enforced in linting (dev dependency in web package).
- `a11y.spec.ts` in the E2E suite runs automated accessibility checks on key pages.
- Radix UI primitives handle keyboard navigation and ARIA attributes for all interactive components.
- Color is never the sole signal — icons or labels always accompany color cues.

---

## Performance

- Server Components for static and data-fetching UI; Client Components only for interactivity. This minimizes client-side JS.
- TanStack Virtual v3 is used for long lists (library videos, job queues) to avoid DOM flooding.
- Bundle budget enforced in CI via `scripts/check-bundle-budget.mjs`: 800 KB per-route first-load JS, 1500 KB total.
- `next/image` is used for all images; allowed remote domains include `yt3.googleusercontent.com` and `i.ytimg.com`.

---

## Planned / Not Yet Implemented

- Design token system and component library documentation.
- Dark mode.
- i18n / localization (the `targetLang` field exists on the Project model; UI layer not yet wired).
- Mobile-responsive audit (currently desktop-first; tablet support is partial).
- Storybook for component development and visual documentation.
