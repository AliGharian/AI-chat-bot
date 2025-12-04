import { Document } from "@langchain/core/documents";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { fetchBlogPostsFromMongo } from "./data";
import { ObjectId } from "mongodb";
import { createClient } from "redis";
import { RedisVectorStore } from "@langchain/redis";
import { GoogleGenAI } from "@google/genai";

const apiKey = "AIzaSyDmlac2OTGO1BDK08KVvLiDI5LeMcuWMDw";
const redisPass = "ChRj72nuujSCW5z92XDVGitu";

/**
 * Recursively extracts text from nested 'children' arrays, handling inline formatting and nested blocks.
 * This is crucial for retrieving text hidden inside elements like links or bold tags in the block structure.
 * * @param children - The children array of a block (e.g., paragraph, heading, list item).
 * @returns A concatenated string of all text nodes.
 */
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

/**
 * Converts the complex, block-based content array from MongoDB into a single,
 * clean raw text string suitable for the LangChain Text Splitter.
 * * This function addresses the common bug where text content is left empty
 * due to improper handling of nested JSON block types.
 * * @param contentBlocks - The 'content' array from the MongoDB document.
 * @returns The cleaned raw text.
 */
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

const BATCH_SIZE = 90; // 👈 تعیین اندازه دسته: ۹۰ سند در هر فراخوانی (کمتر از ۱۰۰)

