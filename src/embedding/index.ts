import { Document } from "@langchain/core/documents";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { fetchBlogPostsFromMongo } from "./data";
import { GoogleGenAI } from "@google/genai";
import weaviate, { WeaviateClient } from "weaviate-ts-client";
import dotenv from "dotenv";
import { chunkArray, extractRawText } from "../utils";
dotenv.config();

const API_KEYS = JSON.parse(process.env.GOOGLE_GENAI_API_KEYS ?? "[]");
const WEAVIATE_HOST = `${process.env.HOST}:${process.env.WEAVIATE_PORT}`;
const WEAVIATE_CLASS_NAME = process.env.WEAVIATE_CLASS_NAME || "DocumentChunk";
const BATCH_SIZE = 90;

async function indexBlogPosts() {
  //! 1. Connect to Weaviate(vector database)
  const weaviateClient: WeaviateClient = weaviate.client({
    scheme: "http",
    host: WEAVIATE_HOST,
  });

  const isReady = await weaviateClient.misc.readyChecker().do();
  if (!isReady) {
    console.error("Weaviate is not ready. Please check the Docker container.");
    return;
  }
  console.log(`Connected to Weaviate at ${WEAVIATE_HOST}. Server is ready.`);
  //?-------------------------------------------

  //! 2. Fetch blog post data from MongoDB
  const blogPostData: any[] = await fetchBlogPostsFromMongo();
  //? ------------------------------------------

  console.log("Starting the embedding and indexing process...");

  //! 3. Extract the raw Documents from blog posts
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
  //? ------------------------------------------

  //! 4. Split documents into smaller chunks
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 500,
    chunkOverlap: 50,
  });

  const chunkedDocuments: Document[] = await splitter.splitDocuments(rawDocs);

  console.log(`Blog posts after chunking: ${chunkedDocuments.length}`);
  //?---------------------------------------------

  //! 5. Generate smaller chunks documents
  const chunkedBatches:Document[][] = chunkArray<Document>(chunkedDocuments, BATCH_SIZE);

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
      for (let i = Math.floor(indexedCount / BATCH_SIZE);i < chunkedBatches.length;i++) {
        const batch:Document[] = chunkedBatches[i];

        // Generate Vectors
        const batchTexts = batch.map((doc) => doc.pageContent);
        const response: any = await ai.models.embedContent({
          model: "text-embedding-004",
          contents: batchTexts,
        });

        const correctedVectors = response.embeddings.map((v: any) => v.values);

        const batcher = weaviateClient.batch.objectsBatcher();

        for (let j = 0; j < batch.length; j++) {
          const doc = batch[j];
          const vector = correctedVectors[j];

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
          `Indexed ${indexedCount} of ${totalChunks} chunks. (Batch: ${i + 1}/${
            chunkedBatches.length
          })`
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
        console.error("UNEXPECTED CRITICAL ERROR:", error);
        throw error;
      }
    }
  }

  console.log("Blog posts have been embedded and indexed successfully.");
}

indexBlogPosts().catch(console.error);
