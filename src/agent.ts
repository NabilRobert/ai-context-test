import "dotenv/config";
import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { PrismaClient, VehicleType } from "@prisma/client";
import { get_encoding } from "tiktoken";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execSync } from "child_process";

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
//  Client — Sumopod AI Portal (OpenAI-compatible endpoint)
// ---------------------------------------------------------------------------
const client = new OpenAI({
  apiKey: process.env.AI_API_KEY,
  baseURL: process.env.AI_BASE_URL ?? "https://api.openai.com/v1",
});

const MODEL = process.env.AI_MODEL ?? "gpt-4o-mini";
const MAX_TOKENS = 512; // keep responses tight; bump if needed

// ---------------------------------------------------------------------------
//  Token & Context Helpers
// ---------------------------------------------------------------------------
function countTokens(text: string): number {
  const enc = get_encoding("o200k_base");
  const count = enc.encode(text, "all").length;
  enc.free();
  return count;
}

function compressWithRtk(jsonStr: string): string {
  try {
    const tmpFile = path.join(os.tmpdir(), `rtk_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.json`);
    fs.writeFileSync(tmpFile, jsonStr, "utf8");
    const compressed = execSync(`rtk json ${tmpFile} --ultra-compact`, { encoding: "utf8" });
    fs.unlinkSync(tmpFile);
    return compressed;
  } catch (err) {
    // If rtk is not available or fails, fallback to raw string
    return jsonStr;
  }
}

// ---------------------------------------------------------------------------
//  Tool definition — "The Menu"
//  The AI is ONLY allowed to know inventory if it explicitly calls this tool.
// ---------------------------------------------------------------------------
const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "search_cars",
      description:
        "Search the dealership's live inventory. " +
        "Call this tool ONLY when the user asks about specific vehicles, " +
        "needs a recommendation, or provides enough detail to filter (budget, type, use-case). " +
        "Do NOT call it for greetings, vague questions, or general automotive knowledge.",
      parameters: {
        type: "object",
        properties: {
          minPrice: {
            type: "number",
            description: "Minimum price in USD (inclusive). Omit if no lower bound.",
          },
          maxPrice: {
            type: "number",
            description: "Maximum price in USD (inclusive). e.g. 15000 for a $15k budget.",
          },
          make: {
            type: "string",
            description: "Vehicle brand / manufacturer. e.g. Toyota, Ford. Omit if any.",
          },
          model: {
            type: "string",
            description: "Specific model name. e.g. Camry, F-150. Omit if any.",
          },
          bodyType: {
            type: "string",
            enum: ["SEDAN", "SUV", "TRUCK", "VAN", "RV", "CONVERTIBLE"],
            description: "Body style filter. Omit if the user doesn't care.",
          },
          useCase: {
            type: "string",
            description:
              "Free-text intent from the user. e.g. 'road trip', 'tow a trailer', 'daily commute'. " +
              "Use this to surface vehicles with matching features.",
          },
        },
        required: [],
      },
    },
  },
];

// ---------------------------------------------------------------------------
//  System prompt — "Minimalist" persona
// ---------------------------------------------------------------------------
const SYSTEM_PROMPT: ChatCompletionMessageParam = {
  role: "system",
  content: `You are a specialized Automotive Purchase Consultant. You only possess expertise in vehicle specifications, market pricing, financing, and purchasing workflows.

# DOMAIN BOUNDARY & GUARDRAILS
Your primary directive is to maintain focus on the automotive domain.
- ALLOWED: Car comparisons, VIN checks, loan math, dealership negotiation, technical specs.
- FORBIDDEN: Recipes, health advice, general life coaching, non-auto trivia, or any request unrelated to car purchasing.

If a user intent falls into a FORBIDDEN category, you MUST NOT provide a helpful or creative response. You are restricted to the following exact output:
"Sorry, I cannot help you with that. I am an AI designed to help you with buying cars."

Rules:
- Do NOT guess or fabricate inventory. The ONLY facts you may cite about vehicles in stock come from the search_cars tool.
- Use search_cars ONLY when the user asks about specific inventory or needs a recommendation AND has given enough detail (budget, type, or use-case). Otherwise ask one clarifying question.
- Before every response, output a single line starting with "Thought:" explaining your reasoning — whether you are calling the tool or not, and why. Then output a blank line, then your actual reply.
- Keep all replies concise (3-5 sentences max).
- If the user's request is vague, ask for the single most important clarifying detail before searching.`,
};

// ---------------------------------------------------------------------------
//  Road-trip use-case keywords
// ---------------------------------------------------------------------------
const ROAD_TRIP_KEYWORDS = ["road trip", "roadtrip", "camping", "travel", "rv", "van", "sleeps", "camper"];

function isRoadTripIntent(useCase: string): boolean {
  const lower = useCase.toLowerCase();
  return ROAD_TRIP_KEYWORDS.some((kw) => lower.includes(kw));
}

