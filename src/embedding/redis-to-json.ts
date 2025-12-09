// import { createClient } from "redis";
// import * as fs from "fs";
// import dotenv from "dotenv";
// dotenv.config();

// const redisPass = process.env.REDIS_PASSWORD || "";

// const REDIS_URL = `redis://default:${redisPass}@84.200.192.243:6379`;
// const KEY_PREFIX = "doc:";
// const OUTPUT_FILE = "redis_export.json";

// async function exportRedisDataToJson() {
//   const client = createClient({ url: REDIS_URL });

//   client.on("error", (err) => console.error("Redis Client Error", err));

//   try {
//     await client.connect();
//     console.log("✅ Connected to Redis Stack.");

//     const keys: string[] = [];
//     let cursor: number | string = 0;
//     do {
//       const scanResult = await client.scan(cursor.toString(), {
//         MATCH: `${KEY_PREFIX}*`,
//         COUNT: 1000,
//       });
//       cursor = scanResult.cursor;
//       keys.push(...scanResult.keys);
//     } while (cursor !== "0");

//     console.log(`Found ${keys.length} keys to export.`);

//     const exportedData: any[] = [];

//     for (const key of keys) {
//       const hashData = await client.hGetAll(key);

//       const contentString = hashData.content ? hashData.content.toString() : "";

//       let parsedMetadata = {};

//       if (hashData.metadata) {
//         try {
//           parsedMetadata = JSON.parse(hashData.metadata);
//         } catch (e) {
//           console.error(
//             `⚠️ Could not parse metadata for key ${key}. Skipping...`
//           );
//           parsedMetadata = { raw: hashData.metadata };
//         }
//       }

//       let vectorArray: number[] | string = "N/A";

//       if (hashData.content_vector) {
//         try {
//           const floatArray = new Float32Array(hashData.content_vector.buffer);
//           vectorArray = Array.from(floatArray);
//         } catch (e) {
//           console.error(
//             `⚠️ Could not convert vector for key ${key} to array. Saving as Base64 fallback.`
//           );
//           vectorArray = hashData.content_vector.toString("base64");
//         }
//       }

//       const cleanData = {
//         key: key,
//         content: contentString,
//         metadata: parsedMetadata,
//         vector_data: vectorArray,
//       };

//       if (cleanData.content) {
//         exportedData.push(cleanData);
//       }
//     }

//     const jsonOutput = JSON.stringify(exportedData, null, 2);
//     fs.writeFileSync(OUTPUT_FILE, jsonOutput);

//     console.log(
//       `✅ Successfully exported ${exportedData.length} records to ${OUTPUT_FILE}`
//     );
//   } catch (error) {
//     console.error("❌ Export failed:", error);
//   } finally {
//     if (client.isOpen) {
//       await client.disconnect();
//     }
//   }
// }

// exportRedisDataToJson();
