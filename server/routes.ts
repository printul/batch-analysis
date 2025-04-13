import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import session from "express-session";
import MemoryStore from "memorystore";
import { TwitterApi } from "twitter-api-v2";
import { loginUserSchema, insertUserSchema, twitterAccountSchema } from "@shared/schema";
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

  const httpServer = createServer(app);

  return httpServer;
}
