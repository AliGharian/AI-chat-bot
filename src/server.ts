import express from "express";
import { COLLECTIONS, MongoDatabaseManager } from "./data/repository/mongodb";
import { IDatabase, IMessage, ISession } from "./types";
import { Repository } from "./data/repository";
import dotenv from "dotenv";
import { GeminiClient } from "./Models/GeminiClient";
import { UAParser } from "ua-parser-js";
import { extractUrl, fetchPageContent, stripHtml } from "./utils";
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

const dbManager: IDatabase = MongoDatabaseManager.getInstance();

const sessionRepository = new Repository<ISession>(
  dbManager,
  COLLECTIONS.SESSION
);
const messageRepository = new Repository<IMessage>(
  dbManager,
  COLLECTIONS.MESSAGE
);

app.post("/api/session", async (req, res) => {
  try {
    const userAgent = req.headers["user-agent"] || "";
    const parser = new UAParser(userAgent);
    const ua = parser.getResult();

    const ip =
      req.headers["x-forwarded-for"] || req.socket.remoteAddress || "0.0.0.0";

    const { deviceId, startPage, referrer, userId, language } = req.body;

    const sessionData: ISession = {
      sessionId: deviceId,
      userId: null,
      browser: "CHROME",
      os: "windows",
      device: ua.device.type || "desktop",
      language: language || req.headers["accept-language"] || "",
      referrer: referrer || null,
      ip: ip.toString(),
      startPage,
      pages: [startPage],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await sessionRepository.create(sessionData);

    res.json({
      message: true,
      deviceId,
    });
  } catch (err) {
    res.status(500).json({ error: "Server Error" });
  }
});

app.get("/api/messages", async (req, res) => {
  try {
    const sessionId = req.query.sessionId as string;

    if (!sessionId) {
      return res.status(400).json({ error: "sessionId is required" });
    }

    const messages = await messageRepository.findAll({
      sessionId,
    });

    return res.status(200).json({
      sessionId,
      count: messages.length,
      messages,
    });
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

  // 1) چک کن لینک هست یا نه
  const url = extractUrl(prompt);

  let pageText = "";

  if (url) {
    console.log("Fetching URL:", url);
    const html = await fetchPageContent(url);

    if (html) {
      pageText = stripHtml(html);
      console.log("HTML extracted length:", pageText.length);
    }
  }

  // 2) ساختن پرامپت نهایی
  const finalPrompt = url
    ? `  کاربر از من خواسته این لینک رو بررسی کنم:${url} محتوای صفحه: ${pageText.substring(
        0,
        30000
      )}   (فقط 30k کاراکتر برای جلوگیری از بزرگ شدن prompt)  سؤال کاربر:${prompt}`
    : prompt;

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
      prompt: finalPrompt,
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

app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});
