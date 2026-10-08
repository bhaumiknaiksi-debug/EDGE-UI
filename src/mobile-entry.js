import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { PushNotifications } from "@capacitor/push-notifications";
import { SplashScreen } from "@capacitor/splash-screen";

const state = {
  native: Capacitor.isNativePlatform(),
  platform: Capacitor.getPlatform(),
  pushPermission: "unknown",
  pushRegistered: false,
  pushToken: null
};

function emit(name, detail = {}) {
  window.dispatchEvent(new CustomEvent("edge:" + name, { detail }));
}

async function getPushPermission() {
  if (!state.native) return "unsupported";
  const status = await PushNotifications.checkPermissions();
  state.pushPermission = status.receive;
  return status.receive;
}

async function enablePushNotifications() {
  if (!state.native) return { ok: false, reason: "NOT_NATIVE" };

  let permission = await getPushPermission();
  if (permission === "prompt") {
    const requested = await PushNotifications.requestPermissions();
    permission = requested.receive;
    state.pushPermission = permission;
  }

  if (permission !== "granted") {
    emit("push-permission", { permission });
    return { ok: false, reason: "PERMISSION_" + String(permission).toUpperCase() };
  }

  await PushNotifications.register();
  return { ok: true, pendingRegistration: true };
}

if (state.native) {
  PushNotifications.addListener("registration", token => {
    state.pushRegistered = true;
    state.pushToken = token.value;
    // Token is intentionally NOT uploaded anywhere yet.
    emit("push-registered", { platform: state.platform, token: token.value });
  });

  PushNotifications.addListener("registrationError", error => {
    state.pushRegistered = false;
    emit("push-registration-error", { error });
  });

  PushNotifications.addListener("pushNotificationReceived", notification => {
    emit("push-received", { notification });
  });

  PushNotifications.addListener("pushNotificationActionPerformed", action => {
    emit("push-action", { action });
  });

  App.addListener("appStateChange", ({ isActive }) => {
    emit("app-state", { isActive });
  });

  App.addListener("appUrlOpen", event => {
    emit("deep-link", { url: event.url });
  });

  document.addEventListener("DOMContentLoaded", async () => {
    document.documentElement.dataset.edgeNative = "true";
    document.documentElement.dataset.edgePlatform = state.platform;
    try { await SplashScreen.hide(); } catch (_) {}
    try { await getPushPermission(); } catch (_) {}
    emit("native-ready", { platform: state.platform });
  });
}

window.EDGE_MOBILE = Object.freeze({
  isNative: () => state.native,
  platform: () => state.platform,
  pushState: () => ({ ...state }),
  enablePushNotifications
});
