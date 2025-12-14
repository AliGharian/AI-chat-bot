import { FunctionDeclaration, Type } from "@google/genai";

export const FUNCTION_DECLARATION: FunctionDeclaration[] = [
  {
    name: "scrapePage",
    description: "Scrape webpage HTML and return readable text",
    parameters: {
      type: Type.OBJECT,
      properties: {
        url: { type: Type.STRING },
      },
      required: ["url"],
    },
  },
  {
    name: "getAssetPrice",
    description:
      "Fetches the current real-time price for a specific asset symbol, like 'XAU/USD' for Gold Ounce (Oz) in USD.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        symbol: {
          type: Type.STRING,
          description:
            "The symbol for the asset (e.g., 'XAU/USD' for Gold, 'EUR/USD' for Euro/Dollar). Default to 'XAU/USD' if the user asks about the price of gold.",
        },
      },
      required: ["symbol"],
    },
  },
  {
    name: "getForexEconomicNews",
    description:
      "Fetches economic calendar events from TradingView for specific countries and date ranges.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        countryCodes: {
          type: Type.STRING,
          description:
            "A comma-separated string of country/currency codes (e.g., 'US,EU,JP,GB') mapped from the user's request.",
        },
        startDate: {
          type: Type.STRING,
          description:
            "The start date for the news fetch in ISO 8601 format (e.g., 'YYYY-MM-DD').",
        },
        endDate: {
          type: Type.STRING,
          description:
            "The end date for the news fetch in ISO 8601 format (e.g., 'YYYY-MM-DD').",
        },
      },
      required: ["startDate", "endDate"],
    },
  },
  {
    name: "searchKnowledgeBase",
    description:
      "Searches the internal knowledge base for specific, detailed information on financial topics, brokers, or technical guides.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description:
            "CRITICAL: Generate a complete, standalone, and article-like query for vector search. This query MUST combine the 'USER_QUERY' and the 'chat history' context to ensure accuracy. The output query must be phrased as if it were a title or topic of a blog post (e.g., 'A detailed guide on removing indicators from the TradingView chart').",
        },
        k: {
          type: Type.INTEGER,
          description: "Number of documents to retrieve (default is 5).",
        },
      },
      required: ["query"],
    },
  },
  // add more actions
];
