import {
  GoogleGenAI,
  ToolListUnion,
  ContentListUnion,
  GenerateContentConfig,
} from "@google/genai";
import { getAssetPrice, getForexEconomicNews, scrapePage } from "../utils";
import { SYSTEM_INSTRUCTION } from "./systemInstruction";
import { FUNCTION_DECLARATION } from "./functionDeclaration";

/* ---------- TYPES ---------- */
interface GenerateOptions {
  model?: string;
  prompt: string;
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

    const firstContent: ContentListUnion = [
      {
        role: "user",
        parts: [
          {
            text: `
          CONTEXT_DATA:
          Current Page URL: "${options.pageUrl ?? ""}"

          USER_QUERY:
          ${options.prompt}
          
          Instructions:
          If the query requires reading the page, call scrapePage with the URL provided in CONTEXT_DATA.
        `,
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
