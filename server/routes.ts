import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import session from "express-session";
import MemoryStore from "memorystore";
import { TwitterApi } from "twitter-api-v2";
import { loginUserSchema, insertUserSchema } from "@shared/schema";
import NodeCron from "node-cron";

declare module 'express-session' {
  interface SessionData {
    user?: {
      id: number;
      username: string;
      isAdmin: boolean;
    };
  }
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Session setup
  const MemoryStoreSession = MemoryStore(session);
  app.use(session({
    secret: process.env.SESSION_SECRET || 'tweetmonitor-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { 
      secure: process.env.NODE_ENV === 'production',
      maxAge: 86400000 // 24 hours
    },
    store: new MemoryStoreSession({
      checkPeriod: 86400000 // prune expired entries every 24h
    })
  }));

  // Initialize Twitter client (if environment variables are available)
  let twitterClient;
  if (process.env.TWITTER_BEARER_TOKEN) {
    twitterClient = new TwitterApi(process.env.TWITTER_BEARER_TOKEN);
  }

  // Middleware to check if user is authenticated
  const isAuthenticated = (req: Request, res: Response, next: Function) => {
    if (req.session.user) {
      return next();
    }
    res.status(401).json({ error: 'Unauthorized' });
  };

  // Middleware to check if user is admin
  const isAdmin = (req: Request, res: Response, next: Function) => {
    if (req.session.user && req.session.user.isAdmin) {
      return next();
    }
    res.status(403).json({ error: 'Access denied' });
  };

  // Function to fetch tweets from Twitter API
  async function fetchTweets() {
    try {
      if (!twitterClient) {
        console.log('Twitter client not configured - skipping tweet fetch');
        return;
      }

      console.log('Fetching tweets...');
      const timeline = await twitterClient.v2.homeTimeline({
        max_results: 50,
        'tweet.fields': ['created_at', 'author_id'],
        'user.fields': ['name', 'username'],
        expansions: ['author_id']
      });
      
      let savedCount = 0;
      // Process and save tweets
      for (const tweet of timeline.data.data) {
        const author = timeline.data.includes.users.find(user => user.id === tweet.author_id);
        
        if (author) {
          await storage.saveTweet({
            tweetId: tweet.id,
            text: tweet.text,
            author: author.name,
            authorUsername: author.username,
            createdAt: new Date(tweet.created_at),
            fetchedAt: new Date()
          });
          savedCount++;
        }
      }
      
      console.log(`Fetched and saved ${savedCount} tweets`);
    } catch (error) {
      console.error('Error fetching tweets:', error);
    }
  }

  // Schedule tweet fetching if environment variables are set
  if (process.env.TWEET_FETCH_INTERVAL) {
    const intervalMinutes = Math.max(1, Math.ceil(parseInt(process.env.TWEET_FETCH_INTERVAL || '3600000') / 60000));
    const cronSchedule = `*/${intervalMinutes} * * * *`;
    console.log(`Scheduling tweet fetching with cron schedule: ${cronSchedule}`);
    
    NodeCron.schedule(cronSchedule, fetchTweets);
    
    // Initial tweet fetch
    fetchTweets();
  }

  // Authentication endpoints
  app.post('/api/login', async (req, res) => {
    try {
      const result = loginUserSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ error: 'Invalid request data' });
      }
      
      const { username, password } = result.data;
      const user = await storage.validateUserCredentials(username, password);
      
      if (!user) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      
      // Set session
      req.session.user = {
        id: user.id,
        username: user.username,
        isAdmin: user.isAdmin
      };
      
      res.json({ 
        success: true, 
        user: {
          id: user.id,
          username: user.username,
          isAdmin: user.isAdmin
        }
      });
    } catch (error) {
      console.error('Login error:', error);
      res.status(500).json({ error: 'Server error' });
    }
  });

  app.get('/api/logout', (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ error: 'Logout failed' });
      }
      res.json({ success: true });
    });
  });

  app.get('/api/me', (req, res) => {
    if (req.session.user) {
      return res.json({ user: req.session.user });
    }
    res.status(401).json({ error: 'Not authenticated' });
  });

  // Tweet endpoints
  app.get('/api/tweets', isAuthenticated, async (req, res) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(process.env.TWEETS_PER_PAGE || '10');
      
      const { tweets, totalTweets, totalPages } = await storage.getTweets(page, limit);
      
      res.json({
        tweets,
        pagination: {
          totalTweets,
          totalPages,
          currentPage: page,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1
        }
      });
    } catch (error) {
      console.error('Error fetching tweets:', error);
      res.status(500).json({ error: 'Server error' });
    }
  });

  // User management endpoints (admin only)
  app.get('/api/users', isAuthenticated, isAdmin, async (req, res) => {
    try {
      const users = await storage.getAllUsers();
      res.json(users);
    } catch (error) {
      console.error('Error fetching users:', error);
      res.status(500).json({ error: 'Server error' });
    }
  });

  app.post('/api/users', isAuthenticated, isAdmin, async (req, res) => {
    try {
      const result = insertUserSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ error: 'Invalid request data' });
      }
      
      const userData = result.data;
      
      // Check if user already exists
      const existingUser = await storage.getUserByUsername(userData.username);
      if (existingUser) {
        return res.status(400).json({ error: 'Username already exists' });
      }
      
      const newUser = await storage.createUser(userData);
      
      res.status(201).json({ 
        success: true, 
        user: {
          id: newUser.id,
          username: newUser.username,
          isAdmin: newUser.isAdmin,
          createdAt: newUser.createdAt
        }
      });
    } catch (error) {
      console.error('Error creating user:', error);
      res.status(500).json({ error: 'Server error' });
    }
  });

  app.delete('/api/users/:id', isAuthenticated, isAdmin, async (req, res) => {
    try {
      const userId = parseInt(req.params.id);
      
      // Prevent deleting current user
      if (req.session.user && req.session.user.id === userId) {
        return res.status(400).json({ error: 'Cannot delete your own account' });
      }
      
      // Check if user exists
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      
      await storage.deleteUser(userId);
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting user:', error);
      res.status(500).json({ error: 'Server error' });
    }
  });

  const httpServer = createServer(app);

  return httpServer;
}
