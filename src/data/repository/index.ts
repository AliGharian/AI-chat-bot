import { IDatabase } from "../../types";

export class Repository<T> {
  constructor(
    private readonly db: IDatabase,
    private readonly collectionName: string
  ) {}

  async create(entity: T) {
    return await this.db.insertOne(this.collectionName, entity);
  }

  async get(query: any, lookup?: any) {
    return await this.db.findOne(this.collectionName, query, lookup);
  }

  async findAll(
    query: any,
    limit?: number,
    skip?: number,
    lookup?: any,
    sort?: any
  ) {
    return await this.db.findAll(
      this.collectionName,
      query,
      limit,
      skip,
      lookup,
      sort
    );
  }
}
