import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";

const root = process.cwd();
const assets = resolve(root, "assets");
await mkdir(assets, { recursive: true });

const iconSvg = resolve(root, "edge-icon.svg");
const bg = "#04070b";

await sharp(iconSvg).resize(1024, 1024).png().toFile(resolve(assets, "icon-only.png"));
await sharp(iconSvg).resize(1024, 1024).png().toFile(resolve(assets, "icon-foreground.png"));
await sharp({
  create: { width: 1024, height: 1024, channels: 4, background: bg }
}).png().toFile(resolve(assets, "icon-background.png"));

const foreground = await sharp(iconSvg).resize(820, 820).png().toBuffer();
for (const name of ["splash.png", "splash-dark.png"]) {
  await sharp({
    create: { width: 2732, height: 2732, channels: 4, background: bg }
  })
    .composite([{ input: foreground, gravity: "center" }])
    .png()
    .toFile(resolve(assets, name));
}

console.log("EDGE icon/splash source assets generated in assets/");
