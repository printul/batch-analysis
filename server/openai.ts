import OpenAI from "openai";

// The newest OpenAI model is "gpt-4o" which was released May 13, 2024. do not change this unless explicitly requested by the user
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export interface TweetAnalysis {
  summary: string;
  themes: string[];
  sentiment: {
    score: number; // 1-5 scale
    label: string; // "positive", "negative", "neutral"
    confidence: number; // 0-1 scale
  };
  topHashtags: string[];
  keyPhrases: string[];
}

export interface DocumentAnalysis {
  summary: string;
  themes: string[];
  tickers?: string[];
  recommendations?: string[];
  sentiment: {
    score: number; // 1-5 scale
    label: string; // "positive", "negative", "neutral"
    confidence: number; // 0-1 scale
  };
  sharedIdeas?: string[];
  divergingIdeas?: string[];
  keyPoints: string[];
}

export async function analyzeDocuments(documents: {
  filename: string;
  content: string;
}[]): Promise<DocumentAnalysis> {
  if (!documents.length) {
    return {
      summary: "No documents available for analysis.",
      themes: [],
      tickers: [],
      recommendations: [],
      sentiment: { score: 3, label: "neutral", confidence: 0 },
      sharedIdeas: [],
      divergingIdeas: [],
      keyPoints: []
    };
  }

  // Format documents for analysis
  const combinedText = documents.map(doc => 
    `--- Document: ${doc.filename} ---\n${doc.content}`
  ).join("\n\n");

  try {
    const prompt = `
    Analyze the following document content:
    
    ${combinedText}
    
    Provide your analysis in the following JSON format:
    {
      "summary": "A concise 3-5 sentence summary of the overall content",
      "themes": ["Theme 1", "Theme 2", "Theme 3"],
      "tickers": ["TICKER1", "TICKER2", "TICKER3"],
      "recommendations": ["Recommendation 1", "Recommendation 2", "Recommendation 3"],
      "sentiment": {
        "score": <number 1-5 where 1 is very negative, 3 is neutral, and 5 is very positive>,
        "label": "<positive, negative, or neutral>",
        "confidence": <number 0-1 indicating confidence in sentiment analysis>
      },
      "sharedIdeas": ["Shared idea 1", "Shared idea 2", "Shared idea 3"],
      "divergingIdeas": ["Diverging idea 1", "Diverging idea 2", "Diverging idea 3"],
      "keyPoints": ["Key point 1", "Key point 2", "Key point 3"]
    }
    
    Ensure the summary is insightful and captures the essence of the documents.
    For themes, identify 3-5 recurring topics or subjects discussed across the documents.
    For tickers, extract any stock market ticker symbols mentioned (like AAPL, MSFT, TSLA).
    For recommendations, identify 3-5 actionable recommendations that can be derived from the content.
    For sentiment, analyze the overall emotional tone of the documents.
    For sharedIdeas, identify 3-5 concepts or ideas that are common across documents.
    For divergingIdeas, identify 3-5 concepts or ideas where the documents present different viewpoints.
    For keyPoints, identify 5-7 important points from the content.
    
    If any section is not applicable (e.g., no tickers mentioned), provide an empty array.
    
    Return ONLY the JSON object, with no additional explanation or text.`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" }
    });

    // Parse and validate the response
    const content = response.choices[0].message.content;
    if (!content) {
      throw new Error("No content received from OpenAI");
    }

    const analysis = JSON.parse(content) as DocumentAnalysis;
    
    // Ensure sentiment values are within expected ranges
    analysis.sentiment.score = Math.max(1, Math.min(5, analysis.sentiment.score));
    analysis.sentiment.confidence = Math.max(0, Math.min(1, analysis.sentiment.confidence));
    
    return analysis;
  } catch (error) {
    console.error("Error analyzing documents with OpenAI:", error);
    return {
      summary: "Error analyzing documents. Please try again later.",
      themes: [],
      tickers: [],
      recommendations: [],
      sentiment: { score: 3, label: "neutral", confidence: 0 },
      sharedIdeas: [],
      divergingIdeas: [],
      keyPoints: []
    };
  }
}

export async function analyzeTweets(tweets: {
  text: string;
  author: string;
  createdAt: Date;
}[]): Promise<TweetAnalysis> {
  if (!tweets.length) {
    return {
      summary: "No tweets available for analysis.",
      themes: [],
      sentiment: { score: 3, label: "neutral", confidence: 0 },
      topHashtags: [],
      keyPhrases: []
    };
  }

  // Format tweets for analysis
  const tweetsText = tweets.map(tweet => 
    `Tweet from ${tweet.author} (${new Date(tweet.createdAt).toLocaleString()}): ${tweet.text}`
  ).join("\n\n");

  try {
    const prompt = `
    Analyze the following Twitter content from the same user:
    
    ${tweetsText}
    
    Provide your analysis in the following JSON format:
    {
      "summary": "A concise 2-3 sentence summary of the overall content",
      "themes": ["Theme 1", "Theme 2", "Theme 3"],
      "sentiment": {
        "score": <number 1-5 where 1 is very negative, 3 is neutral, and 5 is very positive>,
        "label": "<positive, negative, or neutral>",
        "confidence": <number 0-1 indicating confidence in sentiment analysis>
      },
      "topHashtags": ["hashtag1", "hashtag2", "hashtag3"],
      "keyPhrases": ["Key phrase 1", "Key phrase 2", "Key phrase 3"]
    }
    
    Ensure the summary is insightful and captures the essence of the tweets.
    For themes, identify 3-5 recurring topics or subjects discussed in the tweets.
    For sentiment, analyze the emotional tone of the tweets.
    For topHashtags, extract the most used hashtags if any (without the # symbol).
    For keyPhrases, identify 3-5 important or frequently mentioned phrases.
    
    Return ONLY the JSON object, with no additional explanation or text.`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" }
    });

    // Parse and validate the response
    const content = response.choices[0].message.content;
    if (!content) {
      throw new Error("No content received from OpenAI");
    }

    const analysis = JSON.parse(content) as TweetAnalysis;
    
    // Ensure sentiment values are within expected ranges
    analysis.sentiment.score = Math.max(1, Math.min(5, analysis.sentiment.score));
    analysis.sentiment.confidence = Math.max(0, Math.min(1, analysis.sentiment.confidence));
    
    return analysis;
  } catch (error) {
    console.error("Error analyzing tweets with OpenAI:", error);
    return {
      summary: "Error analyzing tweets. Please try again later.",
      themes: [],
      sentiment: { score: 3, label: "neutral", confidence: 0 },
      topHashtags: [],
      keyPhrases: []
    };
  }
}