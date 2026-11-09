import assert from "node:assert/strict";
import { test } from "node:test";
import { parseTenPalaceFormation } from "../src/utils/tenPalace.js";

test("identifies an explicitly returned empty Ten Palace team as unsaved", () => {
  assert.throws(
    () => parseTenPalaceFormation({ teamInfo: {} }),
    (error) => error.code === "TEN_PALACE_FORMATION_NOT_SAVED",
  );
  assert.throws(
    () => parseTenPalaceFormation({ teamInfo: { team: new Map() } }),
    (error) => error.code === "TEN_PALACE_FORMATION_NOT_SAVED",
  );
});

test("rejects malformed Ten Palace response shapes", () => {
  assert.throws(() => parseTenPalaceFormation({ teamInfo: [] }), /格式无效/);
  assert.throws(() => parseTenPalaceFormation({}), /格式不正确/);
});
