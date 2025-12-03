import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { RunnableSequence } from "@langchain/core/runnables";
import { MongoClient } from "mongodb";
import { MongoDBAtlasVectorSearch } from "@langchain/mongodb";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { createStuffDocumentsChain } from "@langchain/classic/chains/combine_documents";

// Define your database constants again
const MONGO_URI = "mongodb://127.0.0.1:27017";
const DB_NAME = "ai-bot-db";
const COLLECTION_NAME = "blog_vectors";
const INDEX_NAME = "vector_index"; // The name of your Atlas Vector Search Index

async function setupRAGChain() {
  console.log("Setting up LLM and MongoDB Retriever...");

  // 1. Initialize the Chat LLM (The Generator)
  // The model that will generate the final Persian answer.
  const llm = new ChatGoogleGenerativeAI({
    model: "gemini-2.5-flash",
    apiKey: "AIzaSyBJpnMc7Rg02TLIH8wdaC_CSqtcF_cwivI",
    temperature: 0.1, // Lower temperature ensures more factual and less creative answers
  });

  // 2. Initialize Embeddings (Must match the model used for indexing)
  const embeddings = new GoogleGenerativeAIEmbeddings({
    model: "text-embedding-004",
    apiKey: "AIzaSyBJpnMc7Rg02TLIH8wdaC_CSqtcF_cwivI",
  });

  // 3. Connect to the MongoDB Vector Store (The Retriever Source)
  // We re-initialize the connection to the collection containing the 11,200 vectors.
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const collection: any = client.db(DB_NAME).collection(COLLECTION_NAME);

  const vectorStore = new MongoDBAtlasVectorSearch(embeddings, {
    collection: collection,
    indexName: INDEX_NAME,
  });

  // Convert the vector store into a Retriever
  // k=4: Retrieve the 4 most relevant chunks from the database for the context.
  const retriever = vectorStore.asRetriever({ k: 4 });

  console.log("Retriever initialized. Ready to build the chain.");
  // ----------------------------------------------------------------

  // 4. Define the Prompt Template (Instructions to the LLM)
  const RAG_PROMPT = ChatPromptTemplate.fromMessages([
    // System instruction is written in Persian as the final output should be Persian
    [
      "system",
      "شما یک متخصص مالی هستید. وظیفه شما پاسخ دادن به سوال کاربر بر اساس 'فقط' محتوای متنی ارائه شده در زیر است. اگر پاسخ در محتوا نبود، بگویید 'متأسفانه پاسخ دقیق در منابع من موجود نیست.' \n\n Context: {context}",
    ],
    ["human", "{input}"],
  ]);

  // 5. Create the Document Combination Chain (Stuffing the Context)
  // This component takes the documents and inserts them into the {context} placeholder.
  const combineDocsChain = await createStuffDocumentsChain({
    llm: llm,
    prompt: RAG_PROMPT,
    outputParser: new StringOutputParser(),
  });

  // 6. Create the Final RAG Sequence (The Orchestrator)
  // This chain orchestrates the retrieval (search) and the generation (LLM) steps.
  const RAG_Chain = RunnableSequence.from([
    {
      // First step: Retrieve relevant documents (chunks) based on the user's input
      context: (input: { input: string }) => retriever.invoke(input.input),
      input: (input: { input: string }) => input.input,
    },
    // Second step: Pass the retrieved documents and user input to the combination chain
    combineDocsChain,
  ]);

  console.log("✅ RAG Chain setup complete.");
  return RAG_Chain;
}

export async function runQASystem(query: string) {
  const chain = await setupRAGChain();

  console.log(`\nUser Query: ${query}`);

  // Invoking the chain starts the full RAG process.
  const result = await chain.invoke({
    input: query,
  });
  console.log(`\nGemini Answer:\n${result}`);
  return result;

  // NOTE: Don't forget to close the MongoClient connection when the application shuts down
}

const query = "آیا برای واریز به آلپاری روش های داخل ایران کار می کند؟";
runQASystem(query).catch((error) => {
  console.error("Error running the QA system:", error);
});
