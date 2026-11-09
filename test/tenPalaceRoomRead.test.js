import assert from "node:assert/strict";
import test from "node:test";
import { bon } from "../src/utils/bonProtocol.js";
import { parseRoleTenPalaceTeamId } from "../src/utils/tenPalace.js";

test("reads a Ten Palace team ID from the plain object produced by BON decoding", () => {
  const response = {
    roleMTData: {
      gDMTData: new Map([[1, { teamCfgId: 1, teamId: "team-123" }]]),
    },
  };
  const decoded = bon.decode(bon.encode(response));

  assert.equal(decoded.roleMTData.gDMTData instanceof Map, false);
  assert.equal(parseRoleTenPalaceTeamId(decoded, 1), "team-123");
});

test("keeps Map and array team records and treats an empty record set as no team", () => {
  const row = { teamCfgId: 1, teamId: "team-456" };

  assert.equal(parseRoleTenPalaceTeamId({ roleMTData: { gDMTData: new Map([[1, row]]) } }, 1), "team-456");
  assert.equal(parseRoleTenPalaceTeamId({ roleMTData: { gDMTData: [row] } }, 1), "team-456");
  assert.equal(parseRoleTenPalaceTeamId({ roleMTData: { gDMTData: {} } }, 1), "");
  assert.equal(parseRoleTenPalaceTeamId({ roleMTData: { gDMTData: [] } }, 1), "");
  assert.equal(parseRoleTenPalaceTeamId({}, 1), "");
});
