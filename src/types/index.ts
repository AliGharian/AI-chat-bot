import { ObjectId } from "mongodb";

export interface IDatabase {
  insertOne(collectionName: string, dataObject: any): Promise<any>;
  findOne(collectionName: string, query: any, lookup?: any): Promise<any>;
  findAll(
    collectionName: string,
    query: any,
    limit?: number,
    skip?: number,
    lookup?: any,
    sort?: any
  ): Promise<any>;
}

export interface IUser {}

export interface ISession {
  _id?: ObjectId;
  sessionId: string;
  userId?: ObjectId | null;
  ip: string;
  browser: string;
  os: string;
  device: string;
  language: string;
  referrer: string | null;
  startPage: string;
  pages: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface IMessage {
  _id?: ObjectId;
  user_id: ObjectId | null;
  conversation_id: ObjectId | null;
  sessionId: string | null;
  role: "USER" | "BOT" | "SYSTEM";
  text: string;
  createdAt: Date;
}
