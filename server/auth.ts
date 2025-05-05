import { Router, Express, Request, Response, NextFunction } from "express";
import passport from "passport";
import session from "express-session";
import { Strategy as LocalStrategy } from "passport-local";
import { pool } from "./db";
import connectPg from "connect-pg-simple";
import { storage } from "./storage";
import { scrypt, timingSafeEqual } from "crypto";
import { promisify } from "util";
import bcrypt from "bcryptjs";

declare global {
  namespace Express {
    interface User { id: number; username: string; isAdmin: boolean; }
  }
}

const scryptAsync = promisify(scrypt);

// Password helpers...
async function hashPassword(password: string) {
  return bcrypt.hashSync(password, 10);
}
async function comparePasswords(supplied: string, stored: string) {
  if (stored.startsWith("$2")) {
    return bcrypt.compareSync(supplied, stored);
  } else if (stored.includes(".")) {
    const [hashed, salt] = stored.split(".");
    const hashedBuf = Buffer.from(hashed, "hex");
    const suppliedBuf = (await scryptAsync(supplied, salt, 64)) as Buffer;
    return timingSafeEqual(hashedBuf, suppliedBuf);
  } else {
    return supplied === stored;
  }
}

// 1) Session & Passport setup on the app:
export function setupAuth(app: Express) {
  const PostgresSessionStore = connectPg(session);
  app.use(
    session({
      secret: process.env.SESSION_SECRET || "dev-secret",
      resave: false,
      saveUninitialized: false,
      store: new PostgresSessionStore({
        pool,
        tableName: "user_sessions",
        createTableIfMissing: true,
      }),
      cookie: {
        secure: process.env.NODE_ENV === "production",
        httpOnly: true,
        maxAge: 7 * 24 * 60 * 60 * 1000,
      },
    })
  );
  app.use(passport.initialize());
  app.use(passport.session());

  passport.use(
    new LocalStrategy(async (username, password, done) => {
      try {
        const user = await storage.getUserByUsername(username);
        if (!user || !(await comparePasswords(password, user.password))) {
          return done(null, false);
        }
        return done(null, user);
      } catch (e) {
        return done(e as Error);
      }
    })
  );
  passport.serializeUser((user, done) => done(null, user.id));
  passport.deserializeUser(async (id, done) => {
    try {
      const user = await storage.getUser(id);
      done(null, user);
    } catch (e) {
      done(e as Error);
    }
  });
}

// 2) Router for all /api/... endpoints:
export const authRoutes = Router();

// Registration
authRoutes.post("/api/register", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const exists = await storage.getUserByUsername(req.body.username);
    if (exists) return res.status(400).json({ message: "Username taken" });

    const user = await storage.createUser({
      ...req.body,
      password: await hashPassword(req.body.password),
    });
    req.login(user, err => (err ? next(err) : res.status(201).json(user)));
  } catch (e) {
    next(e);
  }
});

// Login
authRoutes.post("/api/login", (req, res, next) => {
  passport.authenticate("local", (err, user, info) => {
    if (err) return next(err);
    if (!user) return res.status(401).json({ message: info.message });
    req.login(user, err => (err ? next(err) : res.json(user)));
  })(req, res, next);
});

// Logout
authRoutes.post("/api/logout", (req, res, next) => {
  req.logout(err => (err ? next(err) : res.sendStatus(200)));
});

// “Who am I?”
authRoutes.get("/api/me", (req, res) => {
  if (!req.isAuthenticated()) return res.sendStatus(401);
  res.json({ user: req.user });
});

