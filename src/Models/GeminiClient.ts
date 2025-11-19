import { GoogleGenAI, Type } from "@google/genai";
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

/* ---------- Gemini Client + Function Calling ---------- */
export class GeminiClient {
  private client: GoogleGenAI;

  constructor(apiKey: string) {
    this.client = new GoogleGenAI({ apiKey });
  }

  private wait(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /* ---------- Execute Action ---------- */
  private async executeAction(name: string, args: any) {
    if (name === "scrapePage") {
      return await scrapePage(args.url);
    }
    throw new Error("Unknown action: " + name);
  }

  /* ---------- Generate Text + Tool Calling ---------- */
  async generateText(options: GenerateOptions): Promise<void> {
    const model = options.model ?? "gemini-2.5-flash";

    const SYSTEM_INSTRUCTION = [
      "You are SafeGPT, the official assistant of SafeBroker.org.",
      "If the user asks anything about the current webpage, call scrapePage with pageUrl.",
    ];

    const toolDeclarations = [
      {
        functionDeclarations: [
          {
            name: "scrapePage",
            description: "Scrape webpage HTML and return readable plain text.",
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
    ];

    let attempts = 0;
    const maxAttempts = 5;

    while (attempts < maxAttempts) {
      try {
        attempts++;
        console.log("Attempts:", attempts);

        /* ---------- count tokens ---------- */
        const tokenCount = await this.client.models.countTokens({
          model,
          contents: options.prompt,
        });
        console.log("Tokens:", tokenCount.totalTokens);

        /* ---------- STEP 1 — send user request to Gemini ---------- */
        const first = await this.client.models.generateContent({
          model,
          config: {
            systemInstruction: SYSTEM_INSTRUCTION,
            tools: toolDeclarations,
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

آدرس صفحه فعلی:
${options.pageUrl ?? "unknown"}

اگر سوال مربوط به صفحه بود باید اکشن scrapePage را صدا بزنی.
`,
                },
              ],
            },
          ],
        });

        console.log("FIRST AI RESPONSE:", first);

        /* ---------- detect function call ---------- */
        const callPart = first.candidates?.[0]?.content?.parts?.find(
          (p: any) => p.functionCall
        );

        console.log("Call parts: ", first.candidates?.[0]?.content);
        /* ---------- NO FUNCTION CALL: just stream normally ---------- */
        if (!callPart) {
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
        }

        /* ---------- STEP 2 — functionCall exists ---------- */
        const actionName = callPart?.functionCall?.name;
        const actionArgs = callPart?.functionCall?.args;

        console.log("Function Call:", actionName, actionArgs);

        if (!actionName) throw new Error("There is No action name");
        const toolResult = await this.executeAction(actionName, actionArgs);

        /* ---------- STEP 3 — send ONLY functionResponse turn ---------- */

        const followStream = await this.client.models.generateContentStream({
          model,
          contents: [
            {
              role: "function",
              parts: [
                {
                  functionResponse: {
                    name: actionName,
                    response: { result: toolResult },
                  },
                } as any,
              ],
            },
          ],
        });

        for await (const event of followStream) {
          const text = event?.candidates?.[0]?.content?.parts
            ?.map((p) => p.text)
            ?.join("");

          if (text && options.onData) options.onData(text);
        }

        if (options.onEnd) options.onEnd();
        return;
      } catch (err: any) {
        // handle 503 retry
        if (
          (err?.status === 503 || err?.code === 503) &&
          attempts < maxAttempts
        ) {
          const w = attempts * 1000;
          console.warn(`503 from Gemini, retrying in ${w} ms`);
          await this.wait(w);
          continue;
        }

        if (options.onError) options.onError(err);
        else console.error("Gemini error:", err);
        return;
      }
    }
  }
}

// const GenerateContentResponse =  {
//     sdkHttpResponse: {
//       headers: {
//         'alt-svc': 'h3=":443"; ma=2592000,h3-29=":443"; ma=2592000',
//         'content-encoding': 'gzip',
//         'content-type': 'application/json; charset=UTF-8',
//         date: 'Wed, 19 Nov 2025 08:04:18 GMT',
//         server: 'scaffolding on HTTPServer2',
//         'server-timing': 'gfet4t7; dur=1767',
//         'transfer-encoding': 'chunked',
//         vary: 'Origin, X-Origin, Referer',
//         'x-content-type-options': 'nosniff',
//         'x-frame-options': 'SAMEORIGIN',
//         'x-xss-protection': '0'
//       }
//     },
//     candidates: [ { content: [Object], finishReason: 'STOP', index: 0 } ],
//     modelVersion: 'gemini-2.5-flash',
//     responseId: 'AnodafWJBJrunsEP093D6AI',
//     usageMetadata: {
//       promptTokenCount: 7414,
//       candidatesTokenCount: 82,
//       totalTokenCount: 7602,
//       promptTokensDetails: [ [Object] ],
//       thoughtsTokenCount: 106
//     }
//   }

//   const ActionCall =   {
//     name: 'scrapePage',
//     args: { url: 'https://safebroker.org/blog/how-add-indicator-mt4-mt5' }
//   }

//    const StreamError: ApiError = {"error":{"message":"{\n  \"error\": {\n    \"code\": 400,\n    \"message\": \"Please ensure that function response turn comes immediately after a function call turn.\",\n    \"status\": \"INVALID_ARGUMENT\"\n  }\n}\n","code":400,"status":"Bad Request"}}
//       at throwErrorIfNotOK (/var/www/ai-bot/node_modules/@google/genai/dist/node/index.cjs:11430:30)
//       at process.processTicksAndRejections (node:internal/process/task_queues:95:5)
//       at async /var/www/ai-bot/node_modules/@google/genai/dist/node/index.cjs:11183:13
//       at async Models.generateContentStream (/var/www/ai-bot/node_modules/@google/genai/dist/node/index.cjs:12572:24) {
//     status: 400
//   }
