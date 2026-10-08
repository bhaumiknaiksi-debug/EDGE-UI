import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { build } from "esbuild";

const root = process.cwd();
const out = resolve(root, "www");
const staticFiles = [
  "manifest.json",
  "offline.html",
  "pwa.js",
  "sw.js",
  "edge-icon.svg"
];

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

let html = await readFile(resolve(root, "index.html"), "utf8");
if (!html.includes('src="./mobile.js"') && !html.includes('src="/mobile.js"')) {
  html = html.replace("</body>", '  <script src="./mobile.js" defer></script>\n</body>');
}
await writeFile(resolve(out, "index.html"), html, "utf8");

for (const file of staticFiles) {
  await mkdir(dirname(resolve(out, file)), { recursive: true });
  await cp(resolve(root, file), resolve(out, file));
}

await build({
  entryPoints: [resolve(root, "src/mobile-entry.js")],
  bundle: true,
  minify: true,
  format: "iife",
  platform: "browser",
  target: ["es2020"],
  outfile: resolve(out, "mobile.js")
});

console.log("EDGE mobile web bundle ready in www/");
