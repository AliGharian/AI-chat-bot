import { GoogleGenAI } from "@google/genai";

// ⚠️ مطمئن شوید که کلید API در اینجا درست است
const apiKey = "AIzaSyBJpnMc7Rg02TLIH8wdaC_CSqtcF_cwivI";
const ai = new GoogleGenAI({ apiKey });

async function testApiDirectly() {
  const documents: any = [
    "این یک پاراگراف آزمایشی است.",
    "پاراگراف دوم برای تست امبدینگ.",
  ];

  console.log("Starting direct API test...");

  try {
    const response = await ai.models.embedContent({
      model: "text-embedding-004",
      contents: documents.map((text: any) => ({ content: text })),
    });

    const vectors: any[] = response.embeddings ?? [];

    if (vectors && vectors.length === 2 && vectors[0].values.length > 0) {
      console.log("✅ TEST SUCCESS: API returned valid vectors directly.");
      console.log(`Vector dimension: ${vectors[0].values.length}`);
    } else {
      console.error(
        "❌ TEST FAILED: API returned zero or empty vectors in response."
      );
    }
  } catch (error) {
    // این بلاک CRITICAL ERROR را نشان می‌دهد
    console.error("❌ CRITICAL ERROR IN API CALL (Check Key/Quota):", error);
  }
}

testApiDirectly();
