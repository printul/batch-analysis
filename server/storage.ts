import { 
  users, tweets, twitterAccounts, tweetAnalysis, searchHistory,
  documentBatches, documents, documentAnalysis,
  type User, type InsertUser, type Tweet, type TwitterAccount, 
  type InsertTwitterAccount, type TweetAnalysisRecord, type SearchHistoryRecord,
  type DocumentBatch, type InsertDocumentBatch, type Document, type DocumentAnalysisRecord
} from "@shared/schema";
import bcrypt from "bcryptjs";
import { db } from "./db";
import { eq, desc, sql, ilike, and, not, like } from "drizzle-orm";

export interface IStorage {
  // User operations
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  getAllUsers(): Promise<User[]>;
  deleteUser(id: number): Promise<boolean>;
  validateUserCredentials(username: string, password: string): Promise<User | null>;
  
  // Tweet operations (legacy)
  getTweets(page: number, limit: number): Promise<{ tweets: Tweet[], totalTweets: number, totalPages: number }>;
  saveTweet(tweet: Omit<Tweet, 'id'>): Promise<Tweet>;
  getTweetCount(): Promise<number>;
  getTweetsByUsername(username: string, limit?: number): Promise<Tweet[]>;
  
  // Twitter account operations (legacy)
  getAllTwitterAccounts(): Promise<TwitterAccount[]>;
  getTwitterAccount(id: number): Promise<TwitterAccount | undefined>;
  getTwitterAccountByUsername(username: string): Promise<TwitterAccount | undefined>;
  createTwitterAccount(account: InsertTwitterAccount): Promise<TwitterAccount>;
  deleteTwitterAccount(id: number): Promise<boolean>;
  updateTwitterAccountLastFetched(id: number, lastFetched: Date): Promise<TwitterAccount | undefined>;
  
  // Tweet analysis operations (legacy)
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
  
  // Document batch operations
  createDocumentBatch(batch: InsertDocumentBatch & { userId: number }): Promise<DocumentBatch>;
  getDocumentBatch(id: number): Promise<DocumentBatch | undefined>;
  getDocumentBatchesByUserId(userId: number): Promise<DocumentBatch[]>;
  deleteDocumentBatch(id: number): Promise<boolean>;
  
  // Document operations
  saveDocument(document: { 
    batchId: number;
    filename: string;
    fileType: string;
    filePath: string;
    extractedText?: string;
  }): Promise<Document>;
  getDocumentsByBatchId(batchId: number): Promise<Document[]>;
  updateDocumentExtractedText(id: number, extractedText: string): Promise<Document | undefined>;
  deleteDocument(id: number): Promise<boolean>;
  
  // Document analysis operations
  saveDocumentAnalysis(analysis: {
    batchId: number;
    summary: string;
    themes: string[];
    tickers?: string[];
    recommendations?: string[];
    sentimentScore: number;
    sentimentLabel: string;
    sharedIdeas?: string[];
    divergingIdeas?: string[];
    keyPoints: string[];
  }): Promise<DocumentAnalysisRecord>;
  getDocumentAnalysisByBatchId(batchId: number): Promise<DocumentAnalysisRecord | undefined>;
  
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
    // Filter out sample tweets
    const { rows } = await db.$client.query("SELECT COUNT(*) as count FROM tweets WHERE tweet_id NOT LIKE 'sample%'");
    
    const totalTweets = Number(rows[0]?.count) || 0;
    const totalPages = Math.ceil(totalTweets / limit);
    
    const offset = (page - 1) * limit;
    
    const paginatedTweets = await db
      .select()
      .from(tweets)
      .where(
        and(
          not(like(tweets.tweetId, 'sample%'))
        )
      )
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

  // Implement getTweetsByUsername
  async getTweetsByUsername(username: string, limit: number = 20): Promise<Tweet[]> {
    // Remove @ prefix if present
    const cleanUsername = username.startsWith('@') ? username.substring(1) : username;
    
    // Use case-insensitive search with ilike and filter out sample tweets
    return db
      .select()
      .from(tweets)
      .where(
        and(
          ilike(tweets.authorUsername, cleanUsername),
          not(like(tweets.tweetId, 'sample%'))
        )
      )
      .orderBy(desc(tweets.createdAt))
      .limit(limit);
  }

  // Save tweet analysis
  async saveTweetAnalysis(analysis: {
    username: string;
    summary: string;
    themes: string[];
    sentimentScore: number;
    sentimentLabel: string;
    sentimentConfidence: number;
    topHashtags: string[];
    keyPhrases: string[];
  }): Promise<TweetAnalysisRecord> {
    try {
      // Check if analysis already exists for this username
      const existingAnalysis = await this.getTweetAnalysisByUsername(analysis.username);
      
      if (existingAnalysis) {
        // Update the existing analysis
        const [updated] = await db
          .update(tweetAnalysis)
          .set(analysis)
          .where(eq(tweetAnalysis.username, analysis.username))
          .returning();
          
        return updated;
      } else {
        // Create new analysis
        const [newAnalysis] = await db
          .insert(tweetAnalysis)
          .values(analysis)
          .returning();
          
        return newAnalysis;
      }
    } catch (error) {
      console.error('Error saving tweet analysis:', error);
      throw error;
    }
  }

