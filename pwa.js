(function () {
  "use strict";

  var BACKEND_URL = "https://edge-backend-r1ng.onrender.com";
  var deferredInstallPrompt = null;
  var isNative = !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === "function" && window.Capacitor.isNativePlatform());
  var isStandalone = isNative || window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;

  function addStyles() {
    var style = document.createElement("style");
    style.textContent = [
      ".edge-net-banner{position:sticky;top:0;z-index:1000;display:none;padding:7px 12px;text-align:center;font:700 9px/1.4 'Space Mono',monospace;letter-spacing:1px;background:#30151d;color:#ff8cab;border-bottom:1px solid rgba(255,51,102,.35)}",
      ".edge-net-banner.visible{display:block}",
      ".edge-install-btn{position:fixed;right:14px;bottom:calc(14px + env(safe-area-inset-bottom));z-index:50;border:1px solid rgba(0,229,255,.35);border-radius:999px;background:rgba(4,7,11,.94);color:#00e5ff;padding:9px 12px;font:700 9px/1 'Space Mono',monospace;letter-spacing:1px;box-shadow:0 8px 24px rgba(0,0,0,.35)}",
      ".edge-install-btn[hidden]{display:none}"
    ].join("");
    document.head.appendChild(style);
  }

  function ensureBanner() {
    var banner = document.createElement("div");
    banner.id = "edge-network-banner";
    banner.className = "edge-net-banner";
    banner.setAttribute("role", "status");
    banner.setAttribute("aria-live", "polite");
    document.body.insertBefore(banner, document.body.firstChild);
    return banner;
  }

  function updateNetworkBanner() {
    var banner = document.getElementById("edge-network-banner") || ensureBanner();
    var offline = !navigator.onLine;
    banner.classList.toggle("visible", offline);
    banner.textContent = offline ? "OFFLINE · LIVE MARKET DATA UNAVAILABLE · CACHED UI ONLY" : "";
    document.documentElement.dataset.edgeOnline = offline ? "false" : "true";
  }

  function showInstallButton() {
    if (isStandalone || document.getElementById("edge-install-btn")) return;
    var btn = document.createElement("button");
    btn.id = "edge-install-btn";
    btn.className = "edge-install-btn";
    btn.type = "button";
    btn.textContent = "INSTALL EDGE";
    btn.addEventListener("click", async function () {
      if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        try { await deferredInstallPrompt.userChoice; } catch (e) {}
        deferredInstallPrompt = null;
        btn.hidden = true;
        return;
      }
      var ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
      if (ios) {
        alert("Install EDGE on iPhone: open this page in Safari, tap Share, then choose Add to Home Screen.");
      } else {
        alert("Use your browser menu and choose Install app or Add to Home Screen.");
      }
    });
    document.body.appendChild(btn);
  }

  function formatNextOpen(iso) {
    if (!iso) return "--";
    try {
      return new Intl.DateTimeFormat("en-IN", {
        timeZone: "Asia/Kolkata",
        weekday: "short",
        day: "numeric",
        month: "short",
        hour: "numeric",
        minute: "2-digit"
      }).format(new Date(iso));
    } catch (e) { return "--"; }
  }

  async function refreshAuthoritativeMarketStatus() {
    // The backend, never the iPhone clock, owns exchange status.
    try {
      var response = await fetch(BACKEND_URL + "/api/v1/market/status", { cache: "no-store" });
      if (!response.ok) throw new Error("HTTP " + response.status);
      var status = await response.json();
      if (!status || !status.serverTime || !status.phase) throw new Error("INVALID_MARKET_STATUS");
      window.edgeBackendMarketStatus = status;
      window.edgeBackendMarketStatusCheckedAt = Date.now();
    } catch (e) {
      // An old successful market phase is not evidence of a working feed.
      window.edgeBackendMarketStatus = null;
      window.edgeBackendMarketStatusCheckedAt = 0;
    }
    if (typeof window.edgeApplyMarketStatus === "function") window.edgeApplyMarketStatus();
  }

  async function reloadLatestEdge() {
    var button = document.getElementById("edge-refresh-app");
    if (button) { button.disabled = true; button.textContent = "UPDATING…"; }
    try {
      if ("serviceWorker" in navigator) {
        var registration = await navigator.serviceWorker.getRegistration();
        if (registration) await registration.update();
      }
    } catch (_) {
      // Still navigate with a cache-busting URL if the service-worker update fails.
    }
    var url = new URL(location.href);
    url.searchParams.set("edge_refresh", String(Date.now()));
    location.replace(url.toString());
  }

  window.addEventListener("beforeinstallprompt", function (event) {
    event.preventDefault();
    deferredInstallPrompt = event;
    showInstallButton();
  });
  window.addEventListener("appinstalled", function () {
    var btn = document.getElementById("edge-install-btn");
    if (btn) btn.hidden = true;
  });
  window.addEventListener("online", function () { updateNetworkBanner(); refreshAuthoritativeMarketStatus(); });
  window.addEventListener("offline", function() {
    updateNetworkBanner();
    window.edgeBackendMarketStatus = null;
    window.edgeBackendMarketStatusCheckedAt = 0;
    if (typeof window.edgeApplyMarketStatus === "function") window.edgeApplyMarketStatus();
  });

  document.addEventListener("DOMContentLoaded", function () {
    addStyles();
    updateNetworkBanner();
    var updateButton = document.getElementById("edge-refresh-app");
    if (updateButton) updateButton.addEventListener("click", reloadLatestEdge);
    refreshAuthoritativeMarketStatus();
    setInterval(refreshAuthoritativeMarketStatus, 60000);

    var ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    if (!isStandalone && ios) showInstallButton();
  });
})();
