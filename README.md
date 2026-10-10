# EDGE

### Clarity before conviction.

EDGE is a personal **NIFTY 50 options research and decision-support app**. It brings market context, candidate option structures, entry conditions and risk checks into one interface, so the next decision is easier to understand.

This repository contains the **web frontend, installable PWA and Capacitor mobile wrapper**. The separate [EDGE backend](https://github.com/bhaumiknaiksi-debug/edge-backend) supplies market data, research and authoritative execution decisions. Trades are placed manually through the user's broker; EDGE does not submit orders.

> **EDGE 2.0 redesign:** The redesigned Home / Signals / Insights / Control interface is being reviewed in [PR #44](https://github.com/bhaumiknaiksi-debug/EDGE-UI/pull/44). It is separate from the current `main` interface described below.

## What EDGE shows

**Simple mode** presents the current or last available NIFTY snapshot, backend market-session status, A/B/C signal calls and the contracts being considered for each tier.

**Pro mode** exposes four sections:

| Section | Purpose |
| --- | --- |
| **Market** | Market overview, signal journey, candidate structures, chart interpretation and reference levels. |
| **Action** | Backend entry plan, execution conditions and risk/position detail. |
| **Details** | Technical option intelligence. |
| **Lab** | Research evidence, collection health, notification settings and app recovery controls. |

Switching modes changes presentation, not trading rules. Market-open/closed status comes from the backend. Historical or unverified data must not be interpreted as a live entry signal.

### EDGE 2.0 design branch

The [design branch](https://github.com/bhaumiknaiksi-debug/EDGE-UI/tree/feat/stitch-edge-2-ui) adds a charcoal/mint visual system, bottom navigation, a prominent decision card, expandable evidence, a filtered strike matrix and a closed-market briefing. It also adds a timestamped partial-session chart and responsive browser tests. These features remain under review until the design PR is merged.

## Signals and execution safety

The backend remains the authority for market phase, setup qualification, price, liquidity, risk and position checks.

| Tier | Meaning | Entry permission |
| --- | --- | --- |
| **A — Execution ready** | The strict backend decision, subject to the frontend's freshness and consistency checks. | Only when the full execution gate passes. |
| **B — Strong candidate** | A research candidate worth watching. | Never authorizes entry. |
| **C — Developing** | An early research observation. | Never authorizes entry. |

These are separate research states, not a progress meter or a predicted probability of profit.

The Simple decision card shows **BUY NOW** only when all of the following agree:

- Backend orchestration is `READY_TO_EXECUTE` and explicitly permits execution.
- The backend signal tier is A and explicitly permits execution.
- Both the backend market status and the decision snapshot say `OPEN`.
- The browser is online, the market-status check and snapshot are recent, and the backend confirms fresh live data.

The current presenter accepts a market-status check and decision snapshot up to 90 seconds old, and a market fetch up to 120 seconds old, with a bounded allowance for timestamp skew. Missing confirmation fails closed.

Waiting, blocked, stale, offline, pre-open and closed-market states do not become permission to trade. Displayed quotes must be rechecked before manual entry, and spread legs must be evaluated together.

EDGE is a research tool. A displayed signal does not establish profitability or guarantee an outcome.

## Architecture

| Component | Responsibility |
| --- | --- |
| `index.html` | Main interface, styles, polling, presentation and frontend execution guards. |
| `pwa.js` | PWA support, app recovery and backend market-status updates. |
| `web-push.js` | Browser push enrollment, test and opt-out controls. |
| `sw.js` | Service worker, app-shell caching, push display and notification clicks. |
| `src/mobile-entry.js` | Capacitor lifecycle and native push integration foundation. |
| EDGE backend | Market-data access, signal engines, risk decisions, evidence collection and server-side notification policy. |

The web frontend is plain HTML, CSS and JavaScript. It does not require a frontend framework or a web build step. Node tooling is used for checks and the mobile bundle.

## Run locally

Clone the repository and select the branch you want to inspect:

```bash
git clone https://github.com/bhaumiknaiksi-debug/EDGE-UI.git
cd EDGE-UI
git switch main
```

Serve the repository root with Python 3:

```bash
python3 -m http.server 8080
```

Open **http://localhost:8080**. Serve over HTTP rather than opening `index.html` as a local file, because the app uses root-relative assets and service-worker APIs.

The page connects to the configured remote backend. A local web server does not start the trading engine. If the backend is unavailable or its CORS policy does not allow the local origin, live data will remain unavailable. The isolated browser tests below do not require live backend access.

## Backend configuration

The current backend origin is:

```text
https://edge-backend-r1ng.onrender.com
```

When using another backend, update the origin consistently in:

1. `index.html`: the `BACKEND` value and Content Security Policy `connect-src`.
2. `pwa.js`: `BACKEND_URL`.
3. `web-push.js`: the push API base URL.

The backend must permit the frontend origin through CORS. Keep broker credentials, enrollment secrets, private push keys and signing credentials out of frontend source and Git history.

Principal integrations include `/data`, `/history`, `/api/v1/market/status`, the `/evidence/*` research endpoints and `/api/v1/push/*` notification endpoints. The UI tolerates missing research fields by showing unavailable states.

## Checks

Use **Node.js 22 or newer**. Run the dependency-free frontend and enrollment checks from the repository root:

```bash
node scripts/edge-frontend-smoke.mjs
node scripts/push-enrollment-check.mjs
node --check pwa.js
node --check web-push.js
node --check sw.js
```

The checks cover frontend syntax, polling behavior, execution safety and server-confirmed push enrollment. GitHub Actions also covers Web Push integration and native bootstrap/iOS simulator builds.

The design branch adds isolated browser fixtures and responsive screenshots. To run them on that branch:

```bash
git switch feat/stitch-edge-2-ui
npm install --no-save --package-lock=false playwright
npx playwright install --with-deps chromium
node scripts/edge-visual-check.cjs
```

This check uses port `8765` and writes screenshots to `visual-results/`. Fixture checks do not verify live market-feed continuity or actual notification delivery.

## Web deployment and PWA

Deploy the repository root as a static site. The existing web deployment uses Vercel and follows `main` for production. A design-branch preview is separate from production and may require Vercel authentication.

`vercel.json` defines revalidation headers for the HTML shell, service worker and supporting scripts. The service worker prefers network responses, with cached app-shell assets available as a fallback. It does not intentionally cache cross-origin market/API responses.

For shell changes, keep the service-worker cache version and its regression assertion aligned. A cached interface is not proof of a live market connection. **Pro → Lab → Update & Reload** provides an app recovery action.

## Notifications

Browser Web Push controls live in **Pro → Lab → Lock Screen Alerts**. Enrollment requires supported browser APIs, notification permission and authenticated backend registration using the private enrollment code. The test action is available only after server-confirmed enrollment.

Backend-confirmed execution-ready and invalidation events can be delivered through the push channel when the backend is configured to send them. Browser permission, a saved subscription or a successful build does not prove that an alert was delivered. Verify actual delivery separately.

Native push is a separate integration: the Capacitor wrapper currently registers native tokens on-device but does not upload them to the backend. Native permission/registration UI must not be interpreted as end-to-end delivery confirmation.

## iOS and Android wrapper

Install dependencies and generate the native projects:

```bash
npm install
npm run mobile:init
```

After web changes:

```bash
npm run mobile:sync
```

Open the generated native project:

```bash
npm run mobile:open:ios
npm run mobile:open:android
```

The configured application ID is `com.bhaumiknaik.edge`. `npm run mobile:build` creates the `www/` bundle; native tooling, signing and push-provider setup are additional requirements. Simulator build artifacts are not physical-device installations.

See [MOBILE_SETUP.md](MOBILE_SETUP.md) for native setup and push integration details.

## Development principles

- Keep trading decisions and risk policy in the backend.
- Preserve the strict execution gate when changing presentation.
- Keep B/C research distinct from executable A signals.
- Show data timestamps and unavailable states; never fabricate prices, performance or readiness percentages.
- Keep operational controls in the last tab and advanced detail in Pro.
- Validate UI changes against waiting, blocked, invalidated, stale and closed-market states as well as ready states.
- Review frontend changes independently from backend uptime and notification-delivery work.

## Related repository

[**edge-backend**](https://github.com/bhaumiknaiksi-debug/edge-backend) — market data, signal research, execution gates, evidence and server-side notifications.
