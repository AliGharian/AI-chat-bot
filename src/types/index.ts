export interface IDatabase {
  insertOne(collectionName: string, dataObject: any): Promise<any>;
  findOne(collectionName: string, query: any, lookup?: any): Promise<any>;
}

export interface IUser {

}

export interface IMessage {
  
}
