import express from "express";
import { COLLECTIONS, MongoDatabaseManager } from "./data/repository/mongodb";
import { IDatabase, IMessage, ISession } from "./types";
import { Repository } from "./data/repository";
import dotenv from "dotenv";
import { GeminiClient } from "./Models/GeminiClient";
import { UAParser } from "ua-parser-js";
import {
  buildHistoryPrompt,
  extractUrl,
  fetchPageContent,
  stripHtml,
} from "./utils";
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

    const existing = await sessionRepository.get({ sessionId: deviceId });
    if (existing) {
      return res.json({
        message: "already-exists",
        deviceId,
      });
    }

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

    if (!sessionId || sessionId == null) {
      return res.status(400).json({ error: "sessionId is required" });
    }

    const messages = await messageRepository.findAll(
      {
        sessionId,
      },
      20,
      0,
      undefined,
      { createdAt: -1 }
    );

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
  const { prompt, sessionId, pageUrl } = req.body;

  console.log("Page URL: ", pageUrl);

  if (!prompt || typeof prompt !== "string") {
    return res
      .status(400)
      .json({ error: "Prompt is required and must be a string." });
  }

  if (!sessionId || sessionId == null) {
    return res.status(400).json({ error: "sessionId is required" });
  }

  const lastMessages: IMessage[] = await messageRepository.findAll(
    { sessionId },
    10,
    0,
    undefined,
    { createdAt: -1 }
  );

  const historyText = buildHistoryPrompt(lastMessages.reverse());

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

  const finalPrompt = `
          این چت‌ سابق بین کاربر و دستیار:

          ${historyText}

          --------------------
          سؤال جدید کاربر:
          ${prompt}
          --------------------

          ${
            url
              ? `کاربر لینک داده: ${url}
          خلاصه محتوای صفحه:
          ${pageText.substring(0, 30000)}
          `
              : ""
          }
          `;

  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Transfer-Encoding", "chunked");

  let streamEnded = false;
  let botFullText = "";

  await messageRepository.create({
    user_id: null,
    conversation_id: null,
    sessionId,
    role: "USER",
    text: prompt,
    createdAt: new Date(),
  });

  const fallbackTimeout = setTimeout(() => {
    if (!streamEnded) {
      res.write("❌ خطا: پاسخ طولانی یا اتصال قطع شد.\n");
      res.end();
    }
  }, 15000);

  try {
    await gemini.generateText({
      prompt: finalPrompt,
      pageUrl: pageUrl,
      onData: (chunk: any) => {
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
          sessionId,
          role: "BOT",
          text: botFullText,
          createdAt: new Date(),
        });
        if (!res.writableEnded) res.end();
      },
      onError: (err: any) => {
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

// const GenerateContentResponse =  {
//     sdkHttpResponse: {
//       headers: {
//         'alt-svc': 'h3=":443"; ma=2592000,h3-29=":443"; ma=2592000',
//         'content-encoding': 'gzip',
//         'content-type': 'application/json; charset=UTF-8',
//         date: 'Wed, 19 Nov 2025 08:04:18 GMT',
//         server: 'scaffolding on HTTPServer2',
//         'server-timing': 'gfet4t7; dur=1767',
//         'transfer-encoding': 'chunked',
//         vary: 'Origin, X-Origin, Referer',
//         'x-content-type-options': 'nosniff',
//         'x-frame-options': 'SAMEORIGIN',
//         'x-xss-protection': '0'
//       }
//     },
//     candidates: [ { content: [Object], finishReason: 'STOP', index: 0 } ],
//     modelVersion: 'gemini-2.5-flash',
//     responseId: 'AnodafWJBJrunsEP093D6AI',
//     usageMetadata: {
//       promptTokenCount: 7414,
//       candidatesTokenCount: 82,
//       totalTokenCount: 7602,
//       promptTokensDetails: [ [Object] ],
//       thoughtsTokenCount: 106
//     }
//   }

// const CallParts = {
//   parts: [
//     {
//       functionCall: [Object],
//       thoughtSignature:
//         "CqIDAdHtim8QE8Qr8EQAnD3SR43Udiz5HIgzrqa0wM56pBNroZMSgeqil4S99nglp9EAZBEcltjb07nYAijhhbPmre+O0n4mAYHpgP6DoSveCm1DoxDjoalPiGMxyAsxpgwADoWf+2mdFNGAx2RydYS/zlP8Rt7nUHqB8kbx5HHDM66KdCof+ZGT+0rms7u0S++t17rvoZIg/IMCDnWuXXPq5GejIuB9OmbEqt0W8RILJ+TIgtPZ+sDavbyQhZssSe1ZKvR1JNAlqeWLCJohaJAK/8v8StoFIx1xUS11l0zHokhiTv4VWG0m5+4l6YTFOUShzMx/mXjdTLx1boHlmAxVS9KZrRcHgjaDYoFiEXjSAHm2HUDxqNbKj+FeVGVJ6PpcVjRv/V73bZVoIZ+NLxACalyX3XfNJLeZq//+VWQTZxYoH33xiqFeU4kALAzF3in8yE7LpH9e5pZ+znL+2VkDkEBPt4pXJrJZ6P2jNiNAqeNBq4Yh+2g2iVDOJj7Ysa4adYoMx0uI+D1Bq/BYw8AiyH15e9g4sFXJB+lbUp26vLZORg==",
//     },
//   ],
//   role: "model",
// };

//   const ActionCall =   {
//     name: 'scrapePage',
//     args: { url: 'https://safebroker.org/blog/how-add-indicator-mt4-mt5' }
//   }

//    const StreamError: ApiError = {"error":{"message":"{\n  \"error\": {\n    \"code\": 400,\n    \"message\": \"Please ensure that function response turn comes immediately after a function call turn.\",\n    \"status\": \"INVALID_ARGUMENT\"\n  }\n}\n","code":400,"status":"Bad Request"}}
//       at throwErrorIfNotOK (/var/www/ai-bot/node_modules/@google/genai/dist/node/index.cjs:11430:30)
//       at process.processTicksAndRejections (node:internal/process/task_queues:95:5)
//       at async /var/www/ai-bot/node_modules/@google/genai/dist/node/index.cjs:11183:13
//       at async Models.generateContentStream (/var/www/ai-bot/node_modules/@google/genai/dist/node/index.cjs:12572:24) {
//     status: 400
//   }

// const StreamError: ApiError = {"error":{"message":"{\n  \"error\": {\n    \"code\": 429,\n    \"message\": \"You exceeded your current quota, please check your plan and billing details. For more information on this error, head to: https://ai.google.dev/gemini-api/docs/rate-limits. To monitor your current usage, head to: https://ai.dev/usage?tab=rate-limit. \\n* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 10, model: gemini-2.5-flash\\nPlease retry in 22.421756398s.\",\n    \"status\": \"RESOURCE_EXHAUSTED\",\n    \"details\": [\n      {\n        \"@type\": \"type.googleapis.com/google.rpc.Help\",\n        \"links\": [\n          {\n            \"description\": \"Learn more about Gemini API quotas\",\n            \"url\": \"https://ai.google.dev/gemini-api/docs/rate-limits\"\n          }\n        ]\n      },\n      {\n        \"@type\": \"type.googleapis.com/google.rpc.QuotaFailure\",\n        \"violations\": [\n          {\n            \"quotaMetric\": \"generativelanguage.googleapis.com/generate_content_free_tier_requests\",\n            \"quotaId\": \"GenerateRequestsPerMinutePerProjectPerModel-FreeTier\",\n            \"quotaDimensions\": {\n              \"model\": \"gemini-2.5-flash\",\n              \"location\": \"global\"\n            },\n            \"quotaValue\": \"10\"\n          }\n        ]\n      },\n      {\n        \"@type\": \"type.googleapis.com/google.rpc.RetryInfo\",\n        \"retryDelay\": \"22s\"\n      }\n    ]\n  }\n}\n","code":429,"status":"Too Many Requests"}}
//       at throwErrorIfNotOK (/var/www/ai-bot/node_modules/@google/genai/dist/node/index.cjs:11430:30)
//       at process.processTicksAndRejections (node:internal/process/task_queues:95:5)
//       at async /var/www/ai-bot/node_modules/@google/genai/dist/node/index.cjs:11183:13
//       at async Models.generateContentStream (/var/www/ai-bot/node_modules/@google/genai/dist/node/index.cjs:12572:24) {
//     status: 429
//   }
