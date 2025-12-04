import { GoogleGenAI } from "@google/genai";

// ⚠️ این کلید باید همان کلید اصلی شما باشد
const apiKey = "AIzaSyBJpnMc7Rg02TLIH8wdaC_CSqtcF_cwivI";
const ai = new GoogleGenAI({ apiKey });

async function testApiDirectly() {
  const documents = [
    "این یک پاراگراف آزمایشی است.",
    "پاراگراف دوم برای تست امبدینگ.",
  ];

  console.log("Starting direct API test with corrected payload structure...");

  try {
    const response = await ai.models.embedContent({
      model: "text-embedding-004",
      contents: documents,
    });

    const vectors = response.embeddings;

    console.log("✅ API Call Successful. Vectors received: ", vectors);
  } catch (error) {
    console.error("❌ CRITICAL ERROR IN API CALL (Check Key/Quota):", error);
  }
}

// ⚠️ مطمئن شوید که GoogleGenerativeAI را درست Import کرده‌اید (طبق آخرین راه‌حل)
// اگر همچنان خطا می‌دهد، باید آن را اجرا کنید.
// testApiDirectly();
