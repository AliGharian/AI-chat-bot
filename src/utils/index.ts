import axios from "axios";
import { IMessage } from "../types";
import { Document } from "langchain";
import weaviate, { WeaviateClient } from "weaviate-ts-client";
import dotenv from "dotenv";
dotenv.config();

export function extractUrl(text: string): string | null {
  const regex = /(https?:\/\/[^\s]+)/g;
  const match = text.match(regex);
  return match ? match[0] : null;
}

export async function fetchPageContent(url: string) {
  try {
    const res = await axios.get(url, {
      timeout: 8000,
      headers: {
        "User-Agent": "Mozilla/5.0",
      },
    });
    return res.data; // HTML
  } catch (err) {
    console.error("Fetch error:", err);
    return null;
  }
}

export function stripHtml(html: string) {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<\/?[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildHistoryPrompt(messages: IMessage[]) {
  return messages
    .map((m) => `${m.role === "USER" ? "user" : "model"}: ${m.text}`)
    .join("\n");
}

export async function scrapePage(url: string): Promise<string> {
  try {
    const html = await fetch(url).then((res) => res.text());
    const clean = html.replace(/<[^>]*>?/gm, " ");
    return clean.substring(0, 20000);
  } catch (err) {
    return "Error scraping page.";
  }
}

export async function getAssetPrice(symbol: string) {
  const apiUrl = "https://api.forexcalcs.com/prices.json";
  try {
    const response = await fetch(apiUrl);

    if (!response.ok) {
      return {
        success: false,
        result: `Error fetching price data: Status ${response.status}`,
      };
    }

    const data = await response.json();

    const asset = data.currencyPairs.find(
      (pair: any) =>
        pair.SymbolName.toUpperCase() === symbol.toUpperCase() ||
        pair.DisplaySymbolName.toUpperCase() === symbol.toUpperCase()
    );

    if (asset) {
      return {
        success: true,
        result: JSON.stringify({
          SymbolName: asset.SymbolName,
          SymbolRate: asset.SymbolRate,
          QuoteCurrency: asset.QuoteCurrency,
          FullName: asset.FullName,
        }),
      };
    }

    return {
      success: false,
      result: `Asset not found for symbol: ${symbol}. Available pairs are: ${data.currencyPairs
        .map((p: any) => p.SymbolName)
        .join(", ")}`,
    };
  } catch (error: any) {
    console.error("Asset price API call failed:", error);
    return {
      success: false,
      result: `An exception occurred during the API call: ${error.message}`,
    };
  }
}

export async function getForexEconomicNews(args: {
  countryCodes: string;
  startDate: string;
  endDate: string;
}) {
  const { countryCodes, startDate, endDate } = args;

  const fromDate = new Date(`${startDate}T00:00:00.000Z`).toISOString();
  const toDate = new Date(`${endDate}T23:59:59.999Z`).toISOString(); // تا پایان روز

  const url = new URL("https://economic-calendar.tradingview.com/events");

  url.searchParams.set("countries", countryCodes.toUpperCase());
  url.searchParams.set("from", fromDate);
  url.searchParams.set("to", toDate);

  try {
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Origin: "https://www.tradingview.com",
        "User-Agent": "Mozilla/5.0 (Custom Agent for SafeBroker)",
      },
    });

    if (!response.ok) {
      return {
        success: false,
        result: `Error fetching news: Status ${response.status} - ${response.statusText}`,
      };
    }

    const data = await response.json();

    const simplifiedEvents = data.result.map((event: any) => ({
      id: event.id,
      date: event.date,
      country: event.country,
      title: event.title,
      importance: event.importance, // Low, Medium, High
      actual: event.actual,
      forecast: event.forecast,
      previous: event.previous,
    }));

    return {
      success: true,
      result: JSON.stringify(simplifiedEvents),
    };
  } catch (error: any) {
    console.error("TradingView API call failed:", error);
    return {
      success: false,
      result: `An exception occurred during the API call: ${error.message}`,
    };
  }
}

