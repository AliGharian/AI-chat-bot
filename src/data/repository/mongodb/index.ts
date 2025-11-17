import { MongoClient, Db } from "mongodb";
import { IDatabase } from "../../../types";
import dotenv from "dotenv";
dotenv.config();

// Database collections to avoid possible typo
export const COLLECTIONS = {
  USER: "users",
  MESSAGE: "messages",
};

// Mongodb Manager Singleton Class
export class MongoDatabaseManager implements IDatabase {
  private static instance: MongoDatabaseManager;
  private client: MongoClient | null = null;
  private db: Db | null = null;
  private constructor(private readonly databaseURL: string) {}

  static getInstance(databaseURL?: string): MongoDatabaseManager {
    // const databaseURLStatic = `${process.env.DATABASE_URL}/${process.env.DATABASE_NAME}`;
    const databaseURLStatic = `${process.env.DATABASE_URL}`;
    if (!MongoDatabaseManager.instance) {
      MongoDatabaseManager.instance = new MongoDatabaseManager(
        databaseURL ?? databaseURLStatic
      );
    }
    return MongoDatabaseManager.instance;
  }

  // Establish and cache the database connection
  async connect(): Promise<Db> {
    if (!this.client || !this.db) {
      try {
        this.client = await MongoClient.connect(this.databaseURL, {
          maxPoolSize: 20, // Limits the maximum number of connections to 10
          minPoolSize: 2, // Keeps at least 2 connections open at all times
        });
        this.db = this.client.db(); // Set the database
        console.log("Connected to MongoDB");
      } catch (error) {
        console.error("Failed to connect to MongoDB", error);
        throw error;
      }
    }
    return this.db;
  }

  async insertOne(collectionName: string, dataObject: any): Promise<any> {
    const db = await this.connect();
    try {
      return await db?.collection(collectionName).insertOne(dataObject);
    } catch (error) {
      console.error(`Failed to insert document into ${collectionName}`, error);
      throw error;
    }
  }

  async findOne(
    collectionName: string,
    query: any,
    lookup?: any
  ): Promise<any> {
    const db = await this.connect();
    try {
      const pipeline = [
        {
          $match: query,
        },
        {
          $limit: 1, // Limit the number of documents returned
        },
      ];

      if (lookup) {
        if (Array.isArray(lookup)) {
          pipeline.push(...lookup);
        } else {
          pipeline.push(lookup);
        }
      }

      const result = await db
        ?.collection(collectionName)
        .aggregate(pipeline)
        .toArray();
      return result[0];
    } catch (error) {
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.close();
      console.log("MongoDB connection closed");
    }
  }
}
