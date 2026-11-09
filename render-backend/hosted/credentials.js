import { Buffer } from "node:buffer";
export function parseRoleToken(input) {
  if (typeof input === "object" && input) return normalizeCredential(input);
  if (typeof input !== "string" || input.length > 32768)
    throw new Error("roleToken must be a JSON token or Base64 JSON token");
  const candidates = [input];
  if (!input.trim().startsWith("{")) {
    try {
      candidates.push(
        Buffer.from(input.trim().replace(/^token:/i, ""), "base64").toString(
          "utf8",
        ),
      );
    } catch {}
  }
  for (const text of candidates) {
    try {
      let value = JSON.parse(text);
      for (let i = 0; i < 3 && typeof value === "string"; i++)
        value = JSON.parse(value);
      if (value && typeof value === "object") return normalizeCredential(value);
    } catch {}
  }
  throw new Error(
    "Unrecognized roleToken; expected serialized role credentials",
  );
}

function normalizeCredential(value) {
  let v = value;
  for (let i = 0; i < 3; i++) {
    if (typeof v.gameToken === "string") {
      const wrapper = v.gameToken.trim();
      try {
        v = { ...JSON.parse(wrapper), ...v };
      } catch {
        try {
          v = {
            ...JSON.parse(
              Buffer.from(wrapper.replace(/^token:/i, ""), "base64").toString(
                "utf8",
              ),
            ),
            ...v,
          };
        } catch {}
      }
    }
    if (typeof v.roleToken === "string" && !v.roleId) {
      try {
        const parsed = JSON.parse(v.roleToken);
        v = { ...parsed, ...v };
      } catch {}
    }
    if (typeof v.token === "string" && !v.roleToken) {
      try {
        const parsed = JSON.parse(v.token);
        v = { ...parsed, ...v };
      } catch {}
    }
    if (v.gameToken && typeof v.gameToken === "object")
      v = { ...v.gameToken, ...v };
  }
  const roleToken = String(v.roleToken || v.token || "");
  const roleId = String(v.roleId || v.id || "");
  if (!roleToken || !roleId || roleToken.length > 16000 || roleId.length > 128)
    throw new Error("roleToken must contain roleToken and roleId");
  return {
    roleToken,
    roleId,
    sessId: Number.isFinite(Number(v.sessId)) ? Number(v.sessId) : 0,
    connId: Number.isFinite(Number(v.connId)) ? Number(v.connId) : 0,
    isRestore: Number(v.isRestore) || 0,
  };
}

export function decodeBinBase64(value) {
  if (value == null || value === "") return null;
  if (
    typeof value !== "string" ||
    value.length > 12 * 1024 * 1024 ||
    !/^[A-Z0-9+/]*={0,2}$/i.test(value)
  )
    throw new Error("binBase64 must be valid Base64 (up to 8 MiB)");
  const bin = Buffer.from(value, "base64");
  if (!bin.length || bin.length > 8 * 1024 * 1024)
    throw new Error("BIN file must be between 1 byte and 8 MiB");
  return bin;
}
