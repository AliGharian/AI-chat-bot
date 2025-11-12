import express, { Request, Response } from "express";

import { COLLECTIONS, MongoDatabaseManager } from "./data/repository/mongodb";
import { IDatabase, IMessage, IUser } from "./types";
import { Repository } from "./data/repository";

const bodyParser = require("body-parser");

const app = express();

app.use(bodyParser.json());
// Middleware to parse incoming JSON
app.use(bodyParser.urlencoded({ extended: false }));

const PORT = process.env.WEB_SERVER_PORT;
const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_NAME = process.env.DATABASE_NAME;

const databaseURL = `${DATABASE_URL}/${DATABASE_NAME}`;
const dbManager: IDatabase = MongoDatabaseManager.getInstance(databaseURL);

const userRepository = new Repository<IUser>(dbManager, COLLECTIONS.USER);
const messageRepository = new Repository<IMessage>(
  dbManager,
  COLLECTIONS.MESSAGE
);

app.post("/users", async (req: Request, res: Response): Promise<any> => {
  console.log(`POST /auth =>`, req.body);

  const body = req.body;

  if (!body?.username || !body?.password) {
    return res
      .status(400)
      .json({ message: "Username and password are required" });
  }

  const { username, password } = body;

  try {
  } catch (error) {
    console.error("Auth error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

//? User route
app.get("/me/user", async (req: Request, res: Response): Promise<any> => {});

app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});