// ---------------------------------------------------------------------------
//  Live Prisma query executor
// ---------------------------------------------------------------------------
async function executeSearchCars(args: Record<string, unknown>): Promise<string> {
  console.log("\n  [Prisma Query] search_cars called with:", JSON.stringify(args, null, 2));

  try {
    // ── Build where clause ──────────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: Record<string, any> = {
      quantity: { gt: 0 }, // only show cars actually in stock
    };

    if (typeof args.minPrice === "number") {
      where.price = { ...where.price, gte: args.minPrice };
    }
    if (typeof args.maxPrice === "number") {
      where.price = { ...where.price, lte: args.maxPrice };
    }
    if (typeof args.make === "string" && args.make) {
      where.make = { equals: args.make, mode: "insensitive" };
    }
    if (typeof args.model === "string" && args.model) {
      where.model = { equals: args.model, mode: "insensitive" };
    }
    if (typeof args.bodyType === "string" && args.bodyType) {
      where.bodyType = args.bodyType as VehicleType;
    }

    // ── Road-trip special logic ──────────────────────────────────────────────
    // If no explicit bodyType was set but useCase signals road-trip intent,
    // widen the query to include RVs, VANs, and vehicles with road-trip features.
    if (
      typeof args.useCase === "string" &&
      isRoadTripIntent(args.useCase) &&
      !args.bodyType
    ) {
      where.OR = [
        { bodyType: VehicleType.RV },
        { bodyType: VehicleType.VAN },
        { features: { hasSome: ["Bed", "Kitchenette", "Extra Storage", "Solar Panels", "Sleeps 4"] } },
      ];
    }

    // ── Query ────────────────────────────────────────────────────────────────
    const vehicles = await prisma.vehicle.findMany({
      where,
      orderBy: { price: "asc" },
      take: 10, // cap results to keep the AI context lean
      select: {
        id: true,
        make: true,
        model: true,
        year: true,
        price: true,
        mileage: true,
        bodyType: true,
        fuelType: true,
        transmission: true,
        condition: true,
        quantity: true,
        features: true,
        description: true,
        vin: true,
      },
    });

    console.log(`  [Prisma Query] Found ${vehicles.length} vehicle(s).\n`);

    return JSON.stringify({
      count: vehicles.length,
      filters: args,
      results: vehicles,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown DB error";
    console.error("  [Prisma Query] DB error:", message);
    return JSON.stringify({
      error: true,
      message:
        "I'm having trouble accessing the inventory right now. " +
        "Please try again in a moment or ask for different filters.",
    });
  }
}

// ---------------------------------------------------------------------------
//  Agent — single turn
//  Handles one user message, including any tool-call round-trip.
// ---------------------------------------------------------------------------
export interface TurnResult {
  history: ChatCompletionMessageParam[];
  tokensUsed: number;
  tokensSaved: number;
}

export async function runAgentTurn(
  history: ChatCompletionMessageParam[],
  userInput: string
): Promise<TurnResult> {
  let tokensUsed = 0;
  let tokensSaved = 0;

  // Append the new user message
  const messages: ChatCompletionMessageParam[] = [
    SYSTEM_PROMPT,
    ...history,
    { role: "user", content: userInput },
  ];

  // ── First call ────────────────────────────────────────────────────────────
  const response = await client.chat.completions.create({
    model: MODEL,
    messages,
    tools,
    tool_choice: "auto",
    max_tokens: MAX_TOKENS,
  });

  tokensUsed += response.usage?.total_tokens ?? 0;

  const assistantMsg = response.choices[0].message;

  // ── Tool-call branch ──────────────────────────────────────────────────────
  if (assistantMsg.tool_calls && assistantMsg.tool_calls.length > 0) {
    const toolResults: ChatCompletionMessageParam[] = [];

    for (const call of assistantMsg.tool_calls) {
      if (call.type !== "function") continue;

      const args = JSON.parse(call.function.arguments) as Record<string, unknown>;
      const rawResult = await executeSearchCars(args);
      
      const rawTokens = countTokens(rawResult);
      const compressed = compressWithRtk(rawResult);
      const compressedTokens = countTokens(compressed);
      
      if (rawTokens > compressedTokens) {
        tokensSaved += (rawTokens - compressedTokens);
      }

      toolResults.push({
        role: "tool",
        tool_call_id: call.id,
        content: compressed,
      });
    }

    // Second call — let the model compose its final reply with tool results
    const followUp = await client.chat.completions.create({
      model: MODEL,
      messages: [SYSTEM_PROMPT, ...history, { role: "user", content: userInput }, assistantMsg, ...toolResults],
      max_tokens: MAX_TOKENS,
    });

    tokensUsed += followUp.usage?.total_tokens ?? 0;
    const finalMsg = followUp.choices[0].message;
    console.log(`\nAssistant: ${finalMsg.content ?? ""}\n`);

    // Return updated history (without system prompt — it's always prepended)
    return {
      history: [
        ...history,
        { role: "user", content: userInput },
        assistantMsg,
        ...toolResults,
        { role: "assistant", content: finalMsg.content ?? "" },
      ],
      tokensUsed,
      tokensSaved,
    };
  }

  // ── Direct reply (no tool call) ───────────────────────────────────────────
  console.log(`\nAssistant: ${assistantMsg.content ?? ""}\n`);

  return {
    history: [
      ...history,
      { role: "user", content: userInput },
      { role: "assistant", content: assistantMsg.content ?? "" },
    ],
    tokensUsed,
    tokensSaved,
  };
}
