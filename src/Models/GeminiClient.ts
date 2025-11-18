import { GoogleGenAI } from "@google/genai";

interface GenerateOptions {
  model?: string;
  prompt: string;
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
  onData?: (chunk: string) => void;
  onEnd?: () => void;
  onError?: (err: any) => void;
}

export class GeminiClient {
  private client: GoogleGenAI;

  constructor(apiKey: string) {
    this.client = new GoogleGenAI({ apiKey });
  }

  private wait(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async generateText(options: GenerateOptions): Promise<void> {
    const model = options.model ?? "gemini-2.5-flash";

    const SYSTEM_INSTRUCTION = [
      "You are SafeGPT, the official assistant of SafeBroker.org. Talk friendly with users.",
    ];

    let attempts = 0;
    const maxAttempts = 5;

    while (attempts < maxAttempts) {
      try {
        attempts++;

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
        return; // موفق شد → خارج شو
      } catch (err: any) {
        const code = err?.status || err?.code || err?.error?.code;

        // فقط روی 503 Retry کن
        if (code === 503 && attempts < maxAttempts) {
          const waitTime = attempts * 1000; // Exponential-ish backoff
          console.warn(
            `Gemini 503 detected. Retry in ${waitTime} ms (attempt ${attempts})`
          );
          await this.wait(waitTime);
          continue;
        }

        // اگر غیر از 503 بود یا 5 بار تلاش تمام شد
        if (options.onError) options.onError(err);
        else console.error("Gemini stream error:", err);
        return;
      }
    }
  }
}
