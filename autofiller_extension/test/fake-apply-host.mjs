// A fake Apply accounts host (apply-agent's native_host.py) for the extension's tests (KAN-592): Chrome
// starts it once per native message, with the caller's origin as its first argument. It answers from
// a JSON file of made-up logins by tenant, as the real host answers from Keychain, and logs each
// request (origin, tenant, want), never an answer, to a file the test reads.
import { appendFileSync, readFileSync } from "node:fs";

const [accountsFile, logFile, origin] = process.argv.slice(2);
const chunks = [];
process.stdin.on("data", (chunk) => {
  chunks.push(chunk);
  const all = Buffer.concat(chunks);
  if (all.length < 4 || all.length < 4 + all.readUInt32LE(0)) return;
  const request = JSON.parse(all.subarray(4, 4 + all.readUInt32LE(0)).toString());
  appendFileSync(logFile, JSON.stringify({ origin, tenant: request.tenant, want: request.want }) + "\n");
  const account = JSON.parse(readFileSync(accountsFile, "utf8"))[request.tenant];
  const { password, ...known } = account ?? {};
  const answer = !account ? { none: "Apply made no account there" } : request.want === "login" ? { ...known, password } : known;
  const body = Buffer.from(JSON.stringify(answer));
  const head = Buffer.alloc(4);
  head.writeUInt32LE(body.length);
  process.stdout.write(Buffer.concat([head, body]), () => process.exit(0));
});
