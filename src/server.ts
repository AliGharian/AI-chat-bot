import express, { Request, Response } from "express";

import { COLLECTIONS, MongoDatabaseManager } from "./data/repository/mongodb";
import { IDatabase, IMessage, IUser } from "./types";
import { Repository } from "./data/repository";
import dotenv from "dotenv";
import { GeminiClient } from "./Models/GeminiClient";
dotenv.config();

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

const gemini = new GeminiClient(process.env.GEMINI_API_KEY!);

app.post("/api/stream", async (req, res) => {
  const { prompt } = req.body;

  if (!prompt || typeof prompt !== "string") {
    return res
      .status(400)
      .json({ error: "Prompt is required and must be a string." });
  }

  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Transfer-Encoding", "chunked");

  try {
    await gemini.generateText({
      prompt,
      onData: (chunk) => res.write(chunk),
      onEnd: () => res.end(),
      onError: (err) => {
        console.error("Stream error:", err);
        if (!res.headersSent) {
          res.status(500).end("Error: " + err.message);
        } else {
          res.end();
        }
      },
    });
  } catch (err: any) {
    console.error("Gemini API error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error." });
    } else {
      res.end();
    }
  }
});

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
