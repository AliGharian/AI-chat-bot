import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { Document } from "@langchain/core/documents"; // 💡 فقط برای تعریف نوع Document
import weaviate, { WeaviateClient } from "weaviate-ts-client";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
dotenv.config();

const apiKey = process.env.GEMINI_API_KEY || "";
const WEAVIATE_HOST = "84.200.192.243:8080";
const WEAVIATE_CLASS_NAME = "DocumentChunk";

// --- توابع کمکی formatContext و LLM (بدون تغییر) ---
const ai = new GoogleGenAI({ apiKey: apiKey });

function formatContext(documents: Document[]): string {
    const context = documents
        .map((doc) => {
            let title = "N/A";
            try {
                // 💡 در اینجا باید مطمئن شویم که metadataJson به صورت string وجود دارد
                const meta = JSON.parse(doc.metadata.metadataJson as string);
                title = meta.title || "N/A";
            } catch (e) {
                // ...
            }
            return `[TITLE: ${title}]\n${doc.pageContent}\n---`;
        })
        .join("\n");
    return context.trim();
}

export async function generateResponseWithRAG(userQuery: string) {
    // ... (بخش LLM بدون تغییر)
    const relevantDocuments = await runSimilaritySearch(userQuery, 8);
    // ... (بقیه کد)
    const prompt = `
        شما یک دستیار متخصص در زمینه بازارهای مالی و تحلیل تکنیکال هستید. 
        فقط بر اساس 'CONTEXT' زیر، به 'USER_QUERY' پاسخ دهید. 
        ...
        `;
    // ... (بقیه کد)
    const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
    });
    return response.text;
}
// ---------------------------------------------------


export async function runSimilaritySearch(userQuery: string, k: number = 4): Promise<Document[]> {
    const weaviateClient: any = weaviate.client({
        scheme: "http",
        host: WEAVIATE_HOST,
    });

    // 1. بررسی آمادگی سرور (مانند قبل)
    const isReady = await weaviateClient.misc.readyChecker().do();
    if (!isReady) {
        console.error("❌ Weaviate is not ready. Cannot perform search.");
        return [];
    }
    console.log("✅ Connected to Weaviate for search. Using native GraphQL search.");

    // 2. تولید وکتور از کوئری کاربر
    const embeddings = new GoogleGenerativeAIEmbeddings({
        model: "text-embedding-004",
        apiKey: apiKey,
    });

    const queryVector = await embeddings.embedQuery(userQuery);

    console.log(`Searching Weaviate for documents similar to: "${userQuery}"...`);

    // 3. اجرای جستجوی GraphQL بومی (Vector Search)
    const graphqlQuery = await weaviateClient.graphql
        .get()
        .withClassName(WEAVIATE_CLASS_NAME)
        // 💡 فیلدهایی که نیاز داریم برگردانده شوند
        .withFields("content sourceKey metadataJson") 
        .withNearVector({ 
            vector: queryVector,
            // distance: 0.2 // Optional: If you want to filter by distance threshold
        })
        .withLimit(k)
        .do();

    // 4. پردازش و تبدیل نتایج به فرمت LangChain Document
    const results: any[] = graphqlQuery.data.Get[WEAVIATE_CLASS_NAME] || [];

    console.log(`\n🔎 Found ${results.length} relevant documents:`);

    const relevantDocuments: Document[] = results.map((item, index) => {
        // ساخت Document
        const doc = new Document({
            pageContent: item.content,
            metadata: {
                sourceKey: item.sourceKey,
                metadataJson: item.metadataJson,
            },
        });

        // 💡 نمایش نتیجه در کنسول
        let title = "N/A";
        try {
            const meta = JSON.parse(item.metadataJson as string);
            title = meta.title || "N/A";
        } catch (e) { /* silent */ }
        
        console.log(`--- Document ${index + 1} (Score/Distance TBD) ---`);
        console.log(`Title: ${title}`);
        console.log(`Content Snippet: ${item.content.substring(0, 150)}...`);

        return doc;
    });

    return relevantDocuments;
}

