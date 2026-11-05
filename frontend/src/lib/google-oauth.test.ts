import assert from "node:assert/strict";
import { test } from "node:test";

import { googleAuthUrl, readGoogleFlow, sha256Hex } from "./google-oauth.ts";

test("Google is sent back to WorkIt's callback with the hashed nonce", async () => {
  const url = new URL(
    googleAuthUrl({
      clientId: "id",
      redirectUri: "https://workitjobs.ai/auth/google/callback",
      state: "s",
      hashedNonce: await sha256Hex("abc"),
    }),
  );
  assert.equal(url.searchParams.get("redirect_uri"), "https://workitjobs.ai/auth/google/callback");
  // SHA-256 of "abc": Supabase hashes the raw nonce and compares with this.
  assert.equal(
    url.searchParams.get("nonce"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});

test("a missing or malformed flow cookie reads as no flow", () => {
  assert.equal(readGoogleFlow(undefined), null);
  assert.equal(readGoogleFlow("not json"), null);
  assert.equal(readGoogleFlow('{"state":"s","nonce":"n","mode":"other"}'), null);
  assert.deepEqual(readGoogleFlow('{"state":"s","nonce":"n","mode":"link"}'), {
    state: "s",
    nonce: "n",
    mode: "link",
  });
});
