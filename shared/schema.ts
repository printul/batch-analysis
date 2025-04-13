import { pgTable, text, serial, integer, boolean, timestamp } from "drizzle-orm/pg-core";
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

export type InsertUser = z.infer<typeof insertUserSchema>;
export type LoginUser = z.infer<typeof loginUserSchema>;
export type TwitterAccount = typeof twitterAccounts.$inferSelect;
export type InsertTwitterAccount = z.infer<typeof twitterAccountSchema>;
export type User = typeof users.$inferSelect;
export type Tweet = typeof tweets.$inferSelect;
