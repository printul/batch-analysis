// server/routes.ts

import type { Express, Request, Response, NextFunction } from "express";
import { createServer, Server } from "http";
import { storage } from "./storage";
import multer from "multer";
import path from "path";
import fs from "fs";
import {
  insertUserSchema,
  searchSchema,
  documentBatchSchema,
} from "@shared/schema";
import { analyzeDocuments } from "./openai";

/**
 * Mounts all non-auth routes on the given Express app,
 * and returns an http.Server ready to listen().
 */
export async function registerRoutes(app: Express): Promise<Server> {
  // --- Authorization middleware ---
  const isAuthenticated = (req: Request, res: Response, next: NextFunction) => {
    if (req.isAuthenticated()) return next();
    res.status(401).json({ error: "Unauthorized" });
  };
  const isAdmin = (req: Request, res: Response, next: NextFunction) => {
    if (req.isAuthenticated() && req.user!.isAdmin) return next();
    res.status(403).json({ error: "Access denied" });
  };

  // --- Multer setup for file uploads ---
  const upload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, "uploads/documents"),
      filename: (_req, file, cb) => {
        const unique = `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
        cb(null, `${unique}${path.extname(file.originalname)}`);
      },
    }),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
  });

  // --- 1) User management ---
  app.get("/api/users", isAuthenticated, isAdmin, async (_req, res) => {
    const users = await storage.getAllUsers();
    res.json(users);
  });

  app.post("/api/users", isAuthenticated, isAdmin, async (req, res) => {
    const parsed = insertUserSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid request data" });
    const exists = await storage.getUserByUsername(parsed.data.username);
    if (exists) return res.status(400).json({ error: "Username already exists" });
    const user = await storage.createUser(parsed.data);
    res.status(201).json({ success: true, user });
  });

  app.delete("/api/users/:id", isAuthenticated, isAdmin, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (req.user!.id === id) return res.status(400).json({ error: "Cannot delete your own account" });
    const exist = await storage.getUser(id);
    if (!exist) return res.status(404).json({ error: "User not found" });
    await storage.deleteUser(id);
    res.json({ success: true });
  });

  // --- 2) Search endpoints ---
  app.post("/api/search", isAuthenticated, async (req, res) => {
    const parsed = searchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid search query" });
    await storage.saveSearchQuery(req.user!.id, parsed.data.query);
    const recentSearches = await storage.getRecentSearches(req.user!.id, 5);
    res.json({ success: true, recentSearches });
  });

  app.get("/api/recent-searches", isAuthenticated, async (req, res) => {
    const recentSearches = await storage.getRecentSearches(req.user!.id);
    res.json(recentSearches);
  });

  app.delete("/api/search-history", isAuthenticated, async (req, res) => {
    await storage.deleteSearchHistory(req.user!.id);
    res.json({ success: true });
  });

  // --- 3) Document batch endpoints ---
  app.post("/api/document-batches", isAuthenticated, async (req, res) => {
    const parsed = documentBatchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid batch data" });
    const batch = await storage.createDocumentBatch({ title: parsed.data.title, userId: req.user!.id });
    res.status(201).json(batch);
  });

  app.get("/api/document-batches", isAuthenticated, async (req, res) => {
    const batches = await storage.getDocumentBatchesByUserId(req.user!.id);
    const detailed = await Promise.all(
      batches.map(async (b) => {
        const docs = await storage.getDocumentsByBatchId(b.id);
        return { ...b, documentCount: docs.length };
      })
    );
    res.json(detailed);
  });

  app.get("/api/document-batches/:id", isAuthenticated, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const batch = await storage.getDocumentBatch(id);
    if (!batch) return res.status(404).json({ error: "Batch not found" });
    if (batch.userId !== req.user!.id && !req.user!.isAdmin) return res.status(403).json({ error: "Access denied" });
    const docs = await storage.getDocumentsByBatchId(id);
    const analysis = await storage.getDocumentAnalysisByBatchId(id);
    res.json({ batch, documents: docs, analysis });
  });

  app.delete("/api/document-batches/:id", isAuthenticated, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const batch = await storage.getDocumentBatch(id);
    if (!batch) return res.status(404).json({ error: "Batch not found" });
    if (batch.userId !== req.user!.id && !req.user!.isAdmin) return res.status(403).json({ error: "Access denied" });
    const docs = await storage.getDocumentsByBatchId(id);
    await storage.deleteDocumentBatch(id);
    docs.forEach((d) => fs.unlinkSync(d.filePath));
    res.json({ success: true });
  });

  // --- 4) Document upload endpoint ---
  app.post("/api/documents/upload", isAuthenticated, upload.single("file"), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    const batchId = parseInt(req.body.batchId, 10);
    if (isNaN(batchId)) return res.status(400).json({ error: "Invalid batch ID" });
    const batch = await storage.getDocumentBatch(batchId);
    if (!batch) return res.status(404).json({ error: "Batch not found" });
    if (batch.userId !== req.user!.id && !req.user!.isAdmin) return res.status(403).json({ error: "Access denied" });
    const document = await storage.saveDocument({
      batchId,
      filename: req.file.originalname,
      fileType: path.extname(req.file.originalname).slice(1),
      filePath: req.file.path,
    });
    res.status(201).json(document);
  });

  // --- 5) Document analysis endpoint ---
  app.post("/api/documents/analyze/:batchId", isAuthenticated, async (req, res) => {
    const batchId = parseInt(req.params.batchId, 10);
    const batch = await storage.getDocumentBatch(batchId);
    if (!batch) return res.status(404).json({ error: "Batch not found" });
    if (batch.userId !== req.user!.id && !req.user!.isAdmin) return res.status(403).json({ error: "Access denied" });

    // Read each document's content
    const docs = await storage.getDocumentsByBatchId(batchId);
    const docsForAnalysis = docs.map((d) => ({
      filename: d.filename,
      content: fs.readFileSync(d.filePath, "utf8"),
    }));

    const analysis = await analyzeDocuments(docsForAnalysis);
    // Persist the analysis for the batch
    await storage.saveDocumentAnalysis({ batchId, analysis });
    res.json(analysis);
  });

  // --- 6) Document summary endpoints ---
  app.get("/api/documents/:id/summary", isAuthenticated, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid document ID" });
    const docWithBatch = await storage.getDocumentWithBatch(id);
    if (!docWithBatch) return res.status(404).json({ error: "Document not found" });
    if (docWithBatch.batch.userId !== req.user!.id && !req.user!.isAdmin)
      return res.status(403).json({ error: "Access denied" });
    const summary = await storage.getDocumentSummary(id);
    if (!summary)
      return res.status(404).json({ error: "No summary available", status: "needs_generation" });
    res.json(summary);
  });

  app.post("/api/documents/:id/summary", isAuthenticated, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid document ID" });
    const docWithBatch = await storage.getDocumentWithBatch(id);
    if (!docWithBatch) return res.status(404).json({ error: "Document not found" });
    if (docWithBatch.batch.userId !== req.user!.id && !req.user!.isAdmin)
      return res.status(403).json({ error: "Access denied" });

    const content = fs.readFileSync(docWithBatch.filePath, "utf8");
    const [analysisResult] = await (async () => {
      const result = await analyzeDocuments([{ filename: docWithBatch.filename, content }]);
      return [result];
    })();
    const saved = await storage.saveDocumentSummary(id, analysisResult.summary);
    res.json(saved);
  });

  // --- 7) Health check ---
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", time: new Date().toISOString(), environment: process.env.NODE_ENV });
  });

  // Wrap and return the HTTP server
  return createServer(app);
}
