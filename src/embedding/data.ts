import { MongoClient, Document } from "mongodb";

const uri = "mongodb://127.0.0.1:27017";

const DB_NAME = "bluechart-db";
const COLLECTION_NAME = "blogs";

const blogPostData: Document[] = [];

export async function fetchBlogPostsFromMongo(): Promise<Document[]> {
  const client = new MongoClient(uri);

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
