import { GoogleGenAI } from "@google/genai";
import weaviate, { WeaviateClient } from "weaviate-ts-client";
import dotenv from "dotenv";
import { Document } from "@langchain/core/documents";
dotenv.config();

const apiKey = process.env.GEMINI_API_KEY || "";
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || "";
const WEAVIATE_HOST = `${process.env.HOST}:${process.env.WEAVIATE_PORT}`;
const WEAVIATE_CLASS_NAME = process.env.WEAVIATE_CLASS_NAME || "DocumentChunk";

const ai = new GoogleGenAI({ apiKey: apiKey });

function formatContext(documents: Document[]): string {
  const context = documents
    .map((doc) => {
      return `${doc.pageContent}\n---`;
    })
    .join("\n");
  return context.trim();
}

export async function runSimilaritySearch(
  userQuery: string,
  k: number = 10
): Promise<Document[]> {
  //! Define Weaviate client
  const weaviateClient: WeaviateClient = weaviate.client({
    scheme: "http",
    host: WEAVIATE_HOST,
  });

  const isReady = await weaviateClient.misc.readyChecker().do();
  if (!isReady) {
    console.error("❌ Weaviate is not ready. Cannot perform search.");
    return [];
  }
  console.log(
    "✅ Connected to Weaviate for search. Using native GraphQL search."
  );
  //? -------------------------------------------

  console.log(`Searching Weaviate for documents similar to: "${userQuery}"...`);

  const graphqlQuery = await weaviateClient.graphql
    .get()
    .withClassName(WEAVIATE_CLASS_NAME)
    .withFields("content _additional { id distance }")
    .withNearText({
      concepts: [userQuery],
    })
    .withLimit(k)
    .do();

  const results: any[] = graphqlQuery.data.Get?.[WEAVIATE_CLASS_NAME] || [];

  console.log("\n\nGraphQL Search Results:\n", results);

  const relevantDocuments: Document[] = results.map((item, index) => {
    // Create Document
    const doc = new Document({
      pageContent: item.content,
      metadata: {
        id: item._additional.id,
        distance: item._additional.distance,
      },
    });
    return doc;
  });

  return relevantDocuments;
}

export async function generateResponseWithRAG(userQuery: string) {
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
