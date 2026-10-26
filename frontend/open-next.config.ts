import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// The default incremental cache: no R2 bucket. Every live read in this app
// opts out of caching (`await connection()`, no `revalidate`), so ISR has
// little to keep.
export default defineCloudflareConfig();
