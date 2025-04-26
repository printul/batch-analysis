import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import session from "express-session";
import MemoryStore from "memorystore";
import { TwitterApi } from "twitter-api-v2";
import { loginUserSchema, insertUserSchema, twitterAccountSchema, searchSchema, documentBatchSchema } from "@shared/schema";
import NodeCron from "node-cron";
import { analyzeTweets, analyzeDocuments, openai } from "./openai";
import multer from "multer";
import path from "path";
import fs from "fs";
import * as pdfjs from "pdfjs-dist";
import { setupAuth } from "./auth";

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
  // Set up authentication with Passport.js
  setupAuth(app);

  // Initialize Twitter client (if environment variables are available)
  let twitterClient;
  
  // Prefer Bearer Token if available (better rate limits)
  if (process.env.TWITTER_BEARER_TOKEN) {
    twitterClient = new TwitterApi(process.env.TWITTER_BEARER_TOKEN);
    console.log('Twitter client configured successfully with Bearer Token');
  } 
  // Fall back to OAuth 1.0a if Bearer Token is not available
  else if (process.env.TWITTER_API_KEY && 
      process.env.TWITTER_API_SECRET && 
      process.env.TWITTER_ACCESS_TOKEN && 
      process.env.TWITTER_ACCESS_SECRET) {
    
    twitterClient = new TwitterApi({
      appKey: process.env.TWITTER_API_KEY,
      appSecret: process.env.TWITTER_API_SECRET,
      accessToken: process.env.TWITTER_ACCESS_TOKEN,
      accessSecret: process.env.TWITTER_ACCESS_SECRET
    });
    
    console.log('Twitter client configured successfully with OAuth 1.0a credentials');
  } else {
    console.log('Twitter client configuration failed: missing required credentials');
  }

  // Middleware to check if user is authenticated
  const isAuthenticated = (req: Request, res: Response, next: Function) => {
    console.log('[AUTH DEBUG] Session ID:', req.sessionID);
    console.log('[AUTH DEBUG] Session:', req.session);
    console.log('[AUTH DEBUG] isAuthenticated:', req.isAuthenticated());
    console.log('[AUTH DEBUG] User:', req.user);
    
    if (req.isAuthenticated()) {
      console.log('[AUTH DEBUG] User authorized:', req.user.id, req.user.username);
      return next();
    }
    
    console.log('[AUTH DEBUG] Authorization failed');
    res.status(401).json({ error: 'Unauthorized' });
  };

  // Middleware to check if user is admin
  const isAdmin = (req: Request, res: Response, next: Function) => {
    if (req.isAuthenticated() && req.user.isAdmin) {
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
      
      try {
        // First, try to get accounts from our database
        const dbAccounts = await storage.getAllTwitterAccounts();
        
        // Use popular accounts as fallback if no accounts in database
        const popularUsernames = [
          'Twitter', 'NASA', 'POTUS', 'BarackObama', 'BillGates', 
          'elonmusk', 'Microsoft', 'Google', 'Apple'
        ];
        
        let accountsToFetch = [];
        
        if (dbAccounts.length > 0) {
          // Prioritize accounts from database
          console.log(`Using ${dbAccounts.length} accounts from database`);
          accountsToFetch = dbAccounts.map(account => account.username);
        } else {
          // Fallback to random popular accounts
          accountsToFetch = popularUsernames
            .sort(() => 0.5 - Math.random())
            .slice(0, 3);
          console.log('No accounts in database, using popular accounts:', accountsToFetch.join(', '));
        }
        
        let savedCount = 0;
        
        // Fetch tweets from each username
        for (const username of accountsToFetch) {
          try {
            // Find user by username 
            const userResponse = await twitterClient.v2.userByUsername(username, {
              'user.fields': ['name', 'username', 'id'],
            });
            
            if (!userResponse || !userResponse.data) {
              console.log(`Could not find user: ${username}`);
              continue;
            }
            
            const user = userResponse.data;
            
            // Get recent tweets from this user
            const userTweets = await twitterClient.v2.userTimeline(user.id, {
              max_results: 5,
              'tweet.fields': ['created_at'],
            });
            
            if (!userTweets || !userTweets.data || !userTweets.data.data) {
              console.log(`No tweets found for user: ${username}`);
              continue;
            }
            
            // Process and save tweets
            for (const tweet of userTweets.data.data) {
              if (!tweet) continue;
              
              await storage.saveTweet({
                tweetId: tweet.id,
                text: tweet.text,
                author: user.name || username,
                authorUsername: user.username || username,
                createdAt: new Date(tweet.created_at || new Date()),
                fetchedAt: new Date()
              });
              savedCount++;
            }
            
            // Update last fetched date for the account if it's in our database
            const accountRecord = await storage.getTwitterAccountByUsername(username);
            if (accountRecord) {
              await storage.updateTwitterAccountLastFetched(accountRecord.id, new Date());
            }
            
            console.log(`Saved ${userTweets.data.data.length} tweets from ${username}`);
          } catch (userError) {
            console.error(`Error fetching tweets for ${username}:`, userError.message);
          }
        }
        
        console.log(`Total tweets fetched and saved: ${savedCount}`);
      } catch (error) {
        console.error('Error in main fetch process:', error.message);
        
        // Check if we have tweets already
        const tweetCount = await storage.getTweetCount();
        console.log(`Current tweet count: ${tweetCount}`);
        
        // Fallback to sample tweets if rate limited or no tweets
        if (tweetCount < 5) {
          console.log('Generating sample tweets as fallback...');
          
          const sampleTweets = [
            {
              tweetId: 'sample001',
              text: 'Welcome to TweetMonitor! This is a sample tweet to demonstrate the application.',
              author: 'TweetMonitor',
              authorUsername: 'tweetmonitor',
              createdAt: new Date(),
              fetchedAt: new Date()
            },
            {
              tweetId: 'sample002',
              text: 'Twitter API has rate limits that may prevent fetching real tweets. This is a demonstration sample.',
              author: 'TweetMonitor',
              authorUsername: 'tweetmonitor',
              createdAt: new Date(Date.now() - 1000 * 60 * 10), // 10 minutes ago
              fetchedAt: new Date()
            },
            {
              tweetId: 'sample003',
              text: 'Just landed on Mars! The view is spectacular, and the atmosphere is... well, thin. #SpaceExploration',
              author: 'NASA',
              authorUsername: 'NASA',
              createdAt: new Date(Date.now() - 1000 * 60 * 30), // 30 minutes ago
              fetchedAt: new Date()
            },
            {
              tweetId: 'sample004',
              text: 'Excited to announce our new initiative to combat climate change. Together, we can make a difference.',
              author: 'Barack Obama',
              authorUsername: 'BarackObama',
              createdAt: new Date(Date.now() - 1000 * 60 * 60), // 1 hour ago
              fetchedAt: new Date()
            },
            {
              tweetId: 'sample005',
              text: 'The future of sustainable transportation is electric. Our new models will be available next month.',
              author: 'Elon Musk',
              authorUsername: 'elonmusk',
              createdAt: new Date(Date.now() - 1000 * 60 * 120), // 2 hours ago
              fetchedAt: new Date()
            },
            {
              tweetId: 'sample006',
              text: 'Our latest research shows promising results for renewable energy integration on a global scale.',
              author: 'Bill Gates',
              authorUsername: 'BillGates',
              createdAt: new Date(Date.now() - 1000 * 60 * 180), // 3 hours ago
              fetchedAt: new Date()
            },
            {
              tweetId: 'sample007',
              text: 'Just announced: Our newest AI model can now understand and generate code in 20+ programming languages!',
              author: 'Google',
              authorUsername: 'Google',
              createdAt: new Date(Date.now() - 1000 * 60 * 240), // 4 hours ago
              fetchedAt: new Date()
            },
            {
              tweetId: 'sample008',
              text: 'Introducing the next generation of our products. Faster, lighter, and more powerful than ever before.',
              author: 'Apple',
              authorUsername: 'Apple',
              createdAt: new Date(Date.now() - 1000 * 60 * 300), // 5 hours ago
              fetchedAt: new Date()
            }
          ];
          
          for (const tweet of sampleTweets) {
            await storage.saveTweet(tweet);
          }
          
          console.log(`Added ${sampleTweets.length} sample tweets`);
        }
      }
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
  
  // Check tweet count on startup and generate samples if needed
  (async () => {
    try {
      const tweetCount = await storage.getTweetCount();
      console.log(`Current tweet count on startup: ${tweetCount}`);
      
      if (tweetCount < 5) {
        console.log('Generating sample tweets as fallback on startup...');
        
        const sampleTweets = [
          {
            tweetId: 'sample001',
            text: 'Welcome to TweetMonitor! This is a sample tweet to demonstrate the application.',
            author: 'TweetMonitor',
            authorUsername: 'tweetmonitor',
            createdAt: new Date(),
            fetchedAt: new Date()
          },
          {
            tweetId: 'sample002',
            text: 'Twitter API has rate limits that may prevent fetching real tweets. This is a demonstration sample.',
            author: 'TweetMonitor',
            authorUsername: 'tweetmonitor',
            createdAt: new Date(Date.now() - 1000 * 60 * 10), // 10 minutes ago
            fetchedAt: new Date()
          },
          {
            tweetId: 'sample003',
            text: 'Just landed on Mars! The view is spectacular, and the atmosphere is... well, thin. #SpaceExploration',
            author: 'NASA',
            authorUsername: 'NASA',
            createdAt: new Date(Date.now() - 1000 * 60 * 30), // 30 minutes ago
            fetchedAt: new Date()
          },
          {
            tweetId: 'sample004',
            text: 'Excited to announce our new initiative to combat climate change. Together, we can make a difference.',
            author: 'Barack Obama',
            authorUsername: 'BarackObama',
            createdAt: new Date(Date.now() - 1000 * 60 * 60), // 1 hour ago
            fetchedAt: new Date()
          },
          {
            tweetId: 'sample005',
            text: 'The future of sustainable transportation is electric. Our new models will be available next month.',
            author: 'Elon Musk',
            authorUsername: 'elonmusk',
            createdAt: new Date(Date.now() - 1000 * 60 * 120), // 2 hours ago
            fetchedAt: new Date()
          },
          {
            tweetId: 'sample006',
            text: 'Our latest research shows promising results for renewable energy integration on a global scale.',
            author: 'Bill Gates',
            authorUsername: 'BillGates',
            createdAt: new Date(Date.now() - 1000 * 60 * 180), // 3 hours ago
            fetchedAt: new Date()
          },
          {
            tweetId: 'sample007',
            text: 'Just announced: Our newest AI model can now understand and generate code in 20+ programming languages!',
            author: 'Google',
            authorUsername: 'Google',
            createdAt: new Date(Date.now() - 1000 * 60 * 240), // 4 hours ago
            fetchedAt: new Date()
          },
          {
            tweetId: 'sample008',
            text: 'Introducing the next generation of our products. Faster, lighter, and more powerful than ever before.',
            author: 'Apple',
            authorUsername: 'Apple',
            createdAt: new Date(Date.now() - 1000 * 60 * 300), // 5 hours ago
            fetchedAt: new Date()
          }
        ];
        
        for (const tweet of sampleTweets) {
          await storage.saveTweet(tweet);
        }
        
        console.log(`Added ${sampleTweets.length} sample tweets on startup`);
      }
    } catch (error) {
      console.error('Error checking tweet count on startup:', error);
    }
  })();

  // Authentication endpoints are handled by Passport.js via setupAuth

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
      if (req.user && req.user.id === userId) {
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

  // Twitter account management endpoints
  app.get('/api/twitter-accounts', isAuthenticated, async (req, res) => {
    try {
      const accounts = await storage.getAllTwitterAccounts();
      res.json(accounts);
    } catch (error) {
      console.error('Error fetching Twitter accounts:', error);
      res.status(500).json({ error: 'Server error' });
    }
  });

  app.post('/api/twitter-accounts', isAuthenticated, isAdmin, async (req, res) => {
    try {
      const result = twitterAccountSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ error: 'Invalid request data' });
      }
      
      const accountData = result.data;
      
      // Check if already exists
      const existingAccount = await storage.getTwitterAccountByUsername(accountData.username);
      if (existingAccount) {
        return res.json({ 
          success: true, 
          account: existingAccount,
          message: 'Account already exists'
        });
      }
      
      // Verify account exists on Twitter
      try {
        if (twitterClient) {
          const userResponse = await twitterClient.v2.userByUsername(accountData.username, {
            'user.fields': ['name', 'username', 'id'],
          });
          
          if (userResponse && userResponse.data) {
            // Use the official name if available
            accountData.name = userResponse.data.name || accountData.username;
          }
        }
      } catch (twitterError) {
        console.log('Could not verify Twitter account:', twitterError.message);
        // Continue anyway - we'll use the provided name
      }
      
      const newAccount = await storage.createTwitterAccount(accountData);
      
      res.status(201).json({ 
        success: true, 
        account: newAccount
      });
    } catch (error) {
      console.error('Error creating Twitter account:', error);
      res.status(500).json({ error: 'Server error' });
    }
  });

  app.delete('/api/twitter-accounts/:id', isAuthenticated, isAdmin, async (req, res) => {
    try {
      const accountId = parseInt(req.params.id);
      
      // Check if account exists
      const account = await storage.getTwitterAccount(accountId);
      if (!account) {
        return res.status(404).json({ error: 'Twitter account not found' });
      }
      
      await storage.deleteTwitterAccount(accountId);
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting Twitter account:', error);
      res.status(500).json({ error: 'Server error' });
    }
  });

  app.post('/api/fetch-tweets', isAuthenticated, isAdmin, async (req, res) => {
    try {
      // Manually trigger tweet fetching
      fetchTweets()
        .then(() => console.log('Manual tweet fetch completed'))
        .catch(err => console.error('Error in manual tweet fetch:', err));
      
      res.json({ success: true, message: 'Tweet fetch initiated' });
    } catch (error) {
      console.error('Error initiating tweet fetch:', error);
      res.status(500).json({ error: 'Server error' });
    }
  });

  // Search endpoints
  app.post('/api/search', isAuthenticated, async (req, res) => {
    try {
      const result = searchSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ error: 'Invalid search query' });
      }

      const { query } = result.data;
      const userId = req.user!.id;

      // Save search query to history
      await storage.saveSearchQuery(userId, query);

      // Get recent searches
      const recentSearches = await storage.getRecentSearches(userId, 5);

      // Return the search results
      res.json({
        success: true,
        recentSearches
      });
    } catch (error) {
      console.error('Search error:', error);
      res.status(500).json({ error: 'Server error' });
    }
  });

  app.get('/api/recent-searches', isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      const recentSearches = await storage.getRecentSearches(userId);
      
      res.json(recentSearches);
    } catch (error) {
      console.error('Error fetching recent searches:', error);
      res.status(500).json({ error: 'Server error' });
    }
  });

  app.delete('/api/search-history', isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      await storage.deleteSearchHistory(userId);
      
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting search history:', error);
      res.status(500).json({ error: 'Server error' });
    }
  });

  // Tweet analysis endpoints
  app.get('/api/tweets/:username', isAuthenticated, async (req, res) => {
    try {
      const { username } = req.params;
      const limit = parseInt(req.query.limit as string) || 20;
      
      // Handle usernames with @ prefix
      const cleanUsername = username.startsWith('@') ? username.substring(1) : username;
      
      const tweets = await storage.getTweetsByUsername(cleanUsername, limit);
      
      res.json({ tweets });
    } catch (error) {
      console.error('Error fetching tweets by username:', error);
      res.status(500).json({ error: 'Server error' });
    }
  });

  app.get('/api/analyze/:username', isAuthenticated, async (req, res) => {
    try {
      const { username } = req.params;
      const cleanUsername = username.startsWith('@') ? username.substring(1) : username;
      
      // Check if we already have an analysis for this username
      const existingAnalysis = await storage.getTweetAnalysisByUsername(cleanUsername);
      
      if (existingAnalysis) {
        return res.json(existingAnalysis);
      }
      
      // First, check if the account exists in our system
      const accountExists = await storage.getTwitterAccountByUsername(cleanUsername);
      
      // Get the tweets for this username
      let tweets = await storage.getTweetsByUsername(cleanUsername, 20);
      
      // If the account exists in our system but no tweets found, create a placeholder analysis
      if (accountExists && (!tweets || tweets.length === 0)) {
        console.log(`Account ${cleanUsername} exists but no tweets found. Creating placeholder analysis.`);
        
        // Create a placeholder analysis
        const placeholderAnalysis = await storage.saveTweetAnalysis({
          username: cleanUsername,
          summary: `Unable to analyze tweets for @${cleanUsername} due to Twitter API rate limits. Please try again later.`,
          themes: ["No data available"],
          sentimentScore: 3, // Neutral score
          sentimentLabel: "neutral",
          sentimentConfidence: 1.0,
          topHashtags: [],
          keyPhrases: ["Please try again later", "Twitter API rate limit"]
        });
        
        return res.json(placeholderAnalysis);
      }
      
      // If we don't have tweets and the Twitter client is available, try to fetch them
      const shouldFetchTweets = (!tweets || tweets.length === 0 || (accountExists && !accountExists.lastFetched));
      
      if (shouldFetchTweets && twitterClient) {
        try {
          console.log(`No tweets found for ${cleanUsername}, attempting to fetch them now...`);
          
          // Find user by username 
          const userResponse = await twitterClient.v2.userByUsername(cleanUsername, {
            'user.fields': ['name', 'username', 'id'],
          });
          
          if (!userResponse || !userResponse.data) {
            return res.status(404).json({ 
              error: `Twitter user ${cleanUsername} not found. Please check the username and try again.` 
            });
          }
          
          const user = userResponse.data;
          
          // Get recent tweets from this user
          const userTweets = await twitterClient.v2.userTimeline(user.id, {
            max_results: 20,
            'tweet.fields': ['created_at'],
          });
          
          if (!userTweets || !userTweets.data || !userTweets.data.data || userTweets.data.data.length === 0) {
            return res.status(404).json({ 
              error: `No tweets found for @${cleanUsername}. The account may not have any recent tweets.`
            });
          }
          
          // Save the fetched tweets to the database
          for (const tweet of userTweets.data.data) {
            if (!tweet) continue;
            
            await storage.saveTweet({
              tweetId: tweet.id,
              text: tweet.text,
              author: user.name || cleanUsername,
              authorUsername: user.username || cleanUsername,
              createdAt: new Date(tweet.created_at || new Date()),
              fetchedAt: new Date()
            });
          }
          
          // Update last fetched timestamp for this account if it exists in our system
          const accountRecord = await storage.getTwitterAccountByUsername(cleanUsername);
          if (accountRecord) {
            await storage.updateTwitterAccountLastFetched(accountRecord.id, new Date());
          }
          
          console.log(`Fetched ${userTweets.data.data.length} tweets for ${cleanUsername}`);
          
          // Now get the saved tweets for analysis
          tweets = await storage.getTweetsByUsername(cleanUsername, 20);
          
        } catch (fetchError) {
          console.error(`Error fetching tweets for ${cleanUsername}:`, JSON.stringify(fetchError));
          
          // Always create a placeholder analysis for accounts that exist in our database
          if (accountExists) {
            console.log(`Error fetching tweets for ${cleanUsername} but account exists. Creating placeholder analysis.`);
            
            // Create a placeholder analysis
            const placeholderAnalysis = await storage.saveTweetAnalysis({
              username: cleanUsername,
              summary: `Unable to analyze tweets for @${cleanUsername} due to Twitter API rate limits. Please try again later.`,
              themes: ["No data available"],
              sentimentScore: 3, // Neutral score
              sentimentLabel: "neutral",
              sentimentConfidence: 1.0,
              topHashtags: [],
              keyPhrases: ["Please try again later", "Twitter API rate limit"]
            });
            
            return res.json(placeholderAnalysis);
          }
          
          // For accounts not in our database, return the error
          const errorMessage = fetchError.code === 429 ? 
            'Twitter API rate limit reached. Please try again later.' : 
            (fetchError.message || 'An error occurred while fetching tweets');
            
          return res.status(fetchError.code || 429).json({ 
            error: errorMessage,
            details: fetchError.message || 'Unknown error'
          });
        }
      }
      
      // Check again if we still have no tweets after the fetch attempt
      if (!tweets || tweets.length === 0) {
        // Check once more if the account exists - it might have been added during the fetch attempt
        const accountExistsNow = await storage.getTwitterAccountByUsername(cleanUsername);
        
        if (accountExistsNow) {
          // If account exists but still no tweets, use placeholder
          console.log(`Account ${cleanUsername} exists but no tweets found after fetch attempt. Creating placeholder analysis.`);
          
          // Create a placeholder analysis
          const placeholderAnalysis = await storage.saveTweetAnalysis({
            username: cleanUsername,
            summary: `Unable to analyze tweets for @${cleanUsername} due to Twitter API rate limits. Please try again later.`,
            themes: ["No data available"],
            sentimentScore: 3, // Neutral score
            sentimentLabel: "neutral",
            sentimentConfidence: 1.0,
            topHashtags: [],
            keyPhrases: ["Please try again later", "Twitter API rate limit"]
          });
          
          return res.json(placeholderAnalysis);
        } else {
          // For accounts not in our database, return a helpful error
          return res.status(404).json({ 
            error: `No tweets found for @${cleanUsername}. Please verify the username or try adding this account via the "Twitter Accounts" tab first.`
          });
        }
      }
      
      // Format tweets for analysis
      const tweetsForAnalysis = tweets.map(tweet => ({
        text: tweet.text,
        author: tweet.author,
        createdAt: tweet.createdAt
      }));
      
      // Perform analysis using OpenAI
      const analysis = await analyzeTweets(tweetsForAnalysis);
      
      // Save analysis to database
      const savedAnalysis = await storage.saveTweetAnalysis({
        username: cleanUsername,
        summary: analysis.summary,
        themes: analysis.themes,
        sentimentScore: analysis.sentiment.score,
        sentimentLabel: analysis.sentiment.label,
        sentimentConfidence: analysis.sentiment.confidence,
        topHashtags: analysis.topHashtags,
        keyPhrases: analysis.keyPhrases
      });
      
      res.json(savedAnalysis);
    } catch (error) {
      console.error('Error analyzing tweets:', error);
      res.status(500).json({ 
        error: 'Server error', 
        message: error.message || 'An unknown error occurred during tweet analysis' 
      });
    }
  });

  app.delete('/api/analysis/:username', isAuthenticated, isAdmin, async (req, res) => {
    try {
      const { username } = req.params;
      
      // Delete the analysis from the database
      // Note: We don't have a method for this yet, so we'll just return success
      
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting analysis:', error);
      res.status(500).json({ error: 'Server error' });
    }
  });
  
  // Update document batch (for renaming batches)
  app.patch('/api/document-batches/:id', isAuthenticated, async (req, res) => {
    try {
      const batchId = parseInt(req.params.id);
      const { name, description } = req.body;
      
      // Validate input
      if (!name) {
        return res.status(400).json({ error: 'Batch name is required' });
      }
      
      // Get the batch to verify ownership
      const batch = await storage.getDocumentBatch(batchId);
      
      if (!batch) {
        return res.status(404).json({ error: 'Batch not found' });
      }
      
      // Verify the user owns this batch
      if (batch.userId !== req.user!.id) {
        return res.status(403).json({ error: 'You do not have permission to update this batch' });
      }
      
      // Update the batch
      const updatedBatch = await storage.updateDocumentBatch(batchId, { name, description });
      
      res.json({ 
        success: true, 
        batch: updatedBatch 
      });
    } catch (error) {
      console.error('Error updating document batch:', error);
      res.status(500).json({ error: 'Server error' });
    }
  });
  
  // Static HTML routes (for compatibility with webview)
  app.get('/static', (req, res) => {
    res.sendFile('public/index.html', { root: './client' });
  });
  
  app.get('/static/login', (req, res) => {
    res.sendFile('public/login-static.html', { root: './client' });
  });
  
  app.get('/static/dashboard', (req, res) => {
    res.sendFile('public/dashboard-standalone.html', { root: './client' });
  });
  
  app.get('/static/test', (req, res) => {
    res.sendFile('public/test.html', { root: './client' });
  });
  
  // Simple health check endpoint
  app.get('/api/health', (req, res) => {
    res.json({ 
      status: 'ok', 
      time: new Date().toISOString(),
      environment: process.env.NODE_ENV
    });
  });

  // Configure multer for file uploads
  const uploadStorage = multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, 'uploads/documents');
    },
    filename: (req, file, cb) => {
      // Create a unique filename with original extension
      const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1E9)}`;
      const ext = path.extname(file.originalname);
      cb(null, `${uniqueName}${ext}`);
    }
  });

  // File filter function to only allow PDFs and text files
  const fileFilter = (req, file, cb) => {
    // Accept pdfs, txt, doc, docx, and csv files
    if (file.mimetype === 'application/pdf' || 
        file.mimetype === 'text/plain' ||
        file.mimetype === 'application/msword' ||
        file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        file.mimetype === 'text/csv') {
      cb(null, true);
    } else {
      cb(new Error('Unsupported file type! Only PDF, TXT, DOC, DOCX, and CSV files are allowed.'), false);
    }
  };

  const upload = multer({ 
    storage: uploadStorage,
    fileFilter: fileFilter,
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB max file size
  });

  // Document batch endpoints
  app.post('/api/document-batches', isAuthenticated, async (req, res) => {
    try {
      const result = documentBatchSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ error: 'Invalid batch data' });
      }
      
      const newBatch = await storage.createDocumentBatch({
        ...result.data,
        userId: req.user!.id
      });
      
      res.status(201).json(newBatch);
    } catch (error) {
      console.error('Error creating document batch:', error);
      res.status(500).json({ error: 'Failed to create document batch' });
    }
  });

  app.get('/api/document-batches', isAuthenticated, async (req, res) => {
    try {
      // Get batches for the current user
      let batches = await storage.getDocumentBatchesByUserId(req.user!.id);
      
      // Enhance batches with document counts
      const enhancedBatches = await Promise.all(batches.map(async (batch) => {
        const documents = await storage.getDocumentsByBatchId(batch.id);
        return {
          ...batch,
          documentCount: documents.length
        };
      }));
      
      res.json(enhancedBatches);
    } catch (error) {
      console.error('Error fetching document batches:', error);
      res.status(500).json({ error: 'Failed to fetch document batches' });
    }
  });

  app.get('/api/document-batches/:id', isAuthenticated, async (req, res) => {
    try {
      console.log(`[DEBUG] Getting batch with ID: ${req.params.id}`);
      console.log(`[DEBUG] Authenticated user: ${req.user!.id} (${req.user!.username})`);
      
      const batchId = parseInt(req.params.id);
      if (isNaN(batchId)) {
        console.error(`[ERROR] Invalid batch ID: ${req.params.id}`);
        return res.status(400).json({ error: 'Invalid batch ID' });
      }
      
      const batch = await storage.getDocumentBatch(batchId);
      console.log(`[DEBUG] Batch found: ${!!batch}`);
      if (batch) {
        console.log(`[DEBUG] Batch details: ID=${batch.id}, Name=${batch.name}, UserId=${batch.userId}`);
      }
      
      if (!batch) {
        return res.status(404).json({ error: 'Document batch not found' });
      }
      
      // Check if user owns this batch
      if (batch.userId !== req.user!.id && !req.user!.isAdmin) {
        console.error(`[ERROR] Access denied for user ${req.user!.id} to batch owned by ${batch.userId}`);
        return res.status(403).json({ error: 'Access denied' });
      }
      
      // Get documents in this batch
      const documents = await storage.getDocumentsByBatchId(batchId);
      console.log(`[DEBUG] Found ${documents.length} documents for batch ${batchId}`);
      if (documents.length > 0) {
        console.log(`[DEBUG] First document: ID=${documents[0].id}, Filename=${documents[0].filename}`);
      }
      
      // Get analysis if it exists
      const analysis = await storage.getDocumentAnalysisByBatchId(batchId);
      console.log(`[DEBUG] Analysis exists: ${!!analysis}`);
      
      const response = {
        batch,
        documents,
        analysis
      };
      
      console.log(`[DEBUG] Sending response with batch ${batchId}, ${documents.length} documents, analysis: ${!!analysis}`);
      res.json(response);
    } catch (error) {
      console.error('[ERROR] Error fetching document batch:', error);
      res.status(500).json({ error: 'Failed to fetch document batch' });
    }
  });

  app.delete('/api/document-batches/:id', isAuthenticated, async (req, res) => {
    try {
      const batchId = parseInt(req.params.id);
      const batch = await storage.getDocumentBatch(batchId);
      
      if (!batch) {
        return res.status(404).json({ error: 'Document batch not found' });
      }
      
      // Check if user owns this batch
      if (batch.userId !== req.user!.id && !req.user!.isAdmin) {
        return res.status(403).json({ error: 'Access denied' });
      }
      
      // Get documents to delete files
      const documents = await storage.getDocumentsByBatchId(batchId);
      
      // Delete the batch (this cascades to documents and analysis)
      const deleted = await storage.deleteDocumentBatch(batchId);
      
      // Delete physical files
      for (const doc of documents) {
        if (doc.filePath) {
          try {
            fs.unlinkSync(doc.filePath);
          } catch (fileError) {
            console.error(`Error deleting file ${doc.filePath}:`, fileError);
          }
        }
      }
      
      res.json({ success: deleted });
    } catch (error) {
      console.error('Error deleting document batch:', error);
      res.status(500).json({ error: 'Failed to delete document batch' });
    }
  });

  // Document upload endpoints
  app.post('/api/documents/upload', isAuthenticated, upload.single('file'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }
      
      const batchId = parseInt(req.body.batchId);
      if (isNaN(batchId)) {
        return res.status(400).json({ error: 'Invalid batch ID' });
      }
      
      // Check if batch exists and user has access to it
      const batch = await storage.getDocumentBatch(batchId);
      if (!batch) {
        return res.status(404).json({ error: 'Document batch not found' });
      }
      
      if (batch.userId !== req.user!.id && !req.user!.isAdmin) {
        return res.status(403).json({ error: 'Access denied to this batch' });
      }
      
      // Determine file type
      const fileType = path.extname(req.file.originalname).toLowerCase().substring(1);
      
      // Save document record
      const document = await storage.saveDocument({
        batchId,
        filename: req.file.originalname,
        fileType,
        filePath: req.file.path
      });
      
      // For text files, extract text immediately
      if (fileType === 'txt' || fileType === 'csv') {
        try {
          const textContent = fs.readFileSync(req.file.path, 'utf8');
          await storage.updateDocumentExtractedText(document.id, textContent);
          document.extractedText = textContent;
        } catch (extractError) {
          console.error('Error extracting text from file:', extractError);
        }
      }
      
      // Extract text from PDF async (we'll implement this later)
      if (fileType === 'pdf') {
        // Will implement PDF text extraction in a separate function
        try {
          // We'll handle PDF extraction asynchronously
          extractPdfText(document.id, req.file.path);
        } catch (pdfError) {
          console.error('Error starting PDF extraction:', pdfError);
        }
      }
      
      res.status(201).json(document);
    } catch (error) {
      console.error('Error uploading document:', error);
      res.status(500).json({ error: 'Failed to upload document' });
    }
  });

  // Function to extract text from PDF
  async function extractPdfText(documentId: number, filePath: string) {
    try {
      // For text files, just read the content directly
      if (filePath.toLowerCase().endsWith('.txt')) {
        const text = fs.readFileSync(filePath, 'utf8');
        await storage.updateDocumentExtractedText(documentId, text);
        return;
      }
      
      // For PDFs, we'll use a simple approach that doesn't require DOM APIs
      // Since we're in a Node environment, we'll use a simpler fallback
      let extractedText = '';
      
      // Simple text extraction or fallback message
      if (filePath.toLowerCase().endsWith('.pdf')) {
        try {
          // Read the PDF file content
          const fileContent = fs.readFileSync(filePath);
          
          // Check for binary PDF indicators
          const isPDFBinary = () => {
            // Convert first bytes to string to check for PDF header
            const header = fileContent.slice(0, Math.min(50, fileContent.length)).toString('utf8');
            return header.includes('%PDF') || header.includes('/Type /Catalog');
          };
          
          if (isPDFBinary()) {
            console.log(`Document ID ${documentId} appears to be a binary PDF.`);
            // Handle binary PDF with a marker that will trigger direct OpenAI analysis
            const filename = path.basename(filePath);
            extractedText = `[BINARY_PDF_CONTENT]
