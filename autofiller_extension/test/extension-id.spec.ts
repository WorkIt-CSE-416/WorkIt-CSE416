// One extension ID for the website, the dev build and the Store item (KAN-463): manifest.json's `key`
// decides it (store/extension-id.mjs), and the website calls that ID.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { extensionId } from "../store/extension-id.mjs";
import { EXTENSION_ID } from "./loaded-extension";

const manifest = JSON.parse(readFileSync(join(__dirname, "..", "manifest.json"), "utf8"));
const website = readFileSync(join(__dirname, "..", "..", "frontend", "src", "lib", "autofill-extension.ts"), "utf8");

test("a key's ID is the one Chrome gives the unpacked extension", () => {
  // The dev key's ID, as chrome://extensions showed it for the unpacked dev build.
  const devKey =
    "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA6iiGgX+OUoM2lQfIH/juWXhuCX3SF9adz2XvmLsqkAwjsHfK5S8pEB+V5OIPUGGckxVpJSD0bCyd1Rb0QO77Hcp7aJE+DUmdDWyxQ/3NaoSrf+FtSl1iFD7VWnOeQ5g2Gbz93LrrQ1avdNpWqJq+hUpG7NZpHoxmpAUagxbl5GRY5Wp7+MptiAm9eHk33lE1oduTmAysymlRHRGD+r14gDeDlxedd0lvkS9bKUrYxyGmfEcM5mNyEfv5MxIuiZz2iaErmW30UtSYYDaAWI6ONxoK+4G4/FDUY7nC4749hQrcoRugWR3Pi6UgqkcTM+xvekkfSKAaX3hhncUTyYATPwIDAQAB";
  expect(extensionId(devKey)).toBe("cpklhdkoafegnndlafmiceehfloodjgi");
});

test("the website calls the ID manifest.json's key gives", () => {
  expect(website).toContain(`const EXTENSION_ID = "${extensionId(manifest.key)}";`);
});

test("the tests load the extension at the ID manifest.json's key gives", () => {
  expect(EXTENSION_ID).toBe(extensionId(manifest.key));
});
