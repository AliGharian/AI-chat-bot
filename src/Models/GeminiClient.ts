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

/* ---------- GeminiClient (robust) ---------- */
export class GeminiClient {
  private client: GoogleGenAI;

  constructor(apiKey: string) {
    this.client = new GoogleGenAI({ apiKey });
  }

  private wait(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /* ---------- Execute local actions/tools ---------- */
  private async executeAction(name: string, args: any) {
    if (name === "scrapePage") {
      // args may be string or object depending on model
      const url = typeof args === "string" ? args : args?.url;
      return await scrapePage(url);
    }
    throw new Error("Unknown action: " + name);
  }

  /* ---------- Main generateText ---------- */
  async generateText(options: GenerateOptions): Promise<void> {
    const model = options.model ?? "gemini-2.5-flash";

    const SYSTEM_INSTRUCTION = [
      "You are SafeGPT, the official assistant of SafeBroker.org. Talk friendly and concise.",
      "If the user asks about the current webpage, call scrapePage with {url}.",
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
        console.log("GeminiClient: attempt", attempts);

        // COUNT TOKENS (optional)
        try {
          const t = await this.client.models.countTokens({
            model,
            contents: options.prompt,
          });
          console.log("Token count:", t.totalTokens);
        } catch (e) {
          // not fatal; continue
        }

        /* ---------- STEP 1: initial request (user) ---------- */
        const firstResponse = await this.client.models.generateContent({
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
              parts: [{ text: options.prompt }],
            },
          ],
        });

        // Extract potential functionCall from model output
        const callPart = firstResponse.candidates?.[0]?.content?.parts?.find(
          (p: any) => p.functionCall
        );

        // If no function call, stream normal reply directly (user -> model streaming)
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

          for await (const ev of stream) {
            const text = ev?.candidates?.[0]?.content?.parts
              ?.map((p: any) => p.text)
              ?.join("");
            if (text && options.onData) options.onData(text);
          }

          if (options.onEnd) options.onEnd();
          return;
        }

        /* ---------- STEP 2: we have a functionCall from the model ---------- */
        const rawFunctionCall = callPart.functionCall;
        const actionName = rawFunctionCall?.name;
        let actionArgs = rawFunctionCall?.args;

        // args sometimes arrive as a stringified JSON
        if (typeof actionArgs === "string") {
          try {
            actionArgs = JSON.parse(actionArgs);
          } catch (e) {
            // leave as string if not JSON
          }
        }

        if (!actionName) throw new Error("Invelid action name");
        
        // Execute the action locally
        const toolResult = await this.executeAction(actionName, actionArgs);

        // Make sure result is JSON-serializable
        let serializableResult: any;
        try {
          JSON.stringify(toolResult);
          serializableResult = toolResult;
        } catch {
          serializableResult = String(toolResult);
        }

        /* ---------- STEP 3: FOLLOW-UP — obey Gemini parity rule ----------
           To satisfy "function response turn comes immediately after a function call turn"
           we include two consecutive content entries:
           1) role: "model" with the exact functionCall the model produced
           2) role: "function" with functionResponse containing the tool result
           This preserves the conversational turn order and avoids the 400 error.
        ------------------------------------------------------------------*/

        const followupContents = [
          // Recreate the model turn that did the functionCall (important for parity)
          {
            role: "model",
            parts: [
              {
                functionCall: rawFunctionCall,
              } as any,
            ],
          },
          // Immediately follow with the function response turn
          {
            role: "function",
            parts: [
              {
                functionResponse: {
                  name: actionName,
                  response: { result: serializableResult },
                },
              } as any,
            ],
          },
        ];

        // Now stream the model's continuation (the assistant's final answer)
        const followStream = await this.client.models.generateContentStream({
          model,
          // NOTE: we intentionally avoid adding additional user/system messages
          // The config object may omit tools/system to reduce risk of parity issues.
          config: {
            // In some SDK/server setups, re-declaring tools is optional. If your
            // deployment requires it, add toolDeclarations here.
            temperature: options.temperature,
            topP: options.topP,
            maxOutputTokens: options.maxOutputTokens,
          },
          contents: followupContents,
        });

        for await (const ev of followStream) {
          const text = ev?.candidates?.[0]?.content?.parts
            ?.map((p: any) => p.text)
            ?.join("");
          if (text && options.onData) options.onData(text);
        }

        if (options.onEnd) options.onEnd();
        return;
      } catch (err: any) {
        // retry 503
        const code = err?.status || err?.code;
        console.warn("GeminiClient error:", code || err?.message || err);
        if ((code === 503 || code === "503") && attempts < maxAttempts) {
          const waitMs = attempts * 1000;
          console.warn(`503 — retrying after ${waitMs} ms`);
          await this.wait(waitMs);
          continue;
        }

        if (options.onError) options.onError(err);
        else console.error("GeminiClient final error:", err);

        return;
      }
    } // while
  } // generateText
}
