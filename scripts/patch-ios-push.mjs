import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const file = resolve("ios", "App", "App", "AppDelegate.swift");
let source = await readFile(file, "utf8");
const bridge = `
    // EDGE native push bridge: pass APNs registration result to Capacitor.
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }
`;

if (source.includes("didRegisterForRemoteNotificationsWithDeviceToken")) {
  if (!source.includes(".capacitorDidRegisterForRemoteNotifications") ||
      !source.includes(".capacitorDidFailToRegisterForRemoteNotifications")) {
    throw new Error("AppDelegate already defines push callbacks; reconcile manually");
  }
  console.log("EDGE APNs bridge already present");
  process.exit(0);
}

const anchor = "class AppDelegate: UIResponder, UIApplicationDelegate {";
if (!source.includes(anchor)) {
  throw new Error("Unexpected Capacitor AppDelegate template; refusing unsafe native patch");
}
source = source.replace(anchor, anchor + "\n" + bridge);
await writeFile(file, source, "utf8");
console.log("EDGE APNs bridge installed");
