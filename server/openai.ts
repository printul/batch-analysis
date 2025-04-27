import OpenAI from "openai";

// The newest OpenAI model is "gpt-4o" which was released May 13, 2024. do not change this unless explicitly requested by the user
export const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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
  // New financial data fields
  marketSectors?: string[];
  marketOutlook?: string;
  keyMetrics?: string[];
  investmentRisks?: string[];
  priceTrends?: string[];
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
      keyPoints: [],
      // New financial data fields
      marketSectors: [],
      marketOutlook: "No documents to analyze for market outlook.",
      keyMetrics: [],
      investmentRisks: [],
      priceTrends: []
    };
  }

  // Truncate and prepare documents for analysis
  const MAX_DOC_CHARS = 20000; // Maximum characters per document
  const MAX_TOTAL_CHARS = 80000; // Maximum total characters for all documents
  let totalChars = 0;
  
  // Process documents: truncate each document and track total size
  const processedDocs = documents.map(doc => {
    // Check if document is empty, too short, or contains binary/corrupt content
    const hasActualContent = doc.content && doc.content.trim().length > 50;
    const isProbablyBinaryOrCorrupt = 
        !hasActualContent || 
        doc.content.includes('[PDF EXTRACTION LIMITATION NOTICE]') ||
        doc.content.includes('[BINARY_PDF_CONTENT]') || 
        doc.content.includes('[MINIMAL_TEXT_CONTENT]') ||
        doc.content.startsWith('%PDF') || 
        doc.content.includes('/Type /Catalog');
    
    if (isProbablyBinaryOrCorrupt) {
      // For documents with insufficient text, create a clear message about the limitation
      return {
        filename: doc.filename,
        content: `[INSUFFICIENT_DOCUMENT_CONTENT] The document titled "${doc.filename}" contains insufficient extractable text for analysis. The text extraction process was unable to obtain meaningful content from this file. Any analysis would be purely speculative and potentially misleading.`,
        truncated: false
      };
    }
    
    // For normal documents, truncate if needed
    const truncated = doc.content.length > MAX_DOC_CHARS;
    const content = truncated ? doc.content.substring(0, MAX_DOC_CHARS) + "... [content truncated]" : doc.content;
    
    totalChars += content.length;
    return { filename: doc.filename, content, truncated };
  });
  
  // If total size is still too large, further reduce
  let finalDocs = [...processedDocs];
  if (totalChars > MAX_TOTAL_CHARS) {
    console.log(`Document set exceeds maximum size (${totalChars}/${MAX_TOTAL_CHARS}), truncating...`);
    
    // Calculate how much we need to reduce each document
    const reductionFactor = MAX_TOTAL_CHARS / totalChars;
    totalChars = 0;
    
    finalDocs = processedDocs.map(doc => {
      const newLength = Math.floor(doc.content.length * reductionFactor);
      const truncated = true;
      const content = doc.content.substring(0, newLength) + "... [content truncated]";
      totalChars += content.length;
      return { ...doc, content, truncated };
    });
  }
  
  console.log(`Processed ${documents.length} documents. Total size: ${totalChars} characters`);
  
  // Format documents for analysis
  const combinedText = finalDocs.map(doc => 
    `--- Document: ${doc.filename} ${doc.truncated ? "(TRUNCATED)" : ""} ---\n${doc.content}`
  ).join("\n\n");

  try {
    const systemPrompt = `You are a professional financial document analyst with expertise in financial markets, investment strategies, and economic analysis. 
    Your task is to thoroughly analyze the provided documents to extract ONLY the insights that are EXPLICITLY present in the text. 
    DO NOT make up information or hallucinate data that isn't clearly stated in the source text.
    
    CRITICAL RULES:
    1. Only include information explicitly present in the documents
    2. Leave fields empty (use empty arrays or "No data available" strings) when information is not present
    3. Never invent tickers, metrics, numbers, or specific investment recommendations
    4. Always cite specific text from the documents to support your analysis
    5. Respond in valid JSON format with structured, factual insights only`;
    
    const userPrompt = `
    Analyze the following document content to identify financial insights, but ONLY report what is explicitly mentioned:
    
    ${combinedText}
    
    Provide your FACTUAL analysis in the following JSON format:
    {
      "summary": "A truthful 3-5 sentence summary of what is ACTUALLY in the documents, omitting any details not explicitly present. If documents are damaged or incomplete, acknowledge this limitation.",
      
      "themes": ["Only include actual themes explicitly mentioned in the text", "Leave as empty array if not clearly present"],
      
      "tickers": ["Only include actual stock symbols that appear in the documents (AAPL, MSFT, etc.)", "Leave as empty array if none are mentioned"],
      
      "recommendations": [
        "Only include explicit recommendations from the documents",
        "Each recommendation must quote or closely paraphrase actual text",
        "Leave as empty array if no recommendations are explicitly made"
      ],
      
      "sentiment": {
        "score": 3, // default to neutral (3) unless clear sentiment evidence exists
        "label": "neutral", // default to neutral unless clear evidence
        "confidence": 0.5 // lower confidence (0.3-0.5) when evidence is limited
      },
      
      "sharedIdeas": [
        "Only include ideas that appear across multiple documents with specific references",
        "Leave as empty array if documents don't share common perspectives"
      ],
      
      "divergingIdeas": [
        "Only include explicitly contradictory viewpoints with references to specific documents",
        "Leave as empty array if no clear contradictions exist"
      ],
      
      "keyPoints": [
        "Only include major points explicitly stated in the documents",
        "Each point must quote or closely paraphrase actual text",
        "Leave as empty array if text is too limited to extract key points"
      ],
      
      "marketSectors": ["Only sectors explicitly mentioned", "Leave as empty array if none are mentioned"],
      
      "marketOutlook": "Only include an outlook if explicitly stated in the documents. Otherwise use: 'Insufficient information to determine market outlook.'",
      
      "keyMetrics": [
        "Only include metrics explicitly mentioned with their actual values",
        "Leave as empty array if no specific metrics are provided"
      ],
      
      "investmentRisks": [
        "Only include risks explicitly mentioned in the documents",
        "Leave as empty array if no specific risks are discussed"
      ],
      
      "priceTrends": [
        "Only include price trends explicitly mentioned with specific assets and directions",
        "Leave as empty array if no price trends are discussed"
      ]
    }
    
    Detailed Guidelines:
    
    1. For "tickers", extract ONLY stock market ticker symbols (like AAPL, MSFT, TSLA, NVDA, SPY, QQQ) that ACTUALLY appear in the documents. DO NOT generate tickers that aren't present.
    
    2. For "recommendations", include ONLY explicit recommendations from the documents. Each recommendation must be a direct quote or close paraphrase. If no clear recommendations exist, return an empty array.
    
    3. For "sentiment", if the document doesn't contain clear sentiment indicators, default to neutral (score: 3, label: "neutral") with lower confidence (0.5).
    
    4. For "sharedIdeas" and "divergingIdeas", only include perspectives that clearly appear across multiple documents or are explicitly contradictory. If documents don't contain sufficient comparison points, return empty arrays.
    
    5. For "keyPoints", include ONLY major points explicitly stated in the documents. Each point must be traceable to specific text. If documents contain limited extractable content, acknowledge these limitations.
    
    6. For "marketSectors", list ONLY sectors explicitly mentioned in the text. Do not infer sectors based on companies or other context. Return empty array if none are mentioned.
    
    7. For "marketOutlook", include ONLY explicitly stated outlooks. If not clearly addressed, use: "Insufficient information to determine market outlook."
    
    8. For "keyMetrics", include ONLY metrics explicitly mentioned with their actual values. Do not estimate or infer metrics. Return empty array if no specific metrics are provided.
    
    9. For "investmentRisks", include ONLY risks explicitly mentioned. Do not generate potential risks not stated in documents. Return empty array if no specific risks are discussed.
    
    10. For "priceTrends", include ONLY price movements explicitly mentioned with specific details. Return empty array if no specific price trends are discussed.
    
    FINAL CHECK BEFORE SUBMITTING:
    1. Have I included ONLY information explicitly present in the documents?
    2. Have I left fields empty when the documents don't contain relevant information?
    3. Have I avoided making up tickers, metrics, recommendations or other data?
    4. Is my analysis based on FACTUAL content, not inferences or assumptions?
    5. For documents with partial or limited extraction, have I acknowledged these limitations?
    
    Return ONLY the JSON object, no additional explanation.`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
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
      keyPoints: [],
      // New financial data fields
      marketSectors: [],
      marketOutlook: "Market outlook data could not be generated due to analysis error.",
      keyMetrics: [], 
      investmentRisks: [],
      priceTrends: []
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