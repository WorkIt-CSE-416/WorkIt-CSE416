// Cross-platform `clean`. Plain Node so it behaves identically in bash,
// zsh, PowerShell and cmd.exe -- no `rm -rf`, no shell globbing.
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

for (const target of [".next", "out", "coverage", "tsconfig.tsbuildinfo"]) {
  rmSync(join(root, target), { recursive: true, force: true });
  console.log(`removed ${target}`);
}
