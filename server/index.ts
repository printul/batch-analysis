// server/index.ts

import dotenv from "dotenv";
dotenv.config();

import express, { Express, Request, Response, NextFunction } from "express";
import cors from "cors";
import { setupAuth, authRoutes } from "./auth";
import { registerRoutes } from "./routes";

const app: Express = express();

// CORS & body‐parsing
app.use(
  cors({
    origin: true,
    credentials: true,
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Sessions & Passport
setupAuth(app);
// Auth endpoints: /api/register, /api/login, /api/logout, /api/me
app.use(authRoutes);

// Mount everything else (users, batches, docs, analysis, etc.)
(async () => {
  const server = await registerRoutes(app);

  // Global error handler
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err);
    const status = err.status || 500;
    res.status(status).json({ message: err.message || "Internal Server Error" });
  });

  const PORT = Number(process.env.PORT || 5050);
  server.listen(PORT, () => {
    console.log(`✅ Server running on http://localhost:${PORT}`);
  });
})();
