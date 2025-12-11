import {
  GoogleGenAI,
  ToolListUnion,
  ContentListUnion,
  GenerateContentConfig,
} from "@google/genai";
import { getAssetPrice, getForexEconomicNews, scrapePage } from "../utils";
import { SYSTEM_INSTRUCTION } from "./systemInstruction";
import { FUNCTION_DECLARATION } from "./functionDeclaration";
import { Document } from "langchain";
import weaviate, { WeaviateClient } from "weaviate-ts-client";
import dotenv from "dotenv";
dotenv.config();

/* ---------- Weaviate Configuration ---------- */
const WEAVIATE_HOST = `${process.env.HOST}:${process.env.WEAVIATE_PORT}`;
const WEAVIATE_CLASS_NAME = process.env.WEAVIATE_CLASS_NAME || "DocumentChunk";

/* ---------- Helper Functions for RAG ---------- */
function formatContext(documents: Document[]): string {
  if (documents.length === 0) return "No relevant documents found.";
  const context = documents
    .map((doc, index) => {
      return `[CHUNK ${index + 1}, Distance: ${doc.metadata.distance.toFixed(
        4
      )}]\n${doc.pageContent}\n`;
    })
    .join("---\n");
  return context.trim();
}

async function runSimilaritySearch(
  userQuery: string,
  k: number = 8
): Promise<Document[]> {
  const weaviateClient: WeaviateClient = weaviate.client({
    scheme: "http",
    host: WEAVIATE_HOST,
  });

  try {
    const isReady = await weaviateClient.misc.readyChecker().do();
    if (!isReady) {
      console.error("Weaviate is not ready. Skipping RAG search.");
      return [];
    }

    const graphqlQuery = await weaviateClient.graphql
      .get()
      .withClassName(WEAVIATE_CLASS_NAME)
      .withFields("content _additional { id distance }")
      .withNearText({
        concepts: [userQuery],
        distance: 0.35,
      })
      .withLimit(k)
      .do();

    const results: any[] = graphqlQuery.data.Get?.[WEAVIATE_CLASS_NAME] || [];

    console.log(
      `RAG Search successful. Fetched ${results.length} relevant chunks.`
    );

    const relevantDocuments: Document[] = results.map((item) => {
      return new Document({
        pageContent: item.content,
        metadata: {
          id: item._additional.id,
          distance: item._additional.distance,
        },
      });
    });

    return relevantDocuments;
  } catch (error) {
    console.error("RAG Search failed:", error);
    return [];
  }
}

/* ---------- TYPES ---------- */
interface GenerateOptions {
  model?: string;
  prompt: string;
  history?: string;
  pageUrl?: string;
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
  onData?: (chunk: string) => void;
  onEnd?: () => void;
  onError?: (err: any) => void;
}

/* ---------- Gemini Client With Actions ---------- */
export class GeminiClient {
  private client: GoogleGenAI;

  constructor(apiKey: string) {
    this.client = new GoogleGenAI({ apiKey });
  }

  private wait(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /* ---------- Action Execution ---------- */
  private async executeAction(name: string, args: any) {
    if (name === "scrapePage") {
      return await scrapePage(args.url);
    }

    if (name === "getAssetPrice") {
      const symbol = args.symbol || "XAU/USD";
      return await getAssetPrice(symbol);
    }

    if (name === "getForexEconomicNews") {
      return await getForexEconomicNews(args);
    }

    throw new Error("Unknown action: " + name);
  }

  async generateText(options: GenerateOptions): Promise<void> {
    const model = options.model ?? "gemini-2.5-flash";
    const userQuery = options.prompt;
    const tools: ToolListUnion = [
      {
        functionDeclarations: FUNCTION_DECLARATION,
      },
    ];

    const config: GenerateContentConfig = {
      tools: tools,
      systemInstruction: SYSTEM_INSTRUCTION,
      temperature: options.temperature,
      topP: options.topP,
      maxOutputTokens: options.maxOutputTokens,
    };

    const relevantDocuments = await runSimilaritySearch(userQuery, 20);
    const contextText = formatContext(relevantDocuments);

    const ragPrompt: string = `
        Instructions:
        1. Only use Function Call tools if the required answer is NOT available in the 'CONTEXT_DATA' provided below.
        2. Answer the 'USER_QUERY' strictly based on the 'CONTEXT_DATA' and the chat history (if relevant).
        3. The response must be comprehensive, respectful, and fluent in Persian (Farsi).

        This is the chat history between the user and the assistant:
          ${options.history}

        --- CONTEXT_DATA (Knowledge Base) ---
        ${contextText}

        Current Page URL: "${options.pageUrl ?? ""}"

        USER_QUERY:
        ${userQuery}
    `;

    const firstContent: ContentListUnion = [
      {
        role: "user",
        parts: [
          {
            text: ragPrompt,
          },
        ],
      },
    ];

    try {
      /* ---------- First Step Call the Model ---------- */
      const response = await this.client.models.generateContent({
        model,
        config,
        contents: firstContent,
      });

      console.log("First AI response: ", response);

      /* ---------- if needs action ---------- */
      const actionCall = response?.candidates?.[0]?.content?.parts?.find(
        (p: any) => p.functionCall
      )?.functionCall;

      if (actionCall) {
        const actionName = actionCall.name;
        const actionArgs = actionCall.args;

        if (!actionName)
          throw new Error(`Unknown function call: ${actionName}`);

        console.log("This action called", actionName);

        const toolResult = await this.executeAction(actionName, actionArgs);

        console.log("tool result is: ", toolResult);

        const functionResponsePart = {
          name: actionName,
          response: {
            result: toolResult,
          },
        };
        // --- FIX IS HERE ---
        // باید کل تاریخچه قبلی را هم بفرستید

        const followupContents: ContentListUnion = [
          ...firstContent,
          {
            role: "model",
            parts: [
              {
                functionCall: actionCall,
              },
            ],
          },
          {
            role: "function",
            parts: [
              {
                functionResponse: functionResponsePart,
              } as any,
            ],
          },
        ];

        console.log("Follow up content is: ", followupContents);

        // send follow-up to model
        const stream = await this.client.models.generateContentStream({
          model,
          config,
          contents: followupContents,
        });

        console.log("Follow up stream call: ", stream);

        for await (const event of stream) {
          const text = event?.candidates?.[0]?.content?.parts
            ?.map((p) => p.text)
            ?.join("");
          if (text && options.onData) options.onData(text);
        }

        if (options.onEnd) options.onEnd();
        return;
      }

      /* ---------- If there is no action ---------- */
      const stream = await this.client.models.generateContentStream({
        model,
        config,
        contents: [
          {
            role: "user",
            parts: [{ text: options.prompt }],
          },
        ],
      });

      console.log("first stream is: ", stream);
      for await (const event of stream) {
        const text = event?.candidates?.[0]?.content?.parts
          ?.map((p) => p.text)
          ?.join("");

        if (text && options.onData) options.onData(text);
      }

      if (options.onEnd) options.onEnd();
      return;
    } catch (err: any) {
      if (options.onError) options.onError(err);
      else console.error("Gemini stream error:", err);
      return;
    }
  }
}
