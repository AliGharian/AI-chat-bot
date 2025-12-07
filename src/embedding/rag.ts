import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { createClient } from "redis";
import { RedisVectorStore } from "@langchain/redis";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
dotenv.config();

const apiKey = "AIzaSyDDlkniK1lUMiZFb4x-F-bvROYeQfPe1ww";
const redisPass = process.env.REDIS_PASSWORD || "";
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
    const results = await vectorStore.similaritySearchWithScore(userQuery, k);

    console.log(`\n🔎 Found ${results.length} relevant documents:`);

    // 🚨 کد اصلاح شده: بررسی وجود _score در metadata
    results.forEach(([doc, score], index) => {
      const formattedScore = score;

      console.log(`--- Document ${index + 1} (Score: ${formattedScore}) ---`);
      console.log(`Title: ${JSON.stringify(doc)}`);
      // console.log(`Title: ${doc.metadata.title}`);
      // console.log(`Slug: ${doc.metadata.slug}`);
      // نمایش بخشی از محتوا
      // console.log(`Content Snippet: ${doc.pageContent.substring(0, 150)}...`);
    });

    const relevantDocs = results.map(([doc]) => doc);
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

// // 🎯 پرسش آزمایشی شما
// runSimilaritySearch(
//   "بهترین روش‌های برنامه‌ریزی مالی برای کسب‌وکارهای کوچک کدامند؟",
//   5
// ).then(() => console.log("\nSearch process finished."));

// const relevant = [
//   {
//     pageContent: "اسپرد چیست؟",
//     metadata: {
//       id: "664f16bbd47be13182c9f8b6",
//       title: "کمترین اسپرد آلپاری + کمیسیون حساب ecn آلپاری",
//       slug: "alpari-spread",
//       loc: { lines: { from: 11, to: 11 } },
//     },
//   },
//   {
//     pageContent: "اسکالپ چیست؟",
//     metadata: {
//       id: "67319616ae188247704b5678",
//       title: "اسکالپ در ترید چیست؟ + بهترین استراتژی اسکالپینگ",
//       slug: "what-is-scalp",
//       loc: { lines: { from: 3, to: 3 } },
//     },
//   },
//   {
//     pageContent: "قراردادهای مشتقه",
//     metadata: {
//       id: "6742df361c2418ec2ba29b1c",
//       title:
//         "بازار نوظهور (emerging market) چیست؟ + مقایسه بازارهای نوظهور و بازارهای توسعه یافته",
//       slug: "what-is-emerging-market",
//       loc: { lines: { from: 66, to: 66 } },
//     },
//   },
//   {
//     pageContent: "نوع بروکر",
//     metadata: {
//       id: "6757fd1cffe0c998b6cc487e",
//       title: "بهترین بروکرهای فارکس برای ایرانیان در سال 2025",
//       slug: "best-brokers-2025",
//       loc: { lines: { from: 43, to: 43 } },
//     },
//   },
//   {
//     pageContent: "تحلیل فاندامنتال",
//     metadata: {
//       id: "676d2c96c27689b5d95aae14",
//       title: "انواع تحلیل در فارکس چیست؟ + روش های تحلیلی بازار فارکس",
//       slug: "types-of-analysis-in-forex",
//       loc: { lines: { from: 18, to: 18 } },
//     },
//   },
//   {
//     pageContent: "اروپای شمالی",
//     metadata: {
//       id: "683426aa356685ef51318b4e",
//       title: "رگوله یا رگولیشن چیست؟ + مهم ترین نهادهای رگولاتوری در جهان",
//       slug: "what-is-regulation",
//       loc: { lines: { from: 32, to: 32 } },
//     },
//   },
//   {
//     pageContent: "اروپای شرقی",
//     metadata: {
//       id: "683426aa356685ef51318b4e",
//       title: "رگوله یا رگولیشن چیست؟ + مهم ترین نهادهای رگولاتوری در جهان",
//       slug: "what-is-regulation",
//       loc: { lines: { from: 36, to: 36 } },
//     },
//   },
//   {
//     pageContent: "اروپای جنوبی",
//     metadata: {
//       id: "683426aa356685ef51318b4e",
//       title: "رگوله یا رگولیشن چیست؟ + مهم ترین نهادهای رگولاتوری در جهان",
//       slug: "what-is-regulation",
//       loc: { lines: { from: 40, to: 40 } },
//     },
//   },
// ];
