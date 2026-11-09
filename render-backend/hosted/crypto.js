import { Buffer } from "node:buffer";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
} from "node:crypto";
import { mkdir, open, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb);

export async function loadMasterKey(
  dataDir,
  dbPath = path.join(dataDir, "hosted.sqlite"),
) {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const keyPath = path.join(dataDir, "master.key");
  try {
    const key = await readFile(keyPath);
    if (key.length !== 32) throw new Error("Invalid encryption key file");
    return key;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    try {
      const dbInfo = await stat(dbPath);
      if (dbInfo.size > 0)
        throw new Error(
          "Encryption key is missing while hosted database exists; restore the matching /data/master.key backup",
        );
    } catch (statError) {
      if (statError.code !== "ENOENT") throw statError;
    }
    const key = randomBytes(32);
    try {
      const file = await open(keyPath, "wx", 0o600);
      try {
        await file.writeFile(key);
        await file.sync();
      } finally {
        await file.close();
      }
      return key;
    } catch (writeError) {
      if (writeError.code !== "EEXIST") throw writeError;
      const existing = await readFile(keyPath);
      if (existing.length !== 32)
        throw new Error("Invalid encryption key file");
      return existing;
    }
  }
}

export function createSecretBox(key) {
  if (!Buffer.isBuffer(key) || key.length !== 32)
    throw new TypeError("A 32-byte key is required");
  return {
    encrypt(value) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const ciphertext = Buffer.concat([
        cipher.update(JSON.stringify(value), "utf8"),
        cipher.final(),
      ]);
      return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString(
        "base64",
      );
    },
    decrypt(value) {
      const packed = Buffer.from(value, "base64");
      if (packed.length < 29)
        throw new Error("Encrypted credential is invalid");
      const decipher = createDecipheriv(
        "aes-256-gcm",
        key,
        packed.subarray(0, 12),
      );
      decipher.setAuthTag(packed.subarray(12, 28));
      return JSON.parse(
        Buffer.concat([
          decipher.update(packed.subarray(28)),
          decipher.final(),
        ]).toString("utf8"),
      );
    },
  };
}

export async function hashPassword(password, salt = randomBytes(16)) {
  const digest = await scrypt(password, salt, 64, {
    N: 16384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  return `scrypt$16384$8$1$${salt.toString("base64")}$${Buffer.from(digest).toString("base64")}`;
}

export async function verifyPassword(password, encoded) {
  const [, n, r, p, saltText, digestText] = String(encoded).split("$");
  if (n !== "16384" || r !== "8" || p !== "1" || !saltText || !digestText)
    return false;
  const salt = Buffer.from(saltText, "base64");
  const expected = Buffer.from(digestText, "base64");
  const actual = Buffer.from(
    await scrypt(password, salt, expected.length, {
      N: 16384,
      r: 8,
      p: 1,
      maxmem: 64 * 1024 * 1024,
    }),
  );
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export const hashSession = (value) =>
  createHash("sha256").update(value).digest("hex");
