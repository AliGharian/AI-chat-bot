import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { createClient } from "redis";
import { RedisVectorStore } from "@langchain/redis";
import { GoogleGenAI } from "@google/genai";
import weaviate, { WeaviateClient } from "weaviate-ts-client";
import dotenv from "dotenv";
import { WeaviateStore } from "@langchain/weaviate";
dotenv.config();

const apiKey = process.env.GEMINI_API_KEY || "";
const WEAVIATE_HOST = "84.200.192.243:8080";
const WEAVIATE_CLASS_NAME = "DocumentChunk";

export async function runSimilaritySearch(userQuery: string, k: number = 4) {
  const weaviateClient: any = weaviate.client({
    scheme: "http",
    host: WEAVIATE_HOST,
  });

  const isReady = await weaviateClient.misc.readyChecker().do();
  if (!isReady) {
    console.error("❌ Weaviate is not ready. Cannot perform search.");
    return [];
  }
  console.log("✅ Connected to Weaviate for search.");

  const embeddings = new GoogleGenerativeAIEmbeddings({
    model: "text-embedding-004",
    apiKey: apiKey,
  });

  const vectorStore = await WeaviateStore.fromExistingIndex(embeddings, {
    client: weaviateClient,
    indexName: WEAVIATE_CLASS_NAME,
    textKey: "content", // 💡 نام فیلد متنی در Schema
    metadataKeys: ["sourceKey", "metadataJson"], // 💡 فیلدهایی که برای Metadata ذخیره کردیم
  });

  console.log(`Searching Weaviate for documents similar to: "${userQuery}"...`);

  // LangChain برای Weaviate از متد similaritySearch استفاده می‌کند
  const results = await vectorStore.similaritySearch(userQuery, k);

  console.log(`\n🔎 Found ${results.length} relevant documents:`);

  results.forEach((doc, index) => {
    // 💡 در LangChain WeaviateStore، متادیتا مستقیماً به doc.metadata تزریق می‌شود
    console.log(`--- Document ${index + 1} ---`);
    console.log(`Source Key: ${doc.metadata.sourceKey}`);
    // محتوای metadataJson باید پارس شود تا عنوان اصلی استخراج شود
    try {
      const meta = JSON.parse(doc.metadata.metadataJson as string);
      console.log(`Title: ${meta.title}`);
    } catch (e) {
      console.log(`Title: (Metadata Parse Error)`);
    }
    console.log(`Content Snippet: ${doc.pageContent.substring(0, 150)}...`);
  });

  return results;
}

const ai = new GoogleGenAI({ apiKey: apiKey });

function formatContext(documents: any[]): string {
  const context = documents
    .map((doc) => {
      // 💡 اصلاح: پارس کردن metadataJson برای دسترسی به Title
      let title = "N/A";
      try {
        const meta = JSON.parse(doc.metadata.metadataJson as string);
        title = meta.title || "N/A";
      } catch (e) {
        // اگر پارس نشود، از N/A استفاده می‌کنیم
      }

      // ساختاردهی برای خوانایی بهتر توسط LLM
      return `[TITLE: ${title}]\n${doc.pageContent}\n---`;
    })
    .join("\n");

  return context.trim();
}

export async function generateResponseWithRAG(userQuery: string) {
  // الف. بازیابی اسناد مرتبط (گام Retrieval)
  const relevantDocuments = await runSimilaritySearch(userQuery, 8);
  console.log("RELEVENT DOCS IS: ", JSON.stringify(relevantDocuments));

  if (!relevantDocuments || relevantDocuments.length === 0) {
    return "متأسفانه منبع مرتبطی در پایگاه دانش ما پیدا نشد.";
  }

  const contextText = formatContext(relevantDocuments);

  console.log("Context is: ", contextText);
  const prompt = `
        شما یک دستیار متخصص در زمینه بازارهای مالی و تحلیل تکنیکال هستید. 
        فقط بر اساس 'CONTEXT' زیر، به 'USER_QUERY' پاسخ دهید. 
        پاسخ شما باید جامع، محترمانه و به زبان فارسی روان باشد.

        --- CONTEXT ---
        ${contextText}
        --- USER_QUERY ---
        ${userQuery}
    `;

  console.log("📝 Sending final prompt to Gemini for generation...");

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash", // یا gemini-2.5-pro
    contents: prompt,
  });

  const finalAnswer = response.text;

  console.log("✅ Final Answer from LLM received.");
  return finalAnswer;
}
