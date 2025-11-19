import { GoogleGenAI, Type, Part } from "@google/genai";
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

    const SYSTEM_INSTRUCTION = [
      "You are SafeGPT, the official assistant of SafeBroker.org. Talk friendly with users.",
      "If user asks questions about the current webpage, call the scrapePage action using the provided pageUrl.",
    ];

    // const countTokensResponse = await this.client.models.countTokens({
    //   model: model,
    //   contents: options.prompt,
    // });
    // console.log("Token Number: ", countTokensResponse.totalTokens);
    try {
      /* ---------- First Step Call the Model ---------- */
      const response = await this.client.models.generateContent({
        model,
        config: {
          tools: [
            {
              functionDeclarations: [
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
              ],
            },
          ],
          systemInstruction: SYSTEM_INSTRUCTION,
          temperature: options.temperature,
          topP: options.topP,
          maxOutputTokens: options.maxOutputTokens,
        },
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `
                      پیام کاربر:
                      ${options.prompt}

                      آدرس صفحه فعلی کاربر:
                      ${options.pageUrl ?? "unknown"}

                      اگر سوال مربوط به صفحه بود باید اکشن scrapePage را صدا بزنی.
                  `,
              },
            ],
          },
        ],
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

        const toolResult = await this.executeAction(actionName, actionArgs);

        const functionResponsePart = {
          name: actionName,
          response: {
            result: toolResult,
          },
        };

        const followupContents = [
          {
            role: "function",
            parts: [
              {
                functionResponse: functionResponsePart,
              } as any,
            ],
          },
        ];

        // send follow-up to model
        const stream = await this.client.models.generateContentStream({
          model,
          config: {
            tools: [
              {
                functionDeclarations: [
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
                ],
              },
            ],
            systemInstruction: SYSTEM_INSTRUCTION,
            temperature: options.temperature,
            topP: options.topP,
            maxOutputTokens: options.maxOutputTokens,
          },
          contents: followupContents,
        });

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
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          temperature: options.temperature,
          topP: options.topP,
          maxOutputTokens: options.maxOutputTokens,
        },
        contents: [
          {
            role: "user",
            parts: [{ text: options.prompt }],
          },
        ],
      });

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
