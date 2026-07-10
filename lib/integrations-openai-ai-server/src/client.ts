import OpenAI from "openai";

if (!process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY must be set.");
}

export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  // Optional override (e.g. a proxy/gateway); defaults to https://api.openai.com/v1
  baseURL: process.env.OPENAI_BASE_URL,
});
