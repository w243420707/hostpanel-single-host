import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { getAdminUser, setAdminUser } from "./db.js";

const JWT_SECRET = process.env.JWT_SECRET || "change-me-in-production";
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";

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

export function requireAdmin(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: "missing_token" });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.role !== "admin") {
      return res.status(403).json({ error: "forbidden" });
    }
    req.admin = payload;
    return next();
  } catch (error) {
    return res.status(401).json({ error: "invalid_token" });
  }
}
