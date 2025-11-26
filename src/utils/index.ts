import axios from "axios";
import { IMessage } from "../types";

export function extractUrl(text: string): string | null {
  const regex = /(https?:\/\/[^\s]+)/g;
  const match = text.match(regex);
  return match ? match[0] : null;
}

export async function fetchPageContent(url: string) {
  try {
    const res = await axios.get(url, {
      timeout: 8000,
      headers: {
        "User-Agent": "Mozilla/5.0",
      },
    });
    return res.data; // HTML
  } catch (err) {
    console.error("Fetch error:", err);
    return null;
  }
}

export function stripHtml(html: string) {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<\/?[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildHistoryPrompt(messages: IMessage[]) {
  return messages
    .map((m) => `${m.role === "USER" ? "user" : "model"}: ${m.text}`)
    .join("\n");
}

export async function scrapePage(url: string): Promise<string> {
  try {
    const html = await fetch(url).then((res) => res.text());
    const clean = html.replace(/<[^>]*>?/gm, " "); // ساده‌ترین پاکسازی
    return clean.substring(0, 20000);
  } catch (err) {
    return "Error scraping page.";
  }
}

export async function getAssetPrice(symbol: string) {
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

export async function getForexEconomicNews(args: {
  countryCodes: string;
  startDate: string;
  endDate: string;
}) {
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