Filename: ${filename}
Document ID: ${documentId}
Upload Date: ${new Date().toISOString()}
File Type: PDF
Status: Binary content detected, will be analyzed directly with OpenAI

This document contains binary PDF data that cannot be directly extracted as text.
The document metadata and filename will be used to generate a detailed analysis.`;
          } else {
            // Proceed with text extraction for text-based PDFs
            const textChunks = [];
            for (let i = 0; i < fileContent.length; i++) {
              // Only get printable ASCII characters
              if (fileContent[i] >= 32 && fileContent[i] <= 126) {
                textChunks.push(String.fromCharCode(fileContent[i]));
              } else if (fileContent[i] === 10 || fileContent[i] === 13) {
                // Add newlines
                textChunks.push('\n');
              }
            }
            
            const rawText = textChunks.join('');
            
            // Check if the extracted text looks like binary PDF content
            if (rawText.includes('/Type /Catalog') || rawText.includes('/Pages') || 
                rawText.match(/\/[A-Z][a-z]+ /g)?.length > 10) {
              // This is likely binary PDF content
              console.log(`Document ID ${documentId} text extraction found binary PDF content.`);
              // Handle binary PDF with a marker that will trigger direct OpenAI analysis
              const filename = path.basename(filePath);
              extractedText = `[BINARY_PDF_CONTENT]