  // Get tweet analysis by username
  async getTweetAnalysisByUsername(username: string): Promise<TweetAnalysisRecord | undefined> {
    // Remove @ prefix if present
    const cleanUsername = username.startsWith('@') ? username.substring(1) : username;
    
    const [analysis] = await db
      .select()
      .from(tweetAnalysis)
      .where(eq(tweetAnalysis.username, cleanUsername));
      
    return analysis;
  }

  // Save search query
  async saveSearchQuery(userId: number, query: string): Promise<SearchHistoryRecord> {
    const [searchRecord] = await db
      .insert(searchHistory)
      .values({
        userId,
        query
      })
      .returning();
      
    return searchRecord;
  }

  // Get recent searches
  async getRecentSearches(userId: number, limit: number = 10): Promise<SearchHistoryRecord[]> {
    return db
      .select()
      .from(searchHistory)
      .where(eq(searchHistory.userId, userId))
      .orderBy(desc(searchHistory.createdAt))
      .limit(limit);
  }

  // Delete search history
  async deleteSearchHistory(userId: number): Promise<boolean> {
    const result = await db
      .delete(searchHistory)
      .where(eq(searchHistory.userId, userId))
      .returning();
      
    return result.length > 0;
  }

  // Document batch operations
  async createDocumentBatch(batch: InsertDocumentBatch & { userId: number }): Promise<DocumentBatch> {
    const [newBatch] = await db
      .insert(documentBatches)
      .values({
        name: batch.name,
        description: batch.description,
        userId: batch.userId
      })
      .returning();
    
    return newBatch;
  }

  async getDocumentBatch(id: number): Promise<DocumentBatch | undefined> {
    const [batch] = await db
      .select()
      .from(documentBatches)
      .where(eq(documentBatches.id, id));
    
    return batch;
  }

  async getDocumentBatchesByUserId(userId: number): Promise<DocumentBatch[]> {
    return db
      .select()
      .from(documentBatches)
      .where(eq(documentBatches.userId, userId))
      .orderBy(desc(documentBatches.createdAt));
  }

  async deleteDocumentBatch(id: number): Promise<boolean> {
    // First delete all documents in the batch
    await db
      .delete(documents)
      .where(eq(documents.batchId, id));
    
    // Then delete the batch analysis if it exists
    await db
      .delete(documentAnalysis)
      .where(eq(documentAnalysis.batchId, id));
    
    // Finally delete the batch itself
    const result = await db
      .delete(documentBatches)
      .where(eq(documentBatches.id, id))
      .returning();
    
    return result.length > 0;
  }

  // Document operations
  async saveDocument(document: { 
    batchId: number;
    filename: string;
    fileType: string;
    filePath: string;
    extractedText?: string;
  }): Promise<Document> {
    const [newDocument] = await db
      .insert(documents)
      .values(document)
      .returning();
    
    return newDocument;
  }

  async getDocumentsByBatchId(batchId: number): Promise<Document[]> {
    return db
      .select()
      .from(documents)
      .where(eq(documents.batchId, batchId))
      .orderBy(documents.filename);
  }
  
  async getDocumentWithBatch(id: number): Promise<(Document & { batch: DocumentBatch }) | undefined> {
    const result = await db.query.documents.findFirst({
      where: eq(documents.id, id),
      with: {
        batch: true
      }
    });
    
    return result;
  }

  async updateDocumentExtractedText(id: number, extractedText: string): Promise<Document | undefined> {
    const [updated] = await db
      .update(documents)
      .set({ extractedText })
      .where(eq(documents.id, id))
      .returning();
    
    return updated;
  }

  async deleteDocument(id: number): Promise<boolean> {
    const result = await db
      .delete(documents)
      .where(eq(documents.id, id))
      .returning();
    
    return result.length > 0;
  }

  // Document analysis operations
  async saveDocumentAnalysis(analysis: {
    batchId: number;
    summary: string;
    themes: string[];
    tickers?: string[];
    recommendations?: string[];
    sentimentScore: number;
    sentimentLabel: string;
    sharedIdeas?: string[];
    divergingIdeas?: string[];
    keyPoints: string[];
  }): Promise<DocumentAnalysisRecord> {
    try {
      // Check if analysis already exists for this batch
      const existingAnalysis = await this.getDocumentAnalysisByBatchId(analysis.batchId);
      
      if (existingAnalysis) {
        // Update the existing analysis
        const [updated] = await db
          .update(documentAnalysis)
          .set(analysis)
          .where(eq(documentAnalysis.batchId, analysis.batchId))
          .returning();
          
        return updated;
      } else {
        // Create new analysis
        const [newAnalysis] = await db
          .insert(documentAnalysis)
          .values(analysis)
          .returning();
          
        return newAnalysis;
      }
    } catch (error) {
      console.error('Error saving document analysis:', error);
      throw error;
    }
  }

  async getDocumentAnalysisByBatchId(batchId: number): Promise<DocumentAnalysisRecord | undefined> {
    const [analysis] = await db
      .select()
      .from(documentAnalysis)
      .where(eq(documentAnalysis.batchId, batchId));
      
    return analysis;
  }
}

export const storage = new DatabaseStorage();
