// EDGE iPhone/Android Home Screen Web Push. No private credentials are persisted.
(function () {
  "use strict";
  var API = "https://edge-backend-r1ng.onrender.com/api/v1/push";
  var standalone = window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true;
  var ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  var isNative = !!(window.Capacitor &&
    typeof window.Capacitor.isNativePlatform === "function" &&
    window.Capacitor.isNativePlatform());

  if (isNative) return; // Capacitor has a separate native alerts path.

  var config = null;
  var registration = null;
  var subscription = null;
  var working = false;
  var els = {};

  function setStatus(message, color) {
    if (!els.status) return;
    els.status.textContent = message;
    els.status.style.color = color || "#8aa0ad";
  }

  function setButtons() {
    var canUse = !!(config && config.enabled && registration && !working);
    if (els.enable) els.enable.disabled = !canUse;
    if (els.test) {
      els.test.hidden = !subscription;
      els.test.disabled = !canUse || !subscription;
    }
    if (els.disable) {
      els.disable.hidden = !subscription;
      // Local opt-out is always available even when the push server fails.
      els.disable.disabled = !subscription || working;
    }
    if (els.enable) els.enable.textContent = subscription ? "RECONNECT ALERTS" : "ENABLE ALERTS";
  }

  function urlBase64ToUint8Array(base64Url) {
    var padding = "=".repeat((4 - base64Url.length % 4) % 4);
    var base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
    var bytes = atob(base64);
    return Uint8Array.from(bytes, function (c) { return c.charCodeAt(0); });
  }

  function usesCurrentVapidKey(existing, currentKey) {
    var key = existing && existing.options && existing.options.applicationServerKey;
    if (!key || !currentKey) return false;
    var actual = new Uint8Array(key);
    var expected = urlBase64ToUint8Array(currentKey);
    return actual.length === expected.length && actual.every(function (byte, i) {
      return byte === expected[i];
    });
  }

  async function request(path, code, payload) {
    var response = await fetch(API + path, {
      method: "POST",
      mode: "cors",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + code
      },
      body: JSON.stringify(payload)
    });
    var data;
    try { data = await response.json(); } catch (_) { data = {}; }
    if (!response.ok) {
      var error = new Error(data.error || "HTTP " + response.status);
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function getCode() {
    var code = els.secret && els.secret.value.trim();
    if (!code) {
      setStatus("Enter the private enrollment code from your EDGE backend setup.", "#ffaa00");
      if (els.secret) els.secret.focus();
      return null;
    }
    return code;
  }

  async function enable() {
    if (working || !registration || !config || !config.enabled) return;
    var code = getCode();
    if (!code) return;
    if (Notification.permission === "denied") {
      setStatus("Notifications are blocked. Enable EDGE notifications in iPhone Settings.", "#ff668c");
      return;
    }

    working = true;
    setButtons();
    setStatus("Requesting notification permission…", "#ffaa00");
    try {
      // Subscribe directly from the user gesture (critical for iOS Home Screen).
      // Browsers may display the notification permission prompt during subscribe().
      // A VAPID rotation invalidates an old subscription. Remove it first,
      // then ask for a SECOND deliberate tap: subscribe() needs a fresh user gesture on iOS.
      var previous = subscription;
      if (previous && !usesCurrentVapidKey(previous, config.publicKey)) {
        await previous.unsubscribe();
        subscription = null;
        setStatus("Push keys changed. Old subscription cleared. Tap Enable Alerts again to reconnect.", "#ffaa00");
        return;
      }
      var promise = previous
        ? Promise.resolve(previous)
        : registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(config.publicKey)
          });
      var sub = await promise;
      subscription = sub;
      setStatus("Registering this device securely…", "#ffaa00");
      await request("/subscribe", code, { subscription: sub.toJSON() });
      setStatus("This device is registered. Send a test to confirm delivery." +
        (config.autoAlerts ? " Automatic alerts are enabled." : " Automatic alerts are not yet enabled on the server."), "#00ff88");
    } catch (error) {
      setStatus("Could not enable alerts: " + (error && error.name === "NotAllowedError"
        ? "permission denied. Check iPhone Settings."
        : (error && error.message ? error.message : "unknown error")) + ".",
      "#ff668c");
    } finally {
      working = false;
      setButtons();
    }
  }

  async function test() {
    if (working || !subscription) return;
    var code = getCode();
    if (!code) return;
    working = true; setButtons(); setStatus("Sending a harmless test notification…", "#ffaa00");
    try {
      await request("/test", code, { endpoint: subscription.endpoint });
      setStatus("Test sent. Lock your iPhone and look for the EDGE notification.", "#00ff88");
    } catch (error) {
      setStatus("Test failed: " + error.message, "#ff668c");
    } finally { working = false; setButtons(); }
  }

  async function disable() {
    if (working || !subscription) return;
    // Local revocation must NEVER depend on the owner's enrollment code
    // or backend availability. Users must always be able to opt out.
    var code = els.secret && els.secret.value.trim();
    var previous = subscription;
    working = true; setButtons(); setStatus("Disabling alerts on this device…", "#ffaa00");
    var remoteError = null;
    try {
      if (code && config && config.enabled) {
        try { await request("/unsubscribe", code, { endpoint: previous.endpoint }); }
        catch (e) { remoteError = e; }
      } else {
        remoteError = new Error("Server cleanup not requested");
      }
      var locallyDisabled = await previous.unsubscribe();
      if (locallyDisabled) subscription = null;
      setStatus(locallyDisabled
        ? (remoteError
          ? "Alerts disabled on this device; server cleanup is pending."
          : "Alerts disabled for this installation.")
        : "Could not revoke browser subscription. Please retry or block EDGE in notification settings.",
        locallyDisabled ? "#8aa0ad" : "#ff668c");
    } catch (error) {
      setStatus("Local opt-out failed: " + error.message + ". Check iPhone notification settings.", "#ff668c");
    } finally { working = false; setButtons(); }
  }

  function mount() {
    var style = document.createElement("style");
    style.textContent = [
      ".edge-push-card{max-width:452px;width:calc(100% - 28px);margin:0 auto 10px;padding:12px 13px;border:1px solid rgba(0,229,255,.26);border-radius:12px;background:rgba(10,17,25,.95);position:relative;z-index:2;font-family:'Space Mono',monospace;color:#e2eef2}",
      ".edge-push-title{font-size:11px;letter-spacing:1.6px;color:#00e5ff;font-weight:bold}",
      ".edge-push-desc{font-size:9px;line-height:1.6;color:#88a5b6;margin:6px 0 8px}",
      ".edge-push-status{font-size:9px;line-height:1.5;color:#8aa0ad;margin-top:7px}",
      ".edge-push-controls{display:flex;flex-wrap:wrap;gap:7px;margin-top:7px}",
      ".edge-push-controls button{font:700 9px 'Space Mono',monospace;border:1px solid rgba(0,229,255,.35);border-radius:7px;color:#00e5ff;background:transparent;padding:8px 9px}",
      ".edge-push-controls button:disabled{opacity:.35}",
      ".edge-push-code{width:100%;padding:9px 10px;border:1px solid #294353;background:#050c13;color:#e2eef2;border-radius:7px;font:11px 'Space Mono',monospace}",
      ".edge-push-code::placeholder{color:#6d8693}",
      ".edge-push-note{font-size:8px;line-height:1.5;color:#627b8a;margin-top:7px}"
    ].join("");
    document.head.appendChild(style);

    var box = document.createElement("section");
    box.className = "edge-push-card";
    box.setAttribute("aria-label", "EDGE alert settings");
    var title = document.createElement("div");
    title.className = "edge-push-title";
    title.textContent = "EDGE · LOCK SCREEN ALERTS";
    var desc = document.createElement("p");
    desc.className = "edge-push-desc";
    desc.textContent = "Opt in to backend-confirmed state alerts. Notifications are not trade instructions.";
    var secret = document.createElement("input");
    secret.className = "edge-push-code";
    secret.type = "password";
    secret.autocomplete = "off";
    secret.placeholder = "Private EDGE enrollment code";
    secret.setAttribute("aria-label", "Private EDGE enrollment code");
    secret.spellcheck = false;
    var buttons = document.createElement("div");
    buttons.className = "edge-push-controls";

    function button(label, action) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = label;
      btn.addEventListener("click", action);
      buttons.appendChild(btn);
      return btn;
    }
    var enableBtn = button("ENABLE ALERTS", enable);
    var testBtn = button("SEND TEST", test);
    var disableBtn = button("DISABLE", disable);
    var status = document.createElement("div");
    status.className = "edge-push-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.textContent = "Checking notification support…";
    var note = document.createElement("div");
    note.className = "edge-push-note";
    note.textContent = "Your code is used only for this session, never saved to device storage.";

    box.append(title, desc, secret, buttons, status, note);
    // Put controls inside the permanent, user-operated ALERTS section.
    // Unlike a market-data card, this section is available during an outage.
    var slot = document.getElementById("edge-push-slot");
    if (slot) slot.replaceChildren(box);
    else {
      var anchor = document.querySelector(".market-status-bar");
      if (anchor && anchor.parentNode) anchor.insertAdjacentElement("afterend", box);
      else document.body.prepend(box);
    }
    els = { secret, enable: enableBtn, test: testBtn, disable: disableBtn, status };
    enableBtn.disabled = true;
    testBtn.hidden = true; disableBtn.hidden = true;
  }

  async function boot() {
    mount();

    if (ios && !standalone) {
      els.secret.hidden = true;
      setStatus("For iPhone: open EDGE in Safari, tap Share → Add to Home Screen, then launch the Home Screen icon.");
      return;
    }

    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      els.secret.hidden = true;
      setStatus("Web Push is unavailable on this device or browser.", "#ffaa00");
      return;
    }

    var readyTimeout;
    try {
      // Retrieve local subscription FIRST, so DISABLE works if the server fails.
      // serviceWorker.ready can wait indefinitely if installation failed. Do not
      // strand the settings panel on "Checking notification support…".
      registration = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise(function(_, reject) {
          readyTimeout = setTimeout(function() {
            reject(new Error("Service worker not ready. Open EDGE online, then relaunch the Home Screen app."));
          }, 15000);
        })
      ]);
      subscription = await registration.pushManager.getSubscription();
      setButtons();
    } catch (error) {
      setStatus("Browser push unavailable: " + (error.message || "unknown error"), "#ff668c");
      return;
    } finally {
      clearTimeout(readyTimeout);
    }
    try {
      var response = await fetch(API + "/config", { cache: "no-store" });
      if (!response.ok) throw new Error("Push status HTTP " + response.status);
      config = await response.json();
      if (!config.enabled || !config.publicKey) {
        setStatus("Alerts await secure backend setup. Local Disable still works.", "#ffaa00");
        setButtons();
        return;
      }
      setStatus(subscription
        ? "Browser permission exists. Enter the enrollment code to reconnect or send a test."
        : "Enter your enrollment code, then tap Enable Alerts. You control notification permission.",
        "#00e5ff");
      setButtons();
    } catch (error) {
      setStatus("Push server unavailable. You can still Disable alerts on this device.", "#ff668c");
      setButtons();
    }
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
