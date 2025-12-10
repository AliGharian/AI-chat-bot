import { Document } from "@langchain/core/documents";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { fetchBlogPostsFromMongo } from "./data";
import { GoogleGenAI } from "@google/genai";
import weaviate, { WeaviateClient } from "weaviate-ts-client";
import dotenv from "dotenv";
dotenv.config();

const API_KEYS = JSON.parse(process.env.GOOGLE_GENAI_API_KEYS ?? "[]");
const WEAVIATE_HOST = "84.200.192.243:8080";
const WEAVIATE_CLASS_NAME = "DocumentChunk";

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
  for (const block of blocks) {
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
  // 1. Connect to Weaviate
  const weaviateClient: WeaviateClient = weaviate.client({
    scheme: "http",
    host: WEAVIATE_HOST,
  });

  const isReady = await weaviateClient.misc.readyChecker().do();
  if (!isReady) {
    console.error(
      "❌ Weaviate is not ready. Please check the Docker container."
    );
    return;
  }
  console.log(`✅ Connected to Weaviate at ${WEAVIATE_HOST}. Server is ready.`);

  // Fetch blog post data from MongoDB
  const blogPostData: any[] = await fetchBlogPostsFromMongo();
  // ------------------------------------------
  console.log("Starting the embedding and indexing process...");

  console.log("First blog post data:  ", blogPostData[0].content); // 1.1: تولید Raw Docs

  const rawDocs: Document[] = blogPostData.map((post) => {
    const cleanedContent = extractRawText(post.content);

    return new Document({
      pageContent: cleanedContent,
      metadata: {
        id: post._id.toString(),
        title: post.title,
        slug: post.slug,
      },
    });
  });

  console.log(`Total raw blog posts fetched: ${rawDocs.length}`);
  console.log("Last raw document:", rawDocs[0]);

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 500,
    chunkOverlap: 50,
  });

  const chunkedDocuments: any[] = await splitter.splitDocuments(rawDocs);

  console.log(`Blog posts after chunking: ${chunkedDocuments.length}`); // 1.3: آماده‌سازی Batching

  const chunkedBatches = chunkArray(chunkedDocuments, BATCH_SIZE);
  const totalChunks = chunkedDocuments.length;
  let indexedCount = 0;

  console.log(
    `Starting batched embedding in ${chunkedBatches.length} batches (size: ${BATCH_SIZE})...`
  );

  let currentKeyIndex = 0;
  let currentAPIKey = API_KEYS[currentKeyIndex];
  let processingSucceeded = false;

  console.log("API KEY LIST IS: ", API_KEYS);
  while (currentKeyIndex < API_KEYS.length && !processingSucceeded) {
    const ai = new GoogleGenAI({ apiKey: currentAPIKey });

    try {
      for (
        let i = Math.floor(indexedCount / BATCH_SIZE);
        i < chunkedBatches.length;
        i++
      ) {
        const batch = chunkedBatches[i];

        // Generate vectors
        const batchTexts = batch.map((doc) => doc.pageContent);
        const response: any = await ai.models.embedContent({
          model: "text-embedding-004",
          contents: batchTexts,
        });

        const correctedVectors = response.embeddings.map((v: any) => v.values);

        const batcher = weaviateClient.batch.objectsBatcher();

        for (let k = 0; k < batch.length; k++) {
          const doc = batch[k];
          const vector = correctedVectors[k];

          //Create
          const dataObject = {
            content: doc.pageContent,
            sourceKey: doc.metadata.sourceKey,
            metadataJson: doc.metadata.metadataJson,
          };

          batcher.withObject({
            class: WEAVIATE_CLASS_NAME,
            properties: dataObject,
            vector: vector,
          });
        }

        // Execute batch
        await batcher.do();

        indexedCount += batch.length;
        console.log(
          `✅ Indexed ${indexedCount} of ${totalChunks} chunks. (Batch: ${
            i + 1
          }/${chunkedBatches.length})`
        );
        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      processingSucceeded = true;
    } catch (error: any) {
      if (error.status === 400 || error.message.includes("API key expired")) {
        console.error(
          `API Error (Status 400 or Expired Key) occurred at chunk ${indexedCount}.`
        );
        currentKeyIndex++;

        if (currentKeyIndex >= API_KEYS.length) {
          console.error(
            "All API keys have failed or expired. Stopping process."
          );
          throw new Error("All API keys failed.");
        } else {
          currentAPIKey = API_KEYS[currentKeyIndex];
          console.warn(
            `Switching to the next key (Index: ${
              currentKeyIndex + 1
            }). Resuming from chunk ${indexedCount}.`
          );
          // Continue to the next iteration of the while loop to retry with the new key
        }
      } else {
        console.error("❌ UNEXPECTED CRITICAL ERROR:", error);
        throw error;
      }
    }
  }

  console.log("Blog posts have been embedded and indexed successfully.");
}

indexBlogPosts().catch(console.error);
