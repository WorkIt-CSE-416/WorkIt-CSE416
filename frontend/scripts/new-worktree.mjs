// `npm run worktree -- KAN-123-short-slug`: a new worktree for one ticket,
// ready to run. Plain Node so it behaves the same on macOS and Windows.
//
// - The folder is named after the ticket key (../WorkIt-CSE416-KAN-123), so
//   folder and branch always agree. One ticket per worktree; never switch a
//   worktree to another ticket's branch.
// - The branch starts from a freshly fetched origin/main, or is checked out
//   as-is if it already exists locally or on origin.
// - Env files are copied from the primary checkout, because a new worktree
//   has none and the app and the API fail without them. They are copies:
//   re-run with --env-only to refresh them.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

const ENV_FILES = [".env", join("frontend", ".env.local")];

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();

const args = process.argv.slice(2);
const envOnly = args.includes("--env-only");
const branch = args.find((a) => !a.startsWith("--"));
const key = branch?.match(/^KAN-\d+/)?.[0];

// `git worktree list` always prints the primary checkout first.
const primary = git("worktree", "list", "--porcelain").split("\n")[0].slice("worktree ".length);
const here = git("rev-parse", "--show-toplevel");

if (!envOnly && !key) {
  console.error(
    "usage: npm run worktree -- KAN-123-short-slug   (or --env-only inside a worktree)",
  );
  process.exit(1);
}

const target = envOnly ? here : resolve(dirname(primary), `${basename(primary)}-${key}`);

if (!envOnly) {
  if (existsSync(target)) {
    console.error(`${target} already exists. One ticket, one worktree: open that one.`);
    process.exit(1);
  }
  git("fetch", "origin");
  const local = git("branch", "--list", branch);
  const remote = git("branch", "-r", "--list", `origin/${branch}`);
  if (local) git("worktree", "add", target, branch);
  else if (remote) git("worktree", "add", "--track", "-b", branch, target, `origin/${branch}`);
  else git("worktree", "add", "-b", branch, target, "origin/main");
  console.log(`created ${target} on ${branch}`);
}

for (const file of ENV_FILES) {
  const from = join(primary, file);
  if (!existsSync(from) || resolve(from) === resolve(join(target, file))) continue;
  mkdirSync(dirname(join(target, file)), { recursive: true });
  copyFileSync(from, join(target, file));
  console.log(`copied ${file}`);
}

if (!envOnly)
  console.log(
    `next: cd ${target}, run npm ci in frontend/ and uv sync in backend/, then start claude there`,
  );
