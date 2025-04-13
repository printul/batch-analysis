import { users, tweets, type User, type InsertUser, type Tweet } from "@shared/schema";
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
    // Get total count
    const [countResult] = await db.select({
      count: tweets.id,
    }).from(tweets).$dynamic();
    
    const totalTweets = Number(countResult?.count) || 0;
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
    const [newTweet] = await db
      .insert(tweets)
      .values(tweet)
      .returning();
    
    return newTweet;
  }

  async getTweetCount(): Promise<number> {
    const [result] = await db
      .select({ count: tweets.id })
      .from(tweets)
      .$dynamic();
    
    return Number(result?.count) || 0;
  }
}

export const storage = new DatabaseStorage();
