import { Document } from "@langchain/core/documents";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { fetchBlogPostsFromMongo } from "./data";
import weaviate, { WeaviateClient } from "weaviate-ts-client";
import dotenv from "dotenv";
import { chunkArray, extractRawText } from "../utils";
dotenv.config();

const API_KEYS = JSON.parse(process.env.GOOGLE_GENAI_API_KEYS ?? "[]");
const WEAVIATE_HOST = `${process.env.HOST}:${process.env.WEAVIATE_PORT}`;
const WEAVIATE_CLASS_NAME = process.env.WEAVIATE_CLASS_NAME || "DocumentChunk";
const BATCH_SIZE = 90;
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || "";

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
  const chunkedBatches: Document[][] = chunkArray<Document>(
    chunkedDocuments,
    BATCH_SIZE
  );

  const totalChunks = chunkedDocuments.length;
  let indexedCount = 0;

  console.log(
    `Starting batched embedding in ${chunkedBatches.length} batches (size: ${BATCH_SIZE})...`
  );

  try {
    for (let i = 0; i < chunkedBatches.length; i++) {
      const batch: Document[] = chunkedBatches[i];
      const batcher = weaviateClient.batch.objectsBatcher(); // ❌ مرحله تولید وکتور با GoogleGenAI کاملاً حذف شد. // const ai = new GoogleGenAI... // const response: EmbedContentResponse...

      for (let j = 0; j < batch.length; j++) {
        const doc = batch[j];
        const dataObject = {
          content: doc.pageContent,
          sourceKey: doc.metadata.sourceKey,
          metadataJson: doc.metadata.metadataJson,
        };

        batcher.withObject({
          class: WEAVIATE_CLASS_NAME,
          properties: dataObject,
        });
      }

      const errors = await batcher.do();

      const errorResults = errors.filter((e: any) => e.result.errors);
      if (errorResults.length > 0) {
        console.error(
          "Batching errors occurred. Weaviate failed to index or vectorize data."
        );
        console.error(JSON.stringify(errorResults, null, 2));
        throw new Error("Weaviate Batch Failed.");
      }

      indexedCount += batch.length;
      console.log(
        `Indexed ${indexedCount} of ${totalChunks} chunks. (Batch: ${i + 1}/${
          chunkedBatches.length
        })`
      );
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  } catch (error: any) {
    console.error("CRITICAL ERROR during Weaviate Indexing:", error);
    throw error;
  }

  console.log("Blog posts have been embedded and indexed successfully.");
}

indexBlogPosts().catch(console.error);
