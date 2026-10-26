// Copies the generated WASM module from the svg-app repository (read-only).
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = process.env.SVG_WASM_DIR ?? join(root, "..", "svg-app", "dist", "wasm");
const destDir = join(root, "src", "wasm");
const files = ["svg-converter.js", "svg-converter.wasm"];

mkdirSync(destDir, { recursive: true });
for (const f of files) {
  const from = join(srcDir, f);
  if (!existsSync(from)) {
    console.error(`Missing ${from}. Build the WASM module in svg-app first.`);
    process.exit(1);
  }
  copyFileSync(from, join(destDir, f));
}
console.log(`Synced WASM files from ${srcDir}`);
