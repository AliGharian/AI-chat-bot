import { Document } from "@langchain/core/documents";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { fetchBlogPostsFromMongo } from "./data";
import { ObjectId } from "mongodb";
import { createClient } from "redis";
import { RedisVectorStore } from "@langchain/redis";
import { GoogleGenAI } from "@google/genai";

const apiKey = "AIzaSyDwoBG-uWofAMKjCCwBebUyGTfWNm3trPc";
const redisPass = "ChRj72nuujSCW5z92XDVGitu";

function extractTextFromChildren(children: any[]): string {
  return children
    .map((child) => {
      // 1. Base case: If the 'text' field exists, return its content.
      if (child.text) {
        return child.text;
      }

      // 2. Recursive step: If the node has its own 'children' (e.g., nested formatting or blocks),
      //    call the function again to extract text from that layer.
      if (child.children && Array.isArray(child.children)) {
        return extractTextFromChildren(child.children);
      }

      // Ignore other complex nodes (like empty objects)
      return "";
    })
    .join(" ");
}

function extractRawText(contentBlocks: any): string {
  let rawText = "";

  const blocks: any[] = JSON.parse(contentBlocks);
  console.log("Data:", typeof blocks);
  for (const block of blocks) {
    console.log("Block Type:", block.type);
    // Skip non-textual blocks like images and custom components (CTAs).
    if (["image", "target"].includes(block.type)) {
      // Optional: Include caption text if available
      if (block.caption) {
        rawText += `[Caption: ${block.caption}]\n`;
      }
      continue;
    }

    // 🎯 Special handling for list blocks (e.g., bulleted-list)
    if (block.type && ["list"].includes(block.type) && block.children) {
      block.children.forEach((listItem: any) => {
        if (listItem.type === "list-item" && listItem.children) {
          const listItemText = extractTextFromChildren(listItem.children);
          // Use a marker for list items to maintain structure
          rawText += `* ${listItemText}\n`;
        }
      });
      rawText += "\n"; // Add spacing after the list
      continue;
    }

    // General handling for textual blocks (paragraph, heading, etc.)
    if (block.children && Array.isArray(block.children)) {
      const extracted = extractTextFromChildren(block.children);

      // Only add text if content was actually extracted
      if (extracted.trim().length > 0) {
        // Add double newline to clearly separate chunks during splitting
        rawText += extracted + "\n\n";
      }
    }
  }

  return rawText.trim();
}

const BATCH_SIZE = 90;

function chunkArray<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

async function indexBlogPosts() {
  const ai = new GoogleGenAI({ apiKey });

  // Fetch blog post data from MongoDB
  const blogPostData: any[] = await fetchBlogPostsFromMongo();

  // Connect to the redis
  const redisClient: any = createClient({
    url: `redis://default:${redisPass}@84.200.192.243:6379`,
  });

  redisClient.on("error", (err: any) =>
    console.error("Redis Client Error", err)
  );

  await redisClient.connect();
  console.log("Connected to Redis Stack Server.");
  // ------------------------------------------
  console.log("Starting the embedding and indexing process...");

  const embeddings = new GoogleGenerativeAIEmbeddings({
    model: "text-embedding-004",
    apiKey: apiKey,
  });

  console.log("First blog post data:  ", blogPostData[0].content); // 1.1: تولید Raw Docs

  const rawDocs: Document[] = blogPostData.map((post) => {
    const cleanedContent = extractRawText(post.content);

    return new Document({
      pageContent: cleanedContent,
      metadata: {
        id: post._id.toString(), // 💡 Object ID به string تبدیل شد
        title: post.title,
        slug: post.slug,
      },
    });
  });

  console.log(`Total raw blog posts fetched: ${rawDocs.length}`);
  console.log("Last raw document:", rawDocs[0]); // 1.2: تقسیم داکیومنت‌ها (Chunking)

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 500,
    chunkOverlap: 50,
  });

  const chunkedDocuments: any[] = await splitter.splitDocuments(rawDocs);

  console.log(`Blog posts after chunking: ${chunkedDocuments.length}`); // 1.3: آماده‌سازی Batching

  const chunkedBatches = chunkArray(chunkedDocuments, BATCH_SIZE);
  let indexedCount = 0;

  console.log(
    `Starting batched embedding in ${chunkedBatches.length} batches (size: ${BATCH_SIZE})...`
  );

  const vectorStore = new RedisVectorStore(embeddings, {
    redisClient: redisClient, // 💡 استفاده از client بجای redisClient
    indexName: "bluechart_blog_vectors",
  });

  for (const batch of chunkedBatches) {
    const batchTexts = batch.map((doc) => doc.pageContent);

    const response: any = await ai.models.embedContent({
      model: "text-embedding-004",
      contents: batchTexts,
    });

    const correctedVectors = response.embeddings.map((v: any) => v.values);

    await vectorStore.addVectors(correctedVectors, batch);

    indexedCount += batch.length;
    console.log(
      `✅ Indexed ${indexedCount} out of ${chunkedDocuments.length} chunks. (Batch size: ${batch.length})`
    );
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  await redisClient.disconnect();

  console.log("Blog posts have been embedded and indexed successfully.");
}

indexBlogPosts().catch(console.error);