/**
 * 💡 تابع کمکی برای تقسیم آرایه‌ها به دسته‌های کوچکتر
 * @param arr - آرایه ورودی (مثل chunkedDocuments)
 * @param size - حداکثر تعداد آیتم‌ها در هر دسته
 */
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

  const cleanedDocuments: string[] = blogPostData.map((post) => {
    return extractRawText(post.content);
  });

  const embeddings = new GoogleGenerativeAIEmbeddings({
    model: "text-embedding-004",
    apiKey: apiKey,
  });

  const response = await ai.models.embedContent({
    model: "text-embedding-004",
    contents: cleanedDocuments,
  });

  console.log("First blog post data:  ", blogPostData[0].content);

  const rawDocs: Document[] = blogPostData.map((post) => {
    const cleanedContent = extractRawText(post.content);

    return new Document({
      pageContent: cleanedContent,
      metadata: {
        id: new ObjectId(post._id.toString()),
        title: post.title,
        slug: post.slug,
      },
    });
  });

  console.log(`Total raw blog posts fetched: ${rawDocs.length}`);
  console.log("Last raw document:", rawDocs[0]);

  // -----------------------------------------------------
  // Step 2: Split documents into smaller chunks
  // -----------------------------------------------------
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 500,
    chunkOverlap: 50,
  });

  const chunkedDocuments: any[] = await splitter.splitDocuments(rawDocs);

  console.log(`Blog posts after chunking: ${chunkedDocuments.length}`);

  // -----------------------------------------------------
  // Step 1: Chunking and batching data
  // -----------------------------------------------------
  const chunkedBatches = chunkArray(chunkedDocuments, BATCH_SIZE);
  let indexedCount = 0;

  console.log(
    `Starting batched embedding in ${chunkedBatches.length} batches (size: ${BATCH_SIZE})...`
  );

  const vectorStore = new RedisVectorStore(embeddings, {
    redisClient: redisClient,
    indexName: "bluechart_blog_vectors",
  });

  for (const batch of chunkedBatches) {
    // 3.1: استخراج متن‌ها برای API
    const batchTexts = batch.map((doc) => doc.pageContent);

    // 3.2: فراخوانی API با تعداد کم (زیر ۱۰۰)
    // 💡 نکته: ما از متد خام ai.models.embedContent استفاده می‌کنیم چون LangChain's
    // embedDocuments گاهی اوقات با batching مشکل دارد.
    const response: any = await ai.models.embedContent({
      model: "text-embedding-004",
      contents: batchTexts,
    });

    // 3.3: تصحیح ساختار وکتورها (API response format)
    const correctedVectors = response.embeddings.map((v: any) => v.values);

    // 3.4: ذخیره در Redis
    await vectorStore.addVectors(correctedVectors, batch);

    indexedCount += batch.length;
    console.log(
      `✅ Indexed ${indexedCount} out of ${chunkedDocuments.length} chunks. (Batch size: ${batch.length})`
    );

    // تأخیر کوتاه برای جلوگیری از Rate Limiting (اختیاری)
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  console.log(
    "✅ SUCCESS: All blog posts have been embedded and indexed successfully."
  );

  await redisClient.disconnect();

  // -----------------------------------------------------
  // Step 3: Generate embeddings and store in Redis
  // -----------------------------------------------------

  // const embeddings = new GoogleGenerativeAIEmbeddings({
  //   model: "text-embedding-004",
  //   apiKey: apiKey,
  // });

  // const chunksForTesting = chunkedDocuments.slice(0, 2);
  // let vectors: number[][] = [];
  // try {
  //   // تبدیل تمام داکیومنت‌ها به بردار
  //   vectors = await embeddings.embedDocuments(
  //     chunksForTesting.map((doc) => doc.pageContent)
  //   );
  //   console.log(
  //     `✅ Embeddings successfully generated. Total vectors received: ${vectors.length}`
  //   );

  //   if (vectors.length > 0) {
  //     console.log(`First vector dimension: ${vectors[0].length}`);
  //     console.log(
  //       `First 5 numbers of the first vector: ${vectors[0].slice(0, 5)}`
  //     );
  //   } else {
  //     console.error("❌ CRITICAL: Received zero vectors, aborting.");
  //     return;
  //   }
  // } catch (error) {
  //   console.error("❌ CRITICAL API ERROR during embedding generation:", error);
  //   return;
  // }

  // // 1. Create and connect to the Redis Client
  // const redisClient: any = createClient({
  //   url: "redis://:ChRj72nuujSCW5z92XDVGitu@84.200.192.243:6379",
  // });

  // redisClient.on("error", (err: any) =>
  //   console.error("Redis Client Error", err)
  // );

  // await redisClient.connect();
  // console.log("Connected to Redis Stack Server.");

  // // 2. Store documents and embeddings in Redis (تغییر روش ذخیره‌سازی)
  // // چون بردارها را دستی تولید کردیم، باید از متد addVectors و addDocuments استفاده کنیم.

  // // ایجاد یک نمونه خالی از VectorStore
  // const vectorStore = new RedisVectorStore(embeddings, {
  //   redisClient: redisClient,
  //   indexName: "bluechart_blog_vectors",
  // });

  // console.log("Vectors is: ", vectors);
  // // 3. افزودن بردارها و داکیومنت‌ها به صورت جداگانه
  // // این فرآیند جایگزین .fromDocuments می‌شود.
  // await vectorStore.addVectors(vectors, chunkedDocuments);

  // console.log(
  //   "Blog posts have been embedded and indexed successfully in Redis."
  // );
  // await redisClient.disconnect();

  //   // 1. Create and connect to the Redis Client
  //   const redisClient: any = createClient({
  //     url: "redis://:ChRj72nuujSCW5z92XDVGitu@84.200.192.243:6379",
  //   });

  //   redisClient.on("error", (err: any) =>
  //     console.error("Redis Client Error", err)
  //   );
  //   await redisClient.connect();
  //   console.log("Connected to Redis Stack Server.");

  //   // 2. Store documents and embeddings in Redis
  //   const vectorStore = await RedisVectorStore.fromDocuments(
  //     chunkedDocuments,
  //     embeddings,
  //     {
  //       redisClient: redisClient,
  //       indexName: "bluechart_blog_vectors", // نام ایندکس برداری در Redis
  //     }
  //   );

  //   console.log(
  //     "Blog posts have been embedded and indexed successfully in Redis."
  //   );

  //   // 3. Disconnect Redis Client
  //   await redisClient.disconnect();

  //   // 1. Connect to MongoDB
  //   const client = new MongoClient("mongodb://127.0.0.1:27017");
  //   await client.connect();
  //   const db = client.db("bluechart-db");

  //   const collection: any = db.collection("blog_vectors");

  //   const vectorStore = await MongoDBAtlasVectorSearch.fromDocuments(
  //     chunkedDocuments,
  //     embeddings,
  //     {
  //       collection: collection,
  //       indexName: "vector_index",
  //     }
  //   );

  console.log("Blog posts have been embedded and indexed successfully.");
}

indexBlogPosts().catch(console.error);
