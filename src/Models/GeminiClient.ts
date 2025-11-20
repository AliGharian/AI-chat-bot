import {
  GoogleGenAI,
  Type,
  FunctionDeclaration,
  ToolListUnion,
  ContentUnion,
  ContentListUnion,
  GenerateContentConfig,
} from "@google/genai";
import { scrapePage } from "../utils";

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

  /* ---------- Define Actions ---------- */

  /* ---------- Action Execution ---------- */
  private async executeAction(name: string, args: any) {
    if (name === "scrapePage") {
      return await scrapePage(args.url);
    }

    throw new Error("Unknown action: " + name);
  }

  /* ----------   Send Message + Action Manage + Stream   ---------- */
  async generateText(options: GenerateOptions): Promise<void> {
    const model = options.model ?? "gemini-2.5-flash-lite";

    // const countTokensResponse = await this.client.models.countTokens({
    //   model: model,
    //   contents: options.prompt,
    // });
    // console.log("Token Number: ", countTokensResponse.totalTokens);

    const SYSTEM_INSTRUCTION: ContentUnion = [
      "You are SafeGPT, the official assistant of SafeBroker.org. Talk friendly with users.",
      "If user asks questions about the current webpage, call the scrapePage action using the provided pageUrl.",
    ];

    const functionDeclarations: FunctionDeclaration[] = [
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
      // add more actions
    ];

    const tools: ToolListUnion = [
      {
        functionDeclarations,
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
              ${options.prompt}

              آدرس صفحه فعلی کاربر:
              ${options.pageUrl ?? "unknown"}
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
          // <--- این خط بسیار مهم است (پیام اولیه کاربر)
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
