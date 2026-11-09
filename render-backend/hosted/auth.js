import { randomBytes } from "node:crypto";
import { hashPassword, hashSession, verifyPassword } from "./crypto.js";

const SESSION_COOKIE = "xyzw_server_session";
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const attempts = new Map();
const RATE_WINDOW = 15 * 60 * 1000;
const RATE_MAX = 12;

function cookies(req) {
  return Object.fromEntries(
    String(req.headers.cookie || "")
      .split(";")
      .map((x) => x.trim())
      .filter(Boolean)
      .map((x) => {
        const i = x.indexOf("=");
        return [x.slice(0, i), decodeURIComponent(x.slice(i + 1))];
      }),
  );
}
function cookie(value, secure, maxAge) {
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}
function rateLimit(req, res, next) {
  const key = req.ip || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.until <= now)
    attempts.set(key, { count: 1, until: now + RATE_WINDOW });
  else if (++entry.count > RATE_MAX)
    return res
      .status(429)
      .json({ error: "Too many authentication attempts; try again later" });
  if (attempts.size > 5000)
    for (const [k, v] of attempts) if (v.until <= now) attempts.delete(k);
  next();
}
const usernameValid = (s) => typeof s === "string" && /^[\w.-]{3,32}$/.test(s);
const passwordValid = (s) =>
  typeof s === "string" && s.length >= 10 && s.length <= 128;

export function createAuth({
  store,
  allowRegistration = true,
  cookieSecure = false,
}) {
  async function identify(req) {
    const session = cookies(req)[SESSION_COOKIE];
    if (!session) return null;
    const sessionHash = hashSession(session);
    const row = store.getSession(sessionHash);
    if (!row) return null;
    if (row.expires_at <= store.now()) {
      store.deleteSession(sessionHash);
      return null;
    }
    return store.getUser(row.user_id);
  }
  function requireUser(req, res, next) {
    identify(req)
      .then((user) => {
        if (!user) return res.status(401).json({ error: "Sign in required" });
        req.user = user;
        next();
      })
      .catch(() =>
        res.status(500).json({ error: "Authentication unavailable" }),
      );
  }
  async function register(req, res) {
    if (!allowRegistration)
      return res.status(403).json({ error: "Registration is disabled" });
    const { username, password } = req.body || {};
    if (!usernameValid(username) || !passwordValid(password))
      return res
        .status(400)
        .json({
          error:
            "Username must be 3–32 letters, numbers, dots, dashes or underscores; password must be 10–128 characters",
        });
    try {
      const user = store.createUser(username, await hashPassword(password));
      createSessionCookie(user, res);
      return res.status(201).json({ user });
    } catch (error) {
      if ((Number(error.errcode) & 0xff) === 19)
        return res
          .status(409)
          .json({ error: "Username is already registered" });
      throw error;
    }
  }
  async function login(req, res) {
    const { username, password } = req.body || {};
    if (
      typeof username !== "string" ||
      typeof password !== "string" ||
      username.length > 128 ||
      password.length > 256
    )
      return res.status(400).json({ error: "Invalid username or password" });
    const user = store.getUserByUsername(username);
    const ok = user && (await verifyPassword(password, user.password_hash));
    if (!ok)
      return res.status(401).json({ error: "Invalid username or password" });
    const safe = { id: user.id, username: user.username };
    createSessionCookie(safe, res);
    return res.json({ user: safe });
  }
  function createSessionCookie(user, res) {
    const session = randomBytes(32).toString("base64url");
    const hash = hashSession(session);
    store.createSession(hash, user.id, store.now() + SESSION_MS);
    res.setHeader(
      "Set-Cookie",
      cookie(session, cookieSecure, SESSION_MS / 1000),
    );
  }
  function logout(req, res) {
    const value = cookies(req)[SESSION_COOKIE];
    if (value) store.deleteSession(hashSession(value));
    res.setHeader("Set-Cookie", cookie("", cookieSecure, 0));
    return res.json({ ok: true });
  }
  return {
    identify,
    requireUser,
    rateLimit,
    register,
    login,
    logout,
    sessionCookieName: SESSION_COOKIE,
  };
}
