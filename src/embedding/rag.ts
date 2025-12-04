import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { createClient } from "redis";
import { RedisVectorStore } from "@langchain/redis";
import { GoogleGenAI } from "@google/genai";

const apiKey = "AIzaSyDDlkniK1lUMiZFb4x-F-bvROYeQfPe1ww";
const redisPass = "phoh7aeXEeruPae3eeb8eiX2daa3Eevu";
const REDIS_URL = `redis://default:${redisPass}@84.200.192.243:6379`;

export async function runSimilaritySearch(userQuery: string, k: number = 4) {
  const redisClient: any = createClient({ url: REDIS_URL });

  redisClient.on("error", (err: any) =>
    console.error("Redis Client Error", err)
  );

  try {
    await redisClient.connect();
    console.log("✅ Connected to Redis for search.");

    const embeddings = new GoogleGenerativeAIEmbeddings({
      model: "text-embedding-004",
      apiKey: apiKey,
    });

    const vectorStore = new RedisVectorStore(embeddings, {
      redisClient: redisClient,
      indexName: "bluechart_blog_vectors",
    });

    console.log(`Searching Redis for documents similar to: "${userQuery}"...`);

    // 3. اجرای جستجوی تشابهی
    const relevantDocs = await vectorStore.similaritySearchWithScore(userQuery, k);

    console.log(`\n🔎 Found ${relevantDocs.length} relevant documents:`);
    console.log(`\n🔎 Relevent docs is:  ${relevantDocs}`);

    // 🚨 کد اصلاح شده: بررسی وجود _score در metadata
    relevantDocs.forEach(([doc, score], index) => {
      const formattedScore = score

      console.log(`--- Document ${index + 1} (Score: ${formattedScore}) ---`);
      console.log(`Title: ${doc.metadata.title}`);
      console.log(`Slug: ${doc.metadata.slug}`);
      // نمایش بخشی از محتوا
      console.log(`Content Snippet: ${doc.pageContent.substring(0, 150)}...`);
    });

    return relevantDocs;
  } catch (error) {
    console.error("❌ ERROR DURING SEARCH:", error);
  } finally {
    if (redisClient && redisClient.isOpen) {
      await redisClient.disconnect();
    }
  }
}

const ai = new GoogleGenAI({ apiKey: apiKey });

function formatContext(documents: any[]): string {
  const context = documents
    .map((doc) => {
      // ساختاردهی برای خوانایی بهتر توسط LLM
      return `[TITLE: ${doc.metadata.title}]\n${doc.pageContent}\n---`;
    })
    .join("\n");

  return context.trim();
}

export async function generateResponseWithRAG(userQuery: string) {
  // الف. بازیابی اسناد مرتبط (گام Retrieval)
  const relevantDocuments = await runSimilaritySearch(userQuery, 5);

  if (!relevantDocuments || relevantDocuments.length === 0) {
    return "متأسفانه منبع مرتبطی در پایگاه دانش ما پیدا نشد.";
  }

  // ب. فرمت‌دهی اسناد بازیابی شده به یک رشته قابل ارسال
  const contextText = formatContext(relevantDocuments);

  const prompt = `
        شما یک دستیار متخصص در زمینه بازارهای مالی و تحلیل تکنیکال هستید. 
        فقط بر اساس 'CONTEXT' زیر، به 'USER_QUERY' پاسخ دهید. 
        پاسخ شما باید جامع، محترمانه و به زبان فارسی روان باشد.
        اگر پاسخ در 'CONTEXT' یافت نشد، بنویسید که اطلاعات کافی در دسترس نیست.

        --- CONTEXT ---
        ${contextText}
        --- USER_QUERY ---
        ${userQuery}
    `;

  console.log("📝 Sending final prompt to Gemini for generation...");

  // ت. ارسال به LLM برای تولید پاسخ (گام Generation)
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash", // یا gemini-2.5-pro
    contents: prompt,
  });

  // ث. استخراج و نمایش پاسخ نهایی
  const finalAnswer = response.text;

  console.log("✅ Final Answer from LLM received.");
  return finalAnswer;
}

// // 🎯 پرسش آزمایشی شما
// runSimilaritySearch(
//   "بهترین روش‌های برنامه‌ریزی مالی برای کسب‌وکارهای کوچک کدامند؟",
//   5
// ).then(() => console.log("\nSearch process finished."));
