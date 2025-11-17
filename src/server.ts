import express, { Request, Response } from "express";
import { COLLECTIONS, MongoDatabaseManager } from "./data/repository/mongodb";
import { IDatabase, IMessage, IUser } from "./types";
import { Repository } from "./data/repository";
import dotenv from "dotenv";
import { GeminiClient } from "./Models/GeminiClient";
import { ObjectId } from "mongodb";
dotenv.config();

var cors = require("cors");

const bodyParser = require("body-parser");

const app = express();

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST"],
  })
);

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

app.post("/messages", async (req, res) => {
  try {
    const { text, userId, sessionId } = req.body;

    if (!text || !userId || !sessionId) {
      return res
        .status(400)
        .send({ error: "text, userId, sessionId required" });
    }

    const userMessage: IMessage = {
      user_id: new ObjectId(userId),
      conversation_id: null,
      sessionId,
      role: "USER",
      text,
      createdAt: new Date(),
    };

    await messageRepository.create(userMessage);
    res.status(200).json({ message: "Message created successfully." });
  } catch (error) {
    res.status(500).json({ error: "Internal server error." });
  }
});

const gemini = new GeminiClient(process.env.GEMINI_API_KEY!);

app.post("/api/stream", async (req, res) => {
  console.log("this api called");
  const { prompt } = req.body;

  if (!prompt || typeof prompt !== "string") {
    return res
      .status(400)
      .json({ error: "Prompt is required and must be a string." });
  }

  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Transfer-Encoding", "chunked");

  let streamEnded = false;
  let botFullText = "";

  const result = await messageRepository.create({
    user_id: null,
    conversation_id: null,
    sessionId: null,
    role: "USER",
    text: prompt,
    createdAt: new Date(),
  });

  console.log("Result is: ", result);

  const fallbackTimeout = setTimeout(() => {
    if (!streamEnded) {
      res.write("❌ خطا: پاسخ طولانی یا اتصال قطع شد.\n");
      res.end();
    }
  }, 15000);

  try {
    await gemini.generateText({
      prompt,
      onData: (chunk) => {
        botFullText += chunk;
        if (!res.writableEnded) {
          res.write(chunk);
        }
      },
      onEnd: async () => {
        streamEnded = true;
        clearTimeout(fallbackTimeout);

        await messageRepository.create({
          user_id: null,
          conversation_id: null,
          sessionId: null,
          role: "BOT",
          text: botFullText,
          createdAt: new Date(),
        });
        if (!res.writableEnded) res.end();
      },
      onError: (err) => {
        console.error("Stream error:", err);
        streamEnded = true;
        clearTimeout(fallbackTimeout);
        if (!res.headersSent) {
          res.status(500).end("Error: " + err.message);
        } else if (!res.writableEnded) {
          res.end("❌ خطا در استریم پاسخ.\n");
        }
      },
    });
  } catch (err: any) {
    console.error("Gemini API error:", err);
    streamEnded = true;
    clearTimeout(fallbackTimeout);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error." });
    } else if (!res.writableEnded) {
      res.end("❌ خطا در پردازش درخواست.\n");
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
