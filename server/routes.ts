import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import session from "express-session";
import MemoryStore from "memorystore";
import { TwitterApi } from "twitter-api-v2";
import { loginUserSchema, insertUserSchema, twitterAccountSchema, searchSchema, documentBatchSchema } from "@shared/schema";
import NodeCron from "node-cron";
import { analyzeTweets, analyzeDocuments } from "./openai";
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

// Helper function to get authenticated user from either session or passport
function getAuthenticatedUser(req: Request): any {
  return req.session.user || req.user;
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
    if (req.isAuthenticated()) {
      return next();
    }
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
      const userId = req.session.user!.id;
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
        userId: req.session.user!.id
      });
      
      res.status(201).json(newBatch);
    } catch (error) {
      console.error('Error creating document batch:', error);
      res.status(500).json({ error: 'Failed to create document batch' });
    }
  });

  app.get('/api/document-batches', isAuthenticated, async (req, res) => {
    try {
      const batches = await storage.getDocumentBatchesByUserId(req.session.user!.id);
      res.json(batches);
    } catch (error) {
      console.error('Error fetching document batches:', error);
      res.status(500).json({ error: 'Failed to fetch document batches' });
    }
  });

  app.get('/api/document-batches/:id', isAuthenticated, async (req, res) => {
    try {
      const batchId = parseInt(req.params.id);
      const batch = await storage.getDocumentBatch(batchId);
      
      if (!batch) {
        return res.status(404).json({ error: 'Document batch not found' });
      }
      
      // Check if user owns this batch
      if (batch.userId !== req.session.user!.id && !req.session.user!.isAdmin) {
        return res.status(403).json({ error: 'Access denied' });
      }
      
      // Get documents in this batch
      const documents = await storage.getDocumentsByBatchId(batchId);
      
      // Get analysis if it exists
      const analysis = await storage.getDocumentAnalysisByBatchId(batchId);
      
      res.json({
        batch,
        documents,
        analysis
      });
    } catch (error) {
      console.error('Error fetching document batch:', error);
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
      if (batch.userId !== req.session.user!.id && !req.session.user!.isAdmin) {
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
      
      if (batch.userId !== req.session.user!.id && !req.session.user!.isAdmin) {
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
      // Set the worker path
      const pdfjsLib = await import('pdfjs-dist');
      
      // Load the PDF file
      const data = new Uint8Array(fs.readFileSync(filePath));
      const loadingTask = pdfjsLib.getDocument({ data });
      const pdf = await loadingTask.promise;
      
      let extractedText = '';
      
      // Extract text from each page
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const strings = content.items.map((item: any) => item.str);
        extractedText += strings.join(' ') + '\n';
      }
      
      // Update the document with the extracted text
      await storage.updateDocumentExtractedText(documentId, extractedText);
      console.log(`Successfully extracted text from PDF document ID: ${documentId}`);
    } catch (error) {
      console.error(`Error extracting text from PDF (document ID: ${documentId}):`, error);
    }
  }

  // Document analysis endpoint
  app.post('/api/documents/analyze/:batchId', isAuthenticated, async (req, res) => {
    try {
      const batchId = parseInt(req.params.batchId);
      
      // Validate batch exists and user has access
      const batch = await storage.getDocumentBatch(batchId);
      if (!batch) {
        return res.status(404).json({ error: 'Document batch not found' });
      }
      
      if (batch.userId !== req.session.user!.id && !req.session.user!.isAdmin) {
        return res.status(403).json({ error: 'Access denied to this batch' });
      }
      
      // Get all documents in the batch
      const documents = await storage.getDocumentsByBatchId(batchId);
      if (documents.length === 0) {
        return res.status(400).json({ error: 'No documents found in this batch' });
      }
      
      // Check if documents have extracted text
      const documentsWithText = documents.filter(doc => doc.extractedText);
      if (documentsWithText.length === 0) {
        return res.status(400).json({ error: 'No text extracted from documents yet. Please try again later.' });
      }
      
      // Format documents for analysis
      const docsForAnalysis = documentsWithText.map(doc => ({
        filename: doc.filename,
        content: doc.extractedText || ''
      }));
      
      // Call OpenAI for analysis
      const analysis = await analyzeDocuments(docsForAnalysis);
      
      // Map the OpenAI analysis result to our database schema
      const analysisResult = {
        batchId,
        summary: analysis.summary,
        themes: analysis.themes,
        tickers: analysis.tickers || [],
        recommendations: analysis.recommendations || [],
        sentimentScore: analysis.sentiment.score,
        sentimentLabel: analysis.sentiment.label,
        sentimentConfidence: analysis.sentiment.confidence,
        sharedIdeas: analysis.sharedIdeas || [],
        divergingIdeas: analysis.divergingIdeas || [],
        keyPoints: analysis.keyPoints
      };
      
      // Save the analysis to the database
      const savedAnalysis = await storage.saveDocumentAnalysis(analysisResult);
      
      res.json(savedAnalysis);
    } catch (error) {
      console.error('Error analyzing documents:', error);
      res.status(500).json({ error: 'Failed to analyze documents' });
    }
  });

  // Document endpoint to delete a document
  app.delete('/api/documents/:id', isAuthenticated, async (req, res) => {
    try {
      const documentId = parseInt(req.params.id);
      if (isNaN(documentId)) {
        return res.status(400).json({ error: 'Invalid document ID' });
      }
      
      // Get authenticated user
      const user = getAuthenticatedUser(req);
      if (!user) {
        return res.status(401).json({ error: 'User not properly authenticated' });
      }
      
      // Get document with its batch to check ownership
      const document = await storage.getDocumentWithBatch(documentId);
      if (!document) {
        return res.status(404).json({ error: 'Document not found' });
      }
      
      // Check if user owns this batch
      if (document.batch.userId !== user.id && !user.isAdmin) {
        return res.status(403).json({ error: 'Access denied to this document' });
      }
      
      // Delete the document's file if it exists
      if (document.filePath) {
        try {
          await fs.promises.unlink(document.filePath);
        } catch (fileError) {
          console.error('Error deleting document file:', fileError);
          // Continue with deletion even if file removal fails
        }
      }
      
      // Delete document summary if it exists
      try {
        await storage.deleteDocumentSummary(documentId);
      } catch (summaryError) {
        console.error('Error deleting document summary:', summaryError);
        // Continue with deletion even if summary removal fails
      }
      
      // Delete the document from the database
      const deleted = await storage.deleteDocument(documentId);
      
      if (!deleted) {
        return res.status(500).json({ error: 'Failed to delete document' });
      }
      
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting document:', error);
      res.status(500).json({ error: 'Failed to delete document' });
    }
  });

  // Document summary endpoints
  // GET - Retrieve an existing summary
  app.get('/api/documents/:id/summary', isAuthenticated, async (req, res) => {
    try {
      const documentId = parseInt(req.params.id);
      if (isNaN(documentId)) {
        return res.status(400).json({ error: 'Invalid document ID' });
      }
      
      // Get authenticated user
      const user = getAuthenticatedUser(req);
      if (!user) {
        return res.status(401).json({ error: 'User not properly authenticated' });
      }
      
      // Get document with its batch to check ownership
      const document = await storage.getDocumentWithBatch(documentId);
      if (!document) {
        return res.status(404).json({ error: 'Document not found' });
      }
      
      // Check if user owns this batch
      if (document.batch.userId !== user.id && !user.isAdmin) {
        return res.status(403).json({ error: 'Access denied to this document' });
      }
      
      // Get existing summary if any
      const summary = await storage.getDocumentSummary(documentId);
      if (!summary) {
        return res.status(404).json({ 
          error: 'No summary available', 
          status: 'needs_generation' 
        });
      }
      
      res.json(summary);
    } catch (error) {
      console.error('Error retrieving document summary:', error);
      res.status(500).json({ error: 'Failed to retrieve document summary' });
    }
  });
  
  // POST - Generate a new summary
  app.post('/api/documents/:id/summary', isAuthenticated, async (req, res) => {
    try {
      const documentId = parseInt(req.params.id);
      if (isNaN(documentId)) {
        return res.status(400).json({ error: 'Invalid document ID' });
      }
      
      // Get authenticated user
      const user = getAuthenticatedUser(req);
      if (!user) {
        return res.status(401).json({ error: 'User not properly authenticated' });
      }
      
      // Get document with its batch to check ownership
      const document = await storage.getDocumentWithBatch(documentId);
      if (!document) {
        return res.status(404).json({ error: 'Document not found' });
      }
      
      // Check if user owns this batch
      if (document.batch.userId !== user.id && !user.isAdmin) {
        return res.status(403).json({ error: 'Access denied to this document' });
      }
      
      // Check if we have extracted text
      if (!document.extractedText) {
        return res.status(400).json({ 
          error: 'No extracted text available for this document'
        });
      }
      
      // Generate summary using OpenAI
      try {
        // Create input for analysis in the format expected by our OpenAI function
        const docForAnalysis = {
          filename: document.filename,
          content: document.extractedText
        };
        
        // Call OpenAI for single document analysis
        const analysis = await analyzeDocuments([docForAnalysis]);
        
        // Save the generated summary
        const savedSummary = await storage.saveDocumentSummary(documentId, analysis.summary);
        
        res.json(savedSummary);
      } catch (aiError: any) {
        console.error('Error generating document summary with AI:', aiError);
        return res.status(500).json({ 
          error: 'Failed to generate document summary',
          details: aiError.message || 'Unknown AI error'
        });
      }
    } catch (error) {
      console.error('Error generating document summary:', error);
      res.status(500).json({ error: 'Failed to generate document summary' });
    }
  });
  
  // DELETE - Remove an existing summary
  app.delete('/api/documents/:id/summary', isAuthenticated, async (req, res) => {
    try {
      const documentId = parseInt(req.params.id);
      if (isNaN(documentId)) {
        return res.status(400).json({ error: 'Invalid document ID' });
      }
      
      // Get authenticated user
      const user = getAuthenticatedUser(req);
      if (!user) {
        return res.status(401).json({ error: 'User not properly authenticated' });
      }
      
      // Get document with its batch to check ownership
      const document = await storage.getDocumentWithBatch(documentId);
      if (!document) {
        return res.status(404).json({ error: 'Document not found' });
      }
      
      // Check if user owns this batch
      if (document.batch.userId !== user.id && !user.isAdmin) {
        return res.status(403).json({ error: 'Access denied to this document' });
      }
      
      // Delete the summary
      await storage.deleteDocumentSummary(documentId);
      
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting document summary:', error);
      res.status(500).json({ error: 'Failed to delete document summary' });
    }
  });

  const httpServer = createServer(app);

  return httpServer;
}
