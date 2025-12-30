export { createAiSdkModel as aisdk } from "aidk-ai-sdk";
import { createVertex } from "@ai-sdk/google-vertex";
import { createOpenAI } from "@ai-sdk/openai";

const GOOGLE_CREDENTIALS = JSON.parse(
  process.env["GCP_CREDENTIALS"]
    ? Buffer.from(process.env["GCP_CREDENTIALS"], "base64").toString("utf8")
    : "null",
);

export const openai = createOpenAI({
  apiKey: process.env["OPENAI_API_KEY"],
  baseURL: process.env["OPENAI_BASE_URL"],
});

export const vertex = createVertex({
  project: process.env["GCP_PROJECT_ID"],
  location: process.env["GCP_LOCATION"] || "us-central1",
  googleAuthOptions: {
    credentials: GOOGLE_CREDENTIALS,
  },
});
