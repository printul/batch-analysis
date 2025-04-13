import { users, tweets, type User, type InsertUser, type Tweet } from "@shared/schema";
import bcrypt from "bcryptjs";

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

export class MemStorage implements IStorage {
  private users: Map<number, User>;
  private tweets: Map<number, Tweet>;
  private userCurrentId: number;
  private tweetCurrentId: number;

  constructor() {
    this.users = new Map();
    this.tweets = new Map();
    this.userCurrentId = 1;
    this.tweetCurrentId = 1;
    
    // Initialize with admin user
    this.createInitialAdminUser();
  }

  private async createInitialAdminUser() {
    const adminExists = await this.getUserByUsername("admin");
    if (!adminExists) {
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash("admin123", salt);
      
      this.users.set(this.userCurrentId, {
        id: this.userCurrentId++,
        username: "admin",
        password: hashedPassword,
        isAdmin: true,
        createdAt: new Date(),
      });
    }
  }

  async getUser(id: number): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username === username,
    );
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    // Hash the password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(insertUser.password, salt);
    
    const id = this.userCurrentId++;
    const user: User = { 
      ...insertUser, 
      id, 
      password: hashedPassword,
      createdAt: new Date(),
    };
    
    this.users.set(id, user);
    return { ...user, password: "[REDACTED]" } as User; // Don't return the password
  }

  async getAllUsers(): Promise<User[]> {
    // Return all users without passwords
    return Array.from(this.users.values()).map(user => ({
      ...user,
      password: "[REDACTED]"
    }));
  }

  async deleteUser(id: number): Promise<boolean> {
    return this.users.delete(id);
  }

  async validateUserCredentials(username: string, password: string): Promise<User | null> {
    const user = await this.getUserByUsername(username);
    if (!user) return null;
    
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return null;
    
    // Return the user without the password
    return { ...user, password: "[REDACTED]" } as User;
  }

  async getTweets(page: number, limit: number): Promise<{ tweets: Tweet[], totalTweets: number, totalPages: number }> {
    const allTweets = Array.from(this.tweets.values());
    const sortedTweets = allTweets.sort((a, b) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    
    const totalTweets = sortedTweets.length;
    const totalPages = Math.ceil(totalTweets / limit);
    
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    
    const paginatedTweets = sortedTweets.slice(startIndex, endIndex);
    
    return {
      tweets: paginatedTweets,
      totalTweets,
      totalPages
    };
  }

  async saveTweet(tweet: Omit<Tweet, 'id'>): Promise<Tweet> {
    const id = this.tweetCurrentId++;
    const newTweet = { ...tweet, id } as Tweet;
    
    this.tweets.set(id, newTweet);
    return newTweet;
  }

  async getTweetCount(): Promise<number> {
    return this.tweets.size;
  }
}

export const storage = new MemStorage();
