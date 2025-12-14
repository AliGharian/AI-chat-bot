import {
  GoogleGenAI,
  ToolListUnion,
  ContentListUnion,
  GenerateContentConfig,
} from "@google/genai";
import {
  formatContext,
  getAssetPrice,
  getForexEconomicNews,
  runSimilaritySearch,
  scrapePage,
} from "../utils";
import { SYSTEM_INSTRUCTION } from "./systemInstruction";
import { FUNCTION_DECLARATION } from "./functionDeclaration";

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

    if (name === "searchKnowledgeBase") {
      const documents = await runSimilaritySearch(args.query, args.k);
      const contextString = formatContext(documents);
      if (!contextString) {
        return "No relevant documents found in the knowledge base. Try to answer the user query based on common knowledge.";
      }
      return contextString;
    }

    throw new Error("Unknown action: " + name);
  }

  async generateText(options: GenerateOptions): Promise<void> {
    const model = options.model ?? "gemini-2.5-flash";
    const userQuery = options.prompt;
    const history = options.history ?? "";
    const pageUrl = options.pageUrl ?? "";
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

    const relevantDocuments = await runSimilaritySearch(userQuery, 5);
    const context = formatContext(relevantDocuments);
    console.log("Context text is: ", context);
    const initialPrompt: string = `
        Instructions:
        1. [RAG Focus] Use the available 'searchKnowledgeBase' function ONLY if the USER_QUERY is specific and requires retrieving information from the internal knowledge base (e.g., technical guides, broker details, specific financial strategies).
        
        2. [Tool Action] When calling 'searchKnowledgeBase', **ALWAYS ensure the 'query' parameter is a self-contained, high-quality, and complete statement that combines the current 'USER_QUERY' and the 'chat history' context.** The query should be formatted like a blog post title for better semantic matching.
        
        3. [Other Tools] If the answer is common knowledge or requires external data (like news or price), use the other available tools.
        4. If no tool is required, answer directly.
        5. The final response must be comprehensive, respectful, and fluent in Persian (Farsi).

        Current Page URL: "${pageUrl ?? ""}"

        This is the chat history between the user and the assistant:
        ${history}
        
        USER_QUERY:
        ${userQuery}
    `;

    const contents: ContentListUnion = [
      {
        role: "user",
        parts: [
          {
            text: initialPrompt,
          },
        ],
      },
    ];

    console.log("First content is: ", JSON.stringify(contents));

    try {
      /* ---------- First Step Call the Model ---------- */
      const response = await this.client.models.generateContent({
        model,
        config,
        contents,
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

        const followupContents: ContentListUnion = [
          ...contents,
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
