import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";

const publicFiles = [
  "index.html",
  "residential.html",
  "setup.html",
  "styles.css",
  "script.js",
  "public-org.js",
  "setup.js",
  "image-protection.js",
  "firebase-config.js",
  "favicon.ico",
  "assets/images/logo.png"
];

rmSync("dist", { recursive: true, force: true });
for (const file of publicFiles) {
  mkdirSync(dirname(`dist/${file}`), { recursive: true });
  cpSync(file, `dist/${file}`);
}