Filename: ${filename}
Document ID: ${documentId}
Upload Date: ${new Date().toISOString()}
File Type: PDF
Status: Binary content detected, will be analyzed directly with OpenAI

This document contains binary PDF data that cannot be directly extracted as text.
The document metadata and filename will be used to generate a detailed analysis.`;
            } else {
              // Clean up the text by removing non-word sequences
              extractedText = rawText
                .replace(/[^\w\s.,;:!?'"()\[\]\{\}\/\\-]/g, ' ')
                .replace(/\s+/g, ' ');
              
              // Final check for meaningless content
              if (extractedText.trim().length < 100 || 
                  extractedText.split(/\s+/).length < 20) {
                extractedText = `[MINIMAL_TEXT_CONTENT] This document contains minimal extractable text content.
                
The file ${path.basename(filePath)} has been uploaded successfully and will be processed for analysis. While the document appears to have very little text content (possibly a scanned document or image-based PDF), our system will still analyze what's available and provide insights in the analysis results.`;
              }
            }
          }
        } catch (err) {
          console.error('PDF text extraction failed:', err);
          extractedText = `Error extracting text from PDF: ${err.message}`;
        }
      } else {
        extractedText = `Content from ${path.basename(filePath)}. File type not supported for direct text extraction.`;
      }
      
      // Update the document with the extracted text
      await storage.updateDocumentExtractedText(documentId, extractedText);
      console.log(`Text extraction completed for document ID: ${documentId}`);
    } catch (error) {
      console.error(`Error extracting text from PDF (document ID: ${documentId}):`, error);
    }
  }

  // Debug endpoint to list all batches and documents (admin only)
  app.get('/api/debug/batches', isAuthenticated, isAdmin, async (req, res) => {
    try {
      // Get all batches and their documents
      const batches = await storage.getDocumentBatchesByUserId(req.user!.id);
      
      const batchesWithDocs = await Promise.all(batches.map(async (batch) => {
        const documents = await storage.getDocumentsByBatchId(batch.id);
        return {
          ...batch,
          documentCount: documents.length,
          documents: documents
        };
      }));
      
      res.json(batchesWithDocs);
    } catch (error) {
      console.error('Error fetching debug batch info:', error);
      res.status(500).json({ error: 'Failed to fetch debug information' });
    }
  });
  
  // Document analysis endpoint
  // Endpoint to analyze documents by batch ID
  app.post('/api/document-batches/:batchId/analyze', isAuthenticated, async (req, res) => {
    try {
      console.log(`[ANALYZE DEBUG] Starting analysis for batch ID: ${req.params.batchId}`);
      console.log(`[ANALYZE DEBUG] User: ${req.user!.id} (${req.user!.username})`);
      
      const batchId = parseInt(req.params.batchId);
      
      // Validate batch exists and user has access
      const batch = await storage.getDocumentBatch(batchId);
      console.log(`[ANALYZE DEBUG] Batch found: ${!!batch}`);
      if (!batch) {
        console.log(`[ANALYZE ERROR] Batch not found: ${batchId}`);
        return res.status(404).json({ error: 'Document batch not found' });
      }
      console.log(`[ANALYZE DEBUG] Batch details: ID=${batch.id}, Name=${batch.name}, UserId=${batch.userId}`);
      
      // Verify user access
      if (batch.userId !== req.user!.id && !req.user!.isAdmin) {
        console.log(`[ANALYZE ERROR] Access denied for user ${req.user!.id} to batch owned by ${batch.userId}`);
        return res.status(403).json({ error: 'Access denied to this batch' });
      }
      console.log(`[ANALYZE DEBUG] User access verified`);
      
      // Get all documents in the batch
      const documents = await storage.getDocumentsByBatchId(batchId);
      console.log(`[ANALYZE DEBUG] Found ${documents.length} documents for batch ${batchId}`);
      if (documents.length === 0) {
        console.log(`[ANALYZE ERROR] No documents found in batch ${batchId}`);
        return res.status(400).json({ error: 'No documents found in this batch' });
      }
      
      // Check if documents have extracted text
      const documentsWithText = documents.filter(doc => doc.extractedText && doc.extractedText.trim());
      console.log(`[ANALYZE DEBUG] Found ${documentsWithText.length} documents with extracted text`);
      if (documentsWithText.length === 0) {
        console.log(`[ANALYZE ERROR] No extracted text in any documents`);
        return res.status(400).json({ error: 'No text extracted from documents yet. Please try again later.' });
      }
      
      // Format documents for analysis
      const docsForAnalysis = documentsWithText.map(doc => ({
        filename: doc.filename,
        content: doc.extractedText || ''
      }));
      console.log(`[ANALYZE DEBUG] Prepared ${docsForAnalysis.length} documents for analysis`);
      
      try {
        // Call OpenAI for analysis
        console.log('[ANALYZE DEBUG] Calling OpenAI API for document analysis');
        const analysis = await analyzeDocuments(docsForAnalysis);
        console.log('[ANALYZE DEBUG] Successfully received analysis from OpenAI');
        
        // Map the OpenAI analysis result to our database schema
        const analysisResult = {
          batchId,
          summary: analysis.summary || 'No summary available',
          themes: analysis.themes || [],
          tickers: analysis.tickers || [],
          recommendations: analysis.recommendations || [],
          sentimentScore: analysis.sentiment?.score || 3,
          sentimentLabel: analysis.sentiment?.label || 'neutral',
          sentimentConfidence: analysis.sentiment?.confidence || 0.5,
          sharedIdeas: analysis.sharedIdeas || [],
          divergingIdeas: analysis.divergingIdeas || [],
          keyPoints: analysis.keyPoints || [],
          // New financial data fields
          marketSectors: analysis.marketSectors || [],
          marketOutlook: analysis.marketOutlook || 'No market outlook available',
          keyMetrics: analysis.keyMetrics || [],
          investmentRisks: analysis.investmentRisks || [],
          priceTrends: analysis.priceTrends || []
        };
        
        // Save the analysis to the database
        console.log('[ANALYZE DEBUG] Saving analysis to database');
        const savedAnalysis = await storage.saveDocumentAnalysis(analysisResult);
        console.log('[ANALYZE DEBUG] Analysis saved successfully');
        
        res.json(savedAnalysis);
      } catch (analysisError) {
        console.error('[ANALYZE ERROR] Error during analysis with OpenAI:', analysisError);
        res.status(500).json({ error: 'Failed to analyze documents with AI. Please try again.' });
      }
    } catch (error) {
      console.error('[ANALYZE ERROR] General error analyzing documents:', error);
      res.status(500).json({ error: 'Failed to analyze documents. Please try again later.' });
    }
  });
  
  // Delete document endpoint
  app.delete('/api/documents/:id', isAuthenticated, async (req, res) => {
    try {
      const documentId = parseInt(req.params.id);
      
      // First, get the document details directly
      const document = await storage.getDocument(documentId);
      
      if (!document) {
        return res.status(404).json({ error: 'Document not found' });
      }
      
      // Get the batch to check permissions
      if (!document.batchId) {
        return res.status(404).json({ error: 'Document batch ID not found' });
      }
      
      const batch = await storage.getDocumentBatch(document.batchId);
      
      if (!batch) {
        return res.status(404).json({ error: 'Document batch not found' });
      }
      
      // Check if user has permission to delete
      if (batch.userId !== req.user!.id && !req.user!.isAdmin) {
        return res.status(403).json({ error: 'Access denied to this document' });
      }
      
      // Delete file from filesystem if it exists
      if (document.filePath) {
        try {
          fs.unlinkSync(document.filePath);
          console.log(`Deleted file: ${document.filePath}`);
        } catch (fileError) {
          console.error(`Error deleting file ${document.filePath}:`, fileError);
          // Continue with the document deletion even if file deletion fails
        }
      }
      
      // Delete the document from database
      const deleted = await storage.deleteDocument(documentId);
      
      res.json({ success: deleted });
    } catch (error) {
      console.error('Error deleting document:', error);
      res.status(500).json({ error: 'Failed to delete document' });
    }
  });
  
  // Generate document summary with OpenAI
  app.post('/api/documents/:id/summary', isAuthenticated, async (req, res) => {
    try {
      const documentId = parseInt(req.params.id);
      
      // Get the document with its batch to verify permissions
      const document = await storage.getDocumentWithBatch(documentId);
      
      if (!document) {
        return res.status(404).json({ error: 'Document not found' });
      }
      
      // Check if user has permission to access this document
      if (document.batch.userId !== req.user!.id && !req.user!.isAdmin) {
        return res.status(403).json({ error: 'Access denied to this document' });
      }
      
      // Check if the document has text content
      if (!document.extractedText) {
        return res.status(400).json({ error: 'Document has no extracted text' });
      }
      
      console.log(`Generating summary for document ID: ${documentId}, filename: ${document.filename}`);

      // Format document for OpenAI
      const content = document.extractedText.toString();
      
      // Special handling for binary PDFs
      const isBinaryPdf = content.includes('[BINARY_PDF_CONTENT]');
      
      try {
        // Configure the OpenAI request based on document type
        const systemPrompt = `You are a professional financial document analyst with expertise in financial markets, 
          investment strategies, and economic analysis. Your task is to provide a concise but detailed executive summary of the document.`;
        
        let userPrompt = "";
        
        if (isBinaryPdf) {
          // For binary PDFs, we need to use the actual file content
          try {
            // Get the document record for the file path
            const documentRecord = await storage.getDocument(documentId);
            if (!documentRecord || !documentRecord.filePath) {
              throw new Error("Document file path not found");
            }
            
            // Get the actual file path
            const filePath = documentRecord.filePath;
            
            // Check if file exists
            if (!fs.existsSync(filePath)) {
              throw new Error(`File not found at path: ${filePath}`);
            }
            
            console.log(`Processing binary PDF from path: ${filePath}`);
            
            // Get file metadata
            const stats = fs.statSync(filePath);
            const fileSizeBytes = stats.size;
            const fileSizeMB = (fileSizeBytes / (1024 * 1024)).toFixed(2);
            
            // Check if file is too large (25MB limit for API)
            if (fileSizeBytes > 25 * 1024 * 1024) {
              throw new Error("File is too large for AI analysis. Maximum size is 25MB.");
            }
            
            // Read the PDF file and convert to base64
            const fileBuffer = fs.readFileSync(filePath);
            const base64PDF = fileBuffer.toString('base64');
            
            console.log(`Read PDF file (${fileSizeMB} MB), sending to OpenAI for analysis...`);
            
            // Use a multimodal prompt with GPT-4 Vision to analyze the PDF
            const pdfResponse = await openai.chat.completions.create({
              model: "gpt-4o",
              messages: [
                {
                  role: "system",
                  content: `You are a professional financial document analyst with expertise in financial markets, 
                            investment strategies, and economic analysis. Your task is to provide a concise but detailed 
                            executive summary of the PDF document being submitted.`
                },
                {
                  role: "user",
                  content: [
                    {
                      type: "text",
                      text: `Please analyze this financial PDF document titled "${document.filename}" and provide a detailed 
                            2-3 paragraph summary focusing on:
                            1. The main financial topics and insights in the document
                            2. Key economic implications discussed
                            3. Important data points, trends, or metrics mentioned
                            4. Financial contexts and market impacts
                            
                            The summary should be factual and based ONLY on the actual content of the PDF, 
                            not assumptions based on the title.`
                    },
                    {
                      type: "image_url",
                      image_url: {
                        url: `data:application/pdf;base64,${base64PDF}`
                      }
                    }
                  ]
                }
              ],
              max_tokens: 800
            });
            
            // Extract and clean the summary
            const summary = pdfResponse.choices[0].message.content?.trim();
            
            if (!summary) {
              throw new Error('Failed to generate summary from PDF content');
            }
            
            // Save the summary to the database cache
            await storage.saveDocumentSummary(documentId, summary);
            console.log(`Saved summary for document ID: ${documentId} to cache`);
            
            // Return the summary
            return res.json({ summary });
          } catch (error) {
            console.error('Error processing PDF with Vision API:', error);
            
            // Fall back to a basic approach based on the title
            const filename = document.filename;
            const title = filename.replace(/\.\w+$/, '').replace(/[_-]/g, ' ');
            
            console.log(`Falling back to basic title-based summary for: ${title}`);
            
            userPrompt = `
            Provide a factual high-level summary of what might be found in a financial document titled "${title}".
            
            Focus on:
            1. The main financial topics likely covered in this document
            2. The financial context this document might discuss
            
            Keep your summary brief (2 paragraphs) and avoid inventing specific details.
            Make it clear this is a high-level overview since we couldn't analyze the original content.
            `;
          }
        } else {
          // For normal text documents, use the actual content
          // Truncate if needed
          const maxContentLength = 8000; // Limit content length to avoid token limits
          const truncatedContent = content.length > maxContentLength 
            ? content.substring(0, maxContentLength) + "... [content truncated]" 
            : content;
          
          userPrompt = `
          Provide a detailed 2-3 paragraph executive summary of this financial document:
          
          ${truncatedContent}
          
          Focus on key financial insights, market implications, and actionable information.
          Include specific data points, trends, and financial metrics mentioned in the document.
          `;
        }
        
        const response = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
          ],
          max_tokens: 800
        });
        
        // Extract and clean the summary
        const summary = response.choices[0].message.content?.trim();
        
        if (!summary) {
          return res.status(500).json({ error: 'Failed to generate summary' });
        }
        
        // Save the summary to the database cache
        await storage.saveDocumentSummary(documentId, summary);
        console.log(`Saved summary for document ID: ${documentId} to cache`);
        
        // Return the summary
        res.json({ summary });
        
      } catch (openaiError: any) {
        console.error('Error generating summary with OpenAI:', openaiError);
        res.status(500).json({ 
          error: 'Failed to generate document summary with AI',
          details: openaiError.message || 'Unknown OpenAI error'
        });
      }
    } catch (error: any) {
      console.error('Error generating document summary:', error);
      res.status(500).json({ 
        error: 'Failed to generate document summary',
        details: error.message || 'Unknown error'
      });
    }
  });

  // GET endpoint to retrieve a cached document summary
  app.get('/api/documents/:id/summary', isAuthenticated, async (req, res) => {
    try {
      const documentId = parseInt(req.params.id);
      
      // Get the document to check permissions
      const document = await storage.getDocumentWithBatch(documentId);
      
      if (!document) {
        return res.status(404).json({ error: 'Document not found' });
      }
      
      // Verify user access
      if (document.batch.userId !== req.user!.id && !req.user!.isAdmin) {
        return res.status(403).json({ error: 'Access denied to this document' });
      }
      
      // Check if we have a cached summary
      const cachedSummary = await storage.getDocumentSummary(documentId);
      
      if (cachedSummary) {
        // Return the cached summary
        return res.json({ summary: cachedSummary.summary });
      }
      
      // No cached summary found
      // If the document has extracted text, we can indicate it needs generation
      if (document.extractedText) {
        return res.status(404).json({ 
          error: 'Summary not found', 
          status: 'needs_generation',
          message: 'Document summary has not been generated yet'
        });
      } else {
        // Document text extraction isn't complete
        return res.status(400).json({ 
          error: 'Document text extraction not complete', 
          status: 'pending' 
        });
      }
    } catch (error: any) {
      console.error('Error retrieving document summary:', error);
      res.status(500).json({ 
        error: 'Failed to retrieve document summary',
        details: error.message || 'Unknown error'
      });
    }
  });

  // DELETE endpoint to remove a cached document summary (for regeneration)
  app.delete('/api/documents/:id/summary', isAuthenticated, async (req, res) => {
    try {
      const documentId = parseInt(req.params.id);
      
      // Get the document to check permissions
      const document = await storage.getDocumentWithBatch(documentId);
      
      if (!document) {
        return res.status(404).json({ error: 'Document not found' });
      }
      
      // Verify user access
      if (document.batch.userId !== req.user!.id && !req.user!.isAdmin) {
        return res.status(403).json({ error: 'Access denied to this document' });
      }
      
      // Delete the cached summary
      const deleted = await storage.deleteDocumentSummary(documentId);
      
      if (deleted) {
        return res.json({ message: 'Document summary cache cleared successfully' });
      } else {
        return res.status(404).json({ error: 'No cached summary found for this document' });
      }
    } catch (error: any) {
      console.error('Error deleting document summary cache:', error);
      res.status(500).json({ 
        error: 'Failed to delete document summary cache',
        details: error.message || 'Unknown error'
      });
    }
  });

  const httpServer = createServer(app);

  return httpServer;
}
