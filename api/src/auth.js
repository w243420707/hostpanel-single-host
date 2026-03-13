import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { getAdminUser, setAdminUser } from "./db.js";

const JWT_SECRET = process.env.JWT_SECRET || "change-me-in-production";
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "change-me-now";

export function ensureAdminBootstrap() {
  const existing = getAdminUser();
  if (existing) {
    return;
  }
  const passwordHash = bcrypt.hashSync(ADMIN_PASSWORD, 10);
  setAdminUser(ADMIN_USERNAME, passwordHash);
}

export function loginAdmin(username, password) {
  const user = getAdminUser();
  if (!user) {
    return null;
  }
  if (username !== user.username) {
    return null;
  }
  if (!bcrypt.compareSync(password, user.password_hash)) {
    return null;
  }
  const token = jwt.sign({ role: "admin", username: user.username }, JWT_SECRET, {
    expiresIn: "12h"
  });
  return token;
}

export function verifyAdminToken(token) {
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.role !== "admin") {
      return null;
    }
    return payload;
  } catch (_error) {
    return null;
  }
}

export function changeAdminCredentials({ oldPassword, newUsername, newPassword }) {
  const user = getAdminUser();
  if (!user) {
    throw new Error("admin_not_initialized");
  }
  if (!bcrypt.compareSync(oldPassword, user.password_hash)) {
    throw new Error("invalid_old_password");
  }

  const finalUsername = newUsername || user.username;
  const finalPasswordHash = newPassword ? bcrypt.hashSync(newPassword, 10) : user.password_hash;
  setAdminUser(finalUsername, finalPasswordHash);
}

export function requireAdmin(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: "missing_token" });
  }
  const payload = verifyAdminToken(token);
  if (!payload) {
    return res.status(401).json({ error: "invalid_token" });
  }
  req.admin = payload;
  return next();
}
