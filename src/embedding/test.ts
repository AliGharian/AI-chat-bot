import { GoogleGenAI } from "@google/genai";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { RedisVectorStore } from "@langchain/redis";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { Document } from "langchain";
import { createClient } from "redis";

// ⚠️ این کلید باید همان کلید اصلی شما باشد
const apiKey = "AIzaSyDmlac2OTGO1BDK08KVvLiDI5LeMcuWMDw";
const ai = new GoogleGenAI({ apiKey });

async function testApiDirectly() {
  const documents = [
    "این یک پاراگراف آزمایشی است.",
    "پاراگراف دوم برای تست امبدینگ.",
  ];

  console.log("Starting direct API test with corrected payload structure...");

  try {
    const embeddings = new GoogleGenerativeAIEmbeddings({
      model: "text-embedding-004",
      apiKey: apiKey,
    });

    const response = await ai.models.embedContent({
      model: "text-embedding-004",
      contents: documents,
    });

    const vectors: any = response.embeddings;

    console.log("Received embeddings from API:", vectors);

    const redisClient: any = createClient({
      url: "redis://:ChRj72nuujSCW5z92XDVGitu@84.200.192.243:6379",
    });

    await redisClient.connect();

    const vectorStore = new RedisVectorStore(embeddings, {
      redisClient: redisClient,
      indexName: "bluechart_blog_vectors",
    });

    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 500,
      chunkOverlap: 50,
    });

    const rawDocs: Document[] = documents.map((post) => {
      return new Document({
        pageContent: post,
        metadata: {
          id: null,
          title: post,
          slug: post,
        },
      });
    });

    const chunkedDocuments: any[] = await splitter.splitDocuments(rawDocs);

    const correctedVectors = vectors.map((v: any) => v.values);

    console.log("Correct Vectors to be added to Redis:", correctedVectors);

     await redisClient.disconnect();
    await vectorStore.addVectors(correctedVectors, chunkedDocuments);
  } catch (error) {
    console.error("❌ CRITICAL ERROR IN API CALL (Check Key/Quota):", error);
  }
}

// ⚠️ مطمئن شوید که GoogleGenerativeAI را درست Import کرده‌اید (طبق آخرین راه‌حل)
// اگر همچنان خطا می‌دهد، باید آن را اجرا کنید.
testApiDirectly();
