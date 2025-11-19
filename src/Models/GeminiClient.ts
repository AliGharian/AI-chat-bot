import { GoogleGenAI, Type } from "@google/genai";
import { scrapePage } from "../utils";

export class GeminiClient {
  private client: GoogleGenAI;

  constructor(apiKey: string) {
    this.client = new GoogleGenAI({ apiKey });
  }

  private wait(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async executeAction(name: string, args: any) {
    if (name === "scrapePage") {
      return await scrapePage(args.url);
    }
    throw new Error("Unknown action: " + name);
  }

  async generateText(options: any): Promise<void> {
    const model = options.model ?? "gemini-2.5-flash";

    const SYSTEM_INSTRUCTION = [
      "You are SafeGPT, the assistant of SafeBroker.org.",
      "If user asks about the current webpage, call scrapePage.",
    ];

    let attempts = 0;
    const maxAttempts = 5;

    while (attempts < maxAttempts) {
      try {
        attempts++;

        /* STEP 1 — Send user message */
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
                      properties: { url: { type: Type.STRING } },
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
          contents: [
            {
              role: "user",
              parts: [{ text: options.prompt }],
            },
          ],
        });

        const actionCall = response.candidates?.[0]?.content?.parts?.find(
          (p: any) => p.functionCall
        )?.functionCall;

        /* NO ACTION → normal streaming */
        if (!actionCall) {
          const stream = await this.client.models.generateContentStream({
            model,
            config: {
              systemInstruction: SYSTEM_INSTRUCTION,
              temperature: options.temperature,
              topP: options.topP,
              maxOutputTokens: options.maxOutputTokens,
            },
            contents: [{ role: "user", parts: [{ text: options.prompt }] }],
          });

          for await (const event of stream) {
            const text =
              event?.candidates?.[0]?.content?.parts
                ?.map((p) => p.text)
                ?.join("") ?? "";
            if (text && options.onData) options.onData(text);
          }

          if (options.onEnd) options.onEnd();
          return;
        }

        /* THERE IS AN ACTION → EXECUTE IT */
        const actionName = actionCall.name;
        const actionArgs = actionCall.args;

        if (!actionName) throw new Error("Invalid action call name");
        const toolResult = await this.executeAction(actionName, actionArgs);

        /* GEMINI RULE:
           The very next message must be ONLY functionResponse.
        */
        const followup = [
          {
            role: "function",
            parts: [
              {
                functionResponse: {
                  name: actionName,
                  response: toolResult,
                },
              },
            ],
          },
        ];

        /* Send follow-up response */
        const stream2 = await this.client.models.generateContentStream({
          model,
          config: {
            tools: [
              {
                functionDeclarations: [
                  {
                    name: "scrapePage",
                    description: "Scrape webpage HTML",
                    parameters: {
                      type: Type.OBJECT,
                      properties: { url: { type: Type.STRING } },
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
          contents: followup.toString(),
        });

        for await (const event of stream2) {
          const text =
            event?.candidates?.[0]?.content?.parts
              ?.map((p) => p.text)
              ?.join("") ?? "";
          if (text && options.onData) options.onData(text);
        }

        if (options.onEnd) options.onEnd();
        return;
      } catch (err: any) {
        const code = err?.status || err?.code;

        if (code === 503 && attempts < maxAttempts) {
          await this.wait(attempts * 1000);
          continue;
        }

        if (options.onError) options.onError(err);
        else console.error(err);
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

const CallParts = {
  parts: [
    {
      functionCall: [Object],
      thoughtSignature:
        "CqIDAdHtim8QE8Qr8EQAnD3SR43Udiz5HIgzrqa0wM56pBNroZMSgeqil4S99nglp9EAZBEcltjb07nYAijhhbPmre+O0n4mAYHpgP6DoSveCm1DoxDjoalPiGMxyAsxpgwADoWf+2mdFNGAx2RydYS/zlP8Rt7nUHqB8kbx5HHDM66KdCof+ZGT+0rms7u0S++t17rvoZIg/IMCDnWuXXPq5GejIuB9OmbEqt0W8RILJ+TIgtPZ+sDavbyQhZssSe1ZKvR1JNAlqeWLCJohaJAK/8v8StoFIx1xUS11l0zHokhiTv4VWG0m5+4l6YTFOUShzMx/mXjdTLx1boHlmAxVS9KZrRcHgjaDYoFiEXjSAHm2HUDxqNbKj+FeVGVJ6PpcVjRv/V73bZVoIZ+NLxACalyX3XfNJLeZq//+VWQTZxYoH33xiqFeU4kALAzF3in8yE7LpH9e5pZ+znL+2VkDkEBPt4pXJrJZ6P2jNiNAqeNBq4Yh+2g2iVDOJj7Ysa4adYoMx0uI+D1Bq/BYw8AiyH15e9g4sFXJB+lbUp26vLZORg==",
    },
  ],
  role: "model",
};
