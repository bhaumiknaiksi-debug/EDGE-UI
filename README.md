# EDGE

### Clarity before conviction.

EDGE is a personal **NIFTY 50 options research and decision-support app**. It brings market context, candidate option structures, entry conditions and risk checks into one interface, so the next decision is easier to understand.

This repository contains the **web frontend, installable PWA and Capacitor mobile wrapper**. The separate [EDGE backend](https://github.com/bhaumiknaiksi-debug/edge-backend) supplies market data, research and authoritative execution decisions. Trades are placed manually through the user's broker; EDGE does not submit orders.

> **Branch scope:** This README describes the EDGE 2.0 interface on `feat/stitch-edge-2-ui`. Features on this branch are not necessarily available on the production `main` deployment until merged.

## What EDGE shows

| Area | Purpose |
| --- | --- |
| **Home** | NIFTY Market Pulse, the current decision, A/B/C signal tiers, expandable evidence and a compact strike watchlist. |
| **Signals** | Actual backend candidate contracts, strategy context, quote references and filters for ready, waiting, blocked or invalidated candidates. |
| **Insights** | Available session observations, reference levels and conditional entry/invalidation scenarios. Closed-market snapshots are labeled historical. |
| **Control** | Web notification settings and app recovery controls. Pro mode also exposes evidence collection and research diagnostics. |

### Simple and Pro

**Simple** emphasizes the market, the next decision and the contracts being watched. Supporting explanations expand when needed.

**Pro** exposes the existing action desk, technical indicators, option intelligence, research evidence and diagnostic detail. Switching modes changes presentation, not trading rules.

### Market Pulse

- Spot price, available movement, chart direction, expiry and volatility context.
- Support/resistance and other reference levels supplied by the backend.
- A timestamped price trace using available same-session history and verified observations collected while the page is open.
- Explicit live, historical, unverified and unavailable states.

The trace can contain only part of a session. It is not a complete exchange candle feed. Missing observations and prices are not replaced with sample values.

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

Waiting, blocked, stale, offline, pre-open and closed-market states do not become permission to trade. Candidate rows use ask references for buy legs and bid references for sell legs, falling back to labeled LTP where available. Quotes must be rechecked before manual entry, and spread legs must be evaluated together.

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
git switch feat/stitch-edge-2-ui
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

For browser coverage:

```bash
npm install --no-save --package-lock=false playwright
npx playwright install --with-deps chromium
node scripts/edge-visual-check.cjs
```

The browser check starts a local server on port `8765`, uses isolated market fixtures, checks 320/390/768/1280-pixel layouts, exercises both modes and all four tabs, and verifies decision states, chart visibility, filters and disclosures. Screenshots are written to `visual-results/`; do not commit generated test images.

GitHub Actions runs frontend checks and publishes the `edge-design-screenshots` artifact. Separate workflows cover Web Push integration and native bootstrap/iOS simulator builds. Fixture tests verify presentation behavior; they do not verify live market-feed continuity or actual notification delivery.

## Web deployment and PWA

Deploy the repository root as a static site. The existing web deployment uses Vercel and follows `main` for production. A design-branch preview is separate from production and may require Vercel authentication.

`vercel.json` defines revalidation headers for the HTML shell, service worker and supporting scripts. The service worker prefers network responses, with cached app-shell assets available as a fallback. It does not intentionally cache cross-origin market/API responses.

For shell changes, keep the service-worker cache version and its regression assertion aligned. A cached interface is not proof of a live market connection. **Control → Update & Reload** provides an app recovery action.

## Notifications

Browser Web Push controls live in **Control → Lock Screen Alerts**. Enrollment requires supported browser APIs, notification permission and authenticated backend registration using the private enrollment code. The test action is available only after server-confirmed enrollment.

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
- Keep operational controls in Control and advanced detail in Pro.
- Validate UI changes against waiting, blocked, invalidated, stale and closed-market states as well as ready states.
- Review frontend changes independently from backend uptime and notification-delivery work.

## Related repository

[**edge-backend**](https://github.com/bhaumiknaiksi-debug/edge-backend) — market data, signal research, execution gates, evidence and server-side notifications.
