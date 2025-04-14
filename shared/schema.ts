import { pgTable, text, serial, integer, boolean, timestamp, jsonb, doublePrecision } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  isAdmin: boolean("is_admin").default(false).notNull(),
  twitterUsername: text("twitter_username"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const tweets = pgTable("tweets", {
  id: serial("id").primaryKey(),
  tweetId: text("tweet_id").notNull().unique(),
  text: text("text").notNull(),
  author: text("author").notNull(),
  authorUsername: text("author_username").notNull(),
  createdAt: timestamp("created_at").notNull(),
  fetchedAt: timestamp("fetched_at").defaultNow().notNull(),
});

export const twitterAccounts = pgTable("twitter_accounts", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  name: text("name"),
  lastFetched: timestamp("last_fetched"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// To store tweet analysis results
export const tweetAnalysis = pgTable("tweet_analysis", {
  id: serial("id").primaryKey(),
  username: text("username").notNull(),
  summary: text("summary"),
  themes: text("themes").array(),
  sentimentScore: integer("sentiment_score"),
  sentimentLabel: text("sentiment_label"),
  sentimentConfidence: doublePrecision("sentiment_confidence"),
  topHashtags: text("top_hashtags").array(),
  keyPhrases: text("key_phrases").array(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// New tables for document analysis
export const documentBatches = pgTable("document_batches", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  userId: integer("user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull()
});

export const documents = pgTable("documents", {
  id: serial("id").primaryKey(),
  batchId: integer("batch_id").references(() => documentBatches.id),
  filename: text("filename").notNull(),
  fileType: text("file_type").notNull(),
  filePath: text("file_path").notNull(),
  extractedText: text("extracted_text"),
  createdAt: timestamp("created_at").defaultNow().notNull()
});

export const documentAnalysis = pgTable("document_analysis", {
  id: serial("id").primaryKey(),
  batchId: integer("batch_id").references(() => documentBatches.id),
  summary: text("summary"),
  themes: text("themes").array(),
  tickers: text("tickers").array(),
  recommendations: text("recommendations").array(),
  sentimentScore: doublePrecision("sentiment_score"),
  sentimentLabel: text("sentiment_label"),
  sharedIdeas: text("shared_ideas").array(),
  divergingIdeas: text("diverging_ideas").array(),
  keyPoints: text("key_points").array(),
  createdAt: timestamp("created_at").defaultNow().notNull()
});

// To store search history
export const searchHistory = pgTable("search_history", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  query: text("query").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
  isAdmin: true,
  twitterUsername: true,
});

export const loginUserSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});

export const twitterAccountSchema = createInsertSchema(twitterAccounts).pick({
  username: true,
  name: true,
});

export const searchSchema = z.object({
  query: z.string().min(1, "Search query is required"),
});

// Document batch schema for creation and validation
export const documentBatchSchema = createInsertSchema(documentBatches).pick({
  name: true,
  description: true,
});

// Document upload schema
export const documentUploadSchema = z.object({
  batchId: z.number().positive("Batch ID is required"),
  file: z.any(), // Will be handled by multer middleware
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type LoginUser = z.infer<typeof loginUserSchema>;
export type TwitterAccount = typeof twitterAccounts.$inferSelect;
export type InsertTwitterAccount = z.infer<typeof twitterAccountSchema>;
export type TweetAnalysisRecord = typeof tweetAnalysis.$inferSelect;
export type SearchHistoryRecord = typeof searchHistory.$inferSelect;
export type User = typeof users.$inferSelect;
export type Tweet = typeof tweets.$inferSelect;
export type DocumentBatch = typeof documentBatches.$inferSelect;
export type InsertDocumentBatch = z.infer<typeof documentBatchSchema>;
export type Document = typeof documents.$inferSelect;
export type DocumentAnalysisRecord = typeof documentAnalysis.$inferSelect;
