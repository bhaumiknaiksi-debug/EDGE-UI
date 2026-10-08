# EDGE Native Mobile Wrapper

EDGE stays web-first. Capacitor provides the native iOS/Android shell; the existing Render backend remains the authority for market state, signals, risk and execution readiness.

## Identity

- App name: `EDGE`
- Bundle/Application ID: `com.bhaumiknaik.edge`
- Mobile web assets: `www/`
- Native push tokens are not uploaded to the backend yet.

The app ID should be treated as locked once App Store / Play Console records are created.

## First-time setup

Capacitor 8 requires Node.js 22+.

```bash
npm install
npm run mobile:init
```

That generates `ios/` and `android/`, creates native icon/splash assets, and syncs the bundled EDGE web app.

For subsequent web changes:

```bash
npm run mobile:sync
```

Open native projects:

```bash
npm run mobile:open:ios
npm run mobile:open:android
```

## Push notification foundation

`src/mobile-entry.js` installs native listeners and exposes:

```js
await window.EDGE_MOBILE.enablePushNotifications()
```

Permission is never requested automatically. Call it only after an explicit user action explaining what EDGE alerts will be sent.

The generated token is intentionally kept on-device / in JavaScript only for now. A later backend PR will add authenticated device-token registration plus a server-side notification policy. Do not send trading alerts directly from client-side heuristics.

### iOS final wiring

In Xcode, enable **Push Notifications** capability and the appropriate **Background Modes > Remote notifications** capability. APNs signing/provisioning is required before remote pushes work.

### Android final wiring

Add the Firebase `google-services.json` to the generated Android app and configure Firebase Cloud Messaging before remote pushes work.

## Safety invariant

Native notifications are a presentation channel only. They must reflect backend-authoritative EDGE state transitions and must never calculate BUY/SELL readiness locally.
