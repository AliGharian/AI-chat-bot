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
