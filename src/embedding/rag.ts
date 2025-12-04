import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { createClient } from "redis";
import { RedisVectorStore } from "@langchain/redis";

const apiKey = "AIzaSyDwlu_bOrGnAcDbbEWKEJ2WCSAXv2a8v7E";
const redisPass = "ChRj72nuujSCW5z92XDVGitu";
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

    const relevantDocs = await vectorStore.similaritySearch(userQuery, k);

    console.log(`\n🔎 Found ${relevantDocs.length} relevant documents:`);

    relevantDocs.forEach((doc, index) => {
      console.log(
        `--- Document ${index + 1} (Score: ${doc.metadata._score.toFixed(
          4
        )}) ---`
      );
      console.log(`Title: ${doc.metadata.title}`);
      console.log(`Slug: ${doc.metadata.slug}`);

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

// // 🎯 پرسش آزمایشی شما
// runSimilaritySearch(
//   "بهترین روش‌های برنامه‌ریزی مالی برای کسب‌وکارهای کوچک کدامند؟",
//   5
// ).then(() => console.log("\nSearch process finished."));
