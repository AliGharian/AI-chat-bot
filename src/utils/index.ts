import axios from "axios";

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
