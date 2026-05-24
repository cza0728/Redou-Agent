import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

const copies = [
  [
    path.join(root, "node_modules", "@nous-research", "ui", "dist", "fonts"),
    path.join(root, "public", "fonts"),
  ],
  [
    path.join(root, "node_modules", "@nous-research", "ui", "dist", "assets"),
    path.join(root, "public", "ds-assets"),
  ],
];

for (const [from, to] of copies) {
  await fs.rm(to, { force: true, recursive: true });
  await fs.cp(from, to, { recursive: true });
}
