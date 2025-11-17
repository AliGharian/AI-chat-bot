import { ObjectId } from "mongodb";

export interface IDatabase {
  insertOne(collectionName: string, dataObject: any): Promise<any>;
  findOne(collectionName: string, query: any, lookup?: any): Promise<any>;
}

export interface IUser {}

export interface IMessage {
  _id?: ObjectId;
  user_id: ObjectId | null;
  conversation_id: ObjectId | null;
  sessionId: string | null;
  role: "USER" | "BOT" | "SYSTEM";
  text: string;
  createdAt: Date;
}
