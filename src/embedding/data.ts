import { MongoClient, Document } from "mongodb";
import dotenv from "dotenv";
dotenv.config();

const MONGO_URI = process.env.DATABASE_URL ?? "";
const DB_NAME = "ai-bot-db";
const COLLECTION_NAME = "blogs";

const blogPostData: Document[] = [];

export async function fetchBlogPostsFromMongo(): Promise<Document[]> {
  const client = new MongoClient(MONGO_URI);

  try {
    console.log(
      `Connecting to the Mongodb database to collection ${COLLECTION_NAME}...`
    );

    await client.connect();
    const database = client.db(DB_NAME);
    const collection = database.collection(COLLECTION_NAME);

    const posts = await collection.find({}).toArray();

    blogPostData.push(...posts);

    console.log(
      `Successfully fetched ${blogPostData.length} blog posts from MongoDB.`
    );

    return blogPostData;
  } catch (error) {
    console.error("Error while fetching from mongo", error);
    return [];
  } finally {
    await client.close();
  }
}