export function extractTextFromChildren(children: any[]): string {
  return children
    .map((child) => {
      // 1. Base case: If the 'text' field exists, return its content.
      if (child.text) {
        return child.text;
      }

      // 2. Recursive step: If the node has its own 'children' (e.g., nested formatting or blocks),
      //    call the function again to extract text from that layer.
      if (child.children && Array.isArray(child.children)) {
        return extractTextFromChildren(child.children);
      }

      // Ignore other complex nodes (like empty objects)
      return "";
    })
    .join(" ");
}

export function extractRawText(contentBlocks: any): string {
  let rawText = "";
  // console.log("Content block is: ", contentBlocks)

  if (contentBlocks.startsWith("{") || contentBlocks.startsWith("[")) {
    // console.log("Correct content is: ", contentBlocks);
  }else {
    console.log("InCorrect content is: ", contentBlocks);
  }
  const blocks: any[] = JSON.parse(contentBlocks);
  for (const block of blocks) {
    // Skip non-textual blocks like images and custom components (CTAs).
    if (["image", "target"].includes(block.type)) {
      // Optional: Include caption text if available
      if (block.caption) {
        rawText += `[Caption: ${block.caption}]\n`;
      }
      continue;
    }

    // Special handling for list blocks (e.g., bulleted-list)
    if (block.type && ["list"].includes(block.type) && block.children) {
      block.children.forEach((listItem: any) => {
        if (listItem.type === "list-item" && listItem.children) {
          const listItemText = extractTextFromChildren(listItem.children);
          // Use a marker for list items to maintain structure
          rawText += `* ${listItemText}\n`;
        }
      });
      rawText += "\n"; // Add spacing after the list
      continue;
    }

    // General handling for textual blocks (paragraph, heading, etc.)
    if (block.children && Array.isArray(block.children)) {
      const extracted = extractTextFromChildren(block.children);

      // Only add text if content was actually extracted
      if (extracted.trim().length > 0) {
        // Add double newline to clearly separate chunks during splitting
        rawText += extracted + "\n\n";
      }
    }
  }

  return rawText.trim();
}

/* ---------- Weaviate Configuration ---------- */
const WEAVIATE_HOST = `${process.env.HOST}:${process.env.WEAVIATE_PORT}`;
const WEAVIATE_CLASS_NAME = process.env.WEAVIATE_CLASS_NAME || "";

/* ---------- Helper Functions for RAG ---------- */
export function formatContext(documents: Document[]): string {
  const context = documents
    .map((doc) => {
      return `${doc.pageContent}\n---`;
    })
    .join("\n");
  return context.trim();
}

export async function runSimilaritySearch(
  userQuery: string,
  k: number = 10
): Promise<Document[]> {
  //! Define Weaviate client
  const weaviateClient: WeaviateClient = weaviate.client({
    scheme: "http",
    host: WEAVIATE_HOST,
  });

  const isReady = await weaviateClient.misc.readyChecker().do();
  if (!isReady) {
    console.error("❌ Weaviate is not ready. Cannot perform search.");
    return [];
  }
  console.log(
    "✅ Connected to Weaviate for search. Using native GraphQL search."
  );
  //? -------------------------------------------

  console.log(
    `Searching Weaviate for documents of ${WEAVIATE_CLASS_NAME} similar to: "${userQuery}"...`
  );

  const graphqlQuery = await weaviateClient.graphql
    .get()
    .withClassName(WEAVIATE_CLASS_NAME)
    .withFields(
      "content title metaTitle metaDescription _additional { id distance }"
    )
    .withNearText({
      concepts: [userQuery],
    })
    .withLimit(k)
    .do();

  const results: any[] = graphqlQuery.data.Get?.[WEAVIATE_CLASS_NAME] || [];

  console.log("\n\nGraphQL Search Results:\n", results);

  const relevantDocuments: Document[] = results.map((item, index) => {
    // Create Document
    const doc = new Document({
      pageContent: item.content,
      metadata: {
        id: item._additional.id,
        distance: item._additional.distance,
      },
    });
    return doc;
  });

  return relevantDocuments;
}

export function chunkArray<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}
