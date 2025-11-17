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

  async generateText(options: GenerateOptions): Promise<void> {
    const model = options.model ?? "gemini-2.5-flash";
    const SYSTEM_INSTRUCTION = [
      `You are SafeGPT, the official assistant of SafeBroker.org.Talk friendly with users.`,
    ];

    try {
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
    } catch (err) {
      if (options.onError) options.onError(err);
      else console.error("Gemini stream error:", err);
    }
  }
}
