import { users, tweets, twitterAccounts, type User, type InsertUser, type Tweet, type TwitterAccount, type InsertTwitterAccount } from "@shared/schema";
import bcrypt from "bcryptjs";
import { db } from "./db";
import { eq, desc } from "drizzle-orm";

export interface IStorage {
  // User operations
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  getAllUsers(): Promise<User[]>;
  deleteUser(id: number): Promise<boolean>;
  validateUserCredentials(username: string, password: string): Promise<User | null>;
  
  // Tweet operations
  getTweets(page: number, limit: number): Promise<{ tweets: Tweet[], totalTweets: number, totalPages: number }>;
  saveTweet(tweet: Omit<Tweet, 'id'>): Promise<Tweet>;
  getTweetCount(): Promise<number>;
  getTweetsByUsername(username: string, limit?: number): Promise<Tweet[]>;
  
  // Twitter account operations
  getAllTwitterAccounts(): Promise<TwitterAccount[]>;
  getTwitterAccount(id: number): Promise<TwitterAccount | undefined>;
  getTwitterAccountByUsername(username: string): Promise<TwitterAccount | undefined>;
  createTwitterAccount(account: InsertTwitterAccount): Promise<TwitterAccount>;
  deleteTwitterAccount(id: number): Promise<boolean>;
  updateTwitterAccountLastFetched(id: number, lastFetched: Date): Promise<TwitterAccount | undefined>;
  
  // Tweet analysis operations
  saveTweetAnalysis(analysis: {
    username: string;
    summary: string;
    themes: string[];
    sentimentScore: number;
    sentimentLabel: string;
    sentimentConfidence: number;
    topHashtags: string[];
    keyPhrases: string[];
  }): Promise<TweetAnalysisRecord>;
  getTweetAnalysisByUsername(username: string): Promise<TweetAnalysisRecord | undefined>;
  
  // Search history operations
  saveSearchQuery(userId: number, query: string): Promise<SearchHistoryRecord>;
  getRecentSearches(userId: number, limit?: number): Promise<SearchHistoryRecord[]>;
  deleteSearchHistory(userId: number): Promise<boolean>;
}

export class DatabaseStorage implements IStorage {
  constructor() {
    // Initialize with admin user
    this.createInitialAdminUser();
  }

  private async createInitialAdminUser() {
    const adminExists = await this.getUserByUsername("admin");
    if (!adminExists) {
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash("admin123", salt);
      
      await this.createUser({
        username: "admin",
        password: hashedPassword,
        isAdmin: true,
      });
    }
  }

  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    // Hash the password if it's not already hashed
    let userPassword = insertUser.password;
    if (!userPassword.startsWith('$2a$') && !userPassword.startsWith('$2b$')) {
      const salt = await bcrypt.genSalt(10);
      userPassword = await bcrypt.hash(insertUser.password, salt);
    }
    
    const [user] = await db
      .insert(users)
      .values({
        ...insertUser,
        password: userPassword,
      })
      .returning();
    
    return { ...user, password: "[REDACTED]" } as User;
  }

  async getAllUsers(): Promise<User[]> {
    const allUsers = await db.select().from(users);
    return allUsers.map(user => ({
      ...user,
      password: "[REDACTED]"
    }));
  }

  async deleteUser(id: number): Promise<boolean> {
    const result = await db.delete(users).where(eq(users.id, id)).returning();
    return result.length > 0;
  }

  async validateUserCredentials(username: string, password: string): Promise<User | null> {
    const user = await this.getUserByUsername(username);
    if (!user) return null;
    
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return null;
    
    return { ...user, password: "[REDACTED]" } as User;
  }

  async getTweets(page: number, limit: number): Promise<{ tweets: Tweet[], totalTweets: number, totalPages: number }> {
    // Get total count using SQL
    const { rows } = await db.$client.query('SELECT COUNT(*) as count FROM tweets');
    
    const totalTweets = Number(rows[0]?.count) || 0;
    const totalPages = Math.ceil(totalTweets / limit);
    
    const offset = (page - 1) * limit;
    
    const paginatedTweets = await db
      .select()
      .from(tweets)
      .orderBy(desc(tweets.createdAt))
      .limit(limit)
      .offset(offset);
    
    return {
      tweets: paginatedTweets,
      totalTweets,
      totalPages
    };
  }

  async saveTweet(tweet: Omit<Tweet, 'id'>): Promise<Tweet> {
    try {
      const [newTweet] = await db
        .insert(tweets)
        .values(tweet)
        .returning();
      
      return newTweet;
    } catch (error) {
      // Handle duplicate key error (for sample tweets)
      if (error instanceof Error && error.message.includes('duplicate key')) {
        // Return the existing tweet
        const [existingTweet] = await db
          .select()
          .from(tweets)
          .where(eq(tweets.tweetId, tweet.tweetId));
        
        return existingTweet;
      }
      throw error;
    }
  }

  async getTweetCount(): Promise<number> {
    const { rows } = await db.$client.query('SELECT COUNT(*) as count FROM tweets');
    return Number(rows[0]?.count) || 0;
  }
  
  // Twitter account operations
  async getAllTwitterAccounts(): Promise<TwitterAccount[]> {
    return db.select().from(twitterAccounts).orderBy(twitterAccounts.username);
  }
  
  async getTwitterAccount(id: number): Promise<TwitterAccount | undefined> {
    const [account] = await db.select().from(twitterAccounts).where(eq(twitterAccounts.id, id));
    return account;
  }
  
  async getTwitterAccountByUsername(username: string): Promise<TwitterAccount | undefined> {
    const [account] = await db.select().from(twitterAccounts).where(eq(twitterAccounts.username, username));
    return account;
  }
  
  async createTwitterAccount(account: InsertTwitterAccount): Promise<TwitterAccount> {
    try {
      const [newAccount] = await db
        .insert(twitterAccounts)
        .values(account)
        .returning();
      
      return newAccount;
    } catch (error) {
      // Handle duplicate username
      if (error instanceof Error && error.message.includes('duplicate key')) {
        const [existingAccount] = await db
          .select()
          .from(twitterAccounts)
          .where(eq(twitterAccounts.username, account.username));
        
        return existingAccount;
      }
      throw error;
    }
  }
  
  async deleteTwitterAccount(id: number): Promise<boolean> {
    const result = await db.delete(twitterAccounts).where(eq(twitterAccounts.id, id)).returning();
    return result.length > 0;
  }
  
  async updateTwitterAccountLastFetched(id: number, lastFetched: Date): Promise<TwitterAccount | undefined> {
    const [updated] = await db
      .update(twitterAccounts)
      .set({ lastFetched })
      .where(eq(twitterAccounts.id, id))
      .returning();
    
    return updated;
  }
}

export const storage = new DatabaseStorage();
