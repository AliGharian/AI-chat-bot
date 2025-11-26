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

  /* ---------- Define Actions ---------- */
  // 👈 این تابع جدید را اضافه کنید
  private async getAssetPrice(symbol: string) {
    const apiUrl = "https://api.forexcalcs.com/prices.json";
    try {
      const response = await fetch(apiUrl);

      if (!response.ok) {
        return {
          success: false,
          result: `Error fetching price data: Status ${response.status}`,
        };
      }

      const data = await response.json();

      // طلا در این API با نماد "XAU/USD" یا "Gold/USD" مشخص نیست،
      // اما فرض می‌کنیم که API شما حاوی نماد مورد نظر برای اونس طلا باشد.
      // اگر نماد دقیق "XAU/USD" در لیست باشد، از آن استفاده می‌کنیم.
      // اگرچه در نمونه JSON شما وجود ندارد، اما برای منطق، آن را اضافه می‌کنیم.
      const asset = data.currencyPairs.find(
        (pair: any) =>
          pair.SymbolName.toUpperCase() === symbol.toUpperCase() ||
          pair.DisplaySymbolName.toUpperCase() === symbol.toUpperCase()
      );

      if (asset) {
        return {
          success: true,
          result: JSON.stringify({
            SymbolName: asset.SymbolName,
            SymbolRate: asset.SymbolRate,
            QuoteCurrency: asset.QuoteCurrency,
            FullName: asset.FullName,
          }),
        };
      }

      return {
        success: false,
        result: `Asset not found for symbol: ${symbol}. Available pairs are: ${data.currencyPairs
          .map((p: any) => p.SymbolName)
          .join(", ")}`,
      };
    } catch (error: any) {
      console.error("Asset price API call failed:", error);
      return {
        success: false,
        result: `An exception occurred during the API call: ${error.message}`,
      };
    }
  }
  /* ---------- Action Execution ---------- */
  private async executeAction(name: string, args: any) {
    if (name === "scrapePage") {
      return await scrapePage(args.url);
    }

    if (name === "getAssetPrice") {
      // 👈 شرط جدید برای فراخوانی API قیمت
      // برای اونس طلا، نماد استاندارد XAU/USD است
      const symbol = args.symbol || "XAU/USD";
      return await this.getAssetPrice(symbol);
    }

    if (name === "getForexEconomicNews") {
      const { countryCodes, startDate, endDate } = args;

      // تبدیل تاریخ‌ها به فرمت UTC با T00:00:00.000Z
      const fromDate = new Date(`${startDate}T00:00:00.000Z`).toISOString();
      const toDate = new Date(`${endDate}T23:59:59.999Z`).toISOString(); // تا پایان روز

      const url = new URL("https://economic-calendar.tradingview.com/events");

      // تنظیم پارامترها در URL
      url.searchParams.set("countries", countryCodes.toUpperCase());
      url.searchParams.set("from", fromDate);
      url.searchParams.set("to", toDate);

      try {
        const response = await fetch(url.toString(), {
          method: "GET",
          headers: {
            // هدر Origin مورد نیاز تریدینگ‌ویو
            Origin: "https://www.tradingview.com",
            "User-Agent": "Mozilla/5.0 (Custom Agent for SafeBroker)",
          },
        });

        if (!response.ok) {
          // اگر پاسخ موفقیت آمیز نبود
          return {
            success: false,
            result: `Error fetching news: Status ${response.status} - ${response.statusText}`,
          };
        }

        const data = await response.json();

        // تنها اطلاعات کلیدی را برای مدل برگردانید
        const simplifiedEvents = data.result.map((event: any) => ({
          id: event.id,
          date: event.date,
          country: event.country,
          title: event.title,
          importance: event.importance, // Low, Medium, High
          actual: event.actual,
          forecast: event.forecast,
          previous: event.previous,
        }));

        // نتیجه را به Gemini برگردانید تا خلاصه کند
        return {
          success: true,
          result: JSON.stringify(simplifiedEvents),
        };
      } catch (error: any) {
        console.error("TradingView API call failed:", error);
        return {
          success: false,
          result: `An exception occurred during the API call: ${error.message}`,
        };
      }
    }

    throw new Error("Unknown action: " + name);
  }

  /* ----------   Send Message + Action Manage + Stream   ---------- */
  async generateText(options: GenerateOptions): Promise<void> {
    const model = options.model ?? "gemini-2.5-flash";

    // add the today date to the
    const today = new Date();
    const year = today.getUTCFullYear();
    const month = String(today.getUTCMonth() + 1).padStart(2, "0");
    const day = String(today.getUTCDate()).padStart(2, "0");
    const currentDateString = `${year}-${month}-${day}`;

    // -------------------------------------------------------

    // const countTokensResponse = await this.client.models.countTokens({
    //   model: model,
    //   contents: options.prompt,
    // });
    // console.log("Token Number: ", countTokensResponse.totalTokens);

    const SYSTEM_INSTRUCTION: ContentUnion = [
      "You are SafeGPT, the official assistant of SafeBroker.org.",

      // 1. LANGUAGE PROTOCOL
      "LANGUAGE RULE: You MUST respond in the same language as the user. If the user writes in Persian (Farsi), your response MUST be in Persian.",
      "If the input is mixed (Persian + English terms), reply in Persian.",

      // 2. CONCISENESS
      "CORE RULE: Be extremely concise. Keep answers under 3-4 sentences.",

      // 3. ENGAGEMENT
      "ENGAGEMENT: Never end with a full stop. Always end with a relevant follow-up question or a suggestion to keep the conversation going.",

      // 4. TOOLS
      "If user asks questions about the current webpage, call the scrapePage action.",

      // 5. ADD CURRENT DATE
      `
      [CONTEXTUAL_RULES]
      **تاریخ امروز به فرمت YYYY-MM-DD عبارت است از: ${currentDateString}**
       **قوانین فراخوانی تابع getForexEconomicNews:**
      1. تو باید عبارت های زمانی نسبی (مثل "این هفته" یا "هفته آینده") را با استفاده از تاریخ امروز، به محدوده تاریخ دقیق YYYY-MM-DD تبدیل کنی. شروع هفته را روز **دوشنبه** در نظر بگیر.
      2. کدهای ارز (مثل یورو، دلار) را به کدهای کشور زیر نگاشت کن و به پارامتر countryCodes بفرست:
        یورو/EUR -> EU | دلار آمریکا/USD -> US | پوند/GBP -> GB | ین/JPY -> JP | دلار کانادا/CAD -> CA | دلار استرالیا/AUD -> AU | فرانک سوئیس/CHF -> CH | دلار نیوزیلند/NZD -> NZ.
      [/CONTEXTUAL_RULES]
      `,
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
      {
        name: "getAssetPrice",
        description:
          "Fetches the current real-time price for a specific asset symbol, like 'XAU/USD' for Gold Ounce (Oz) in USD.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            symbol: {
              type: Type.STRING,
              description:
                "The symbol for the asset (e.g., 'XAU/USD' for Gold, 'EUR/USD' for Euro/Dollar). Default to 'XAU/USD' if the user asks about the price of gold.",
            },
          },
          required: ["symbol"],
        },
      },
      {
        name: "getForexEconomicNews",
        description:
          "Fetches economic calendar events from TradingView for specific countries and date ranges.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            countryCodes: {
              type: Type.STRING,
              description:
                "A comma-separated string of country/currency codes (e.g., 'US,EU,JP,GB') mapped from the user's request.",
            },
            startDate: {
              type: Type.STRING,
              description:
                "The start date for the news fetch in ISO 8601 format (e.g., 'YYYY-MM-DD').",
            },
            endDate: {
              type: Type.STRING,
              description:
                "The end date for the news fetch in ISO 8601 format (e.g., 'YYYY-MM-DD').",
            },
          },
          required: ["startDate", "endDate"],
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
