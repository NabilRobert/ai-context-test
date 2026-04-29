import "dotenv/config";
import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { PrismaClient, VehicleType } from "@prisma/client";

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
  content: `You are a professional car dealer assistant.

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
export async function runAgentTurn(
  history: ChatCompletionMessageParam[],
  userInput: string
): Promise<ChatCompletionMessageParam[]> {
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

  const assistantMsg = response.choices[0].message;

  // ── Tool-call branch ──────────────────────────────────────────────────────
  if (assistantMsg.tool_calls && assistantMsg.tool_calls.length > 0) {
    const toolResults: ChatCompletionMessageParam[] = [];

    for (const call of assistantMsg.tool_calls) {
      if (call.type !== "function") continue;

      const args = JSON.parse(call.function.arguments) as Record<string, unknown>;
      const result = await executeSearchCars(args);

      toolResults.push({
        role: "tool",
        tool_call_id: call.id,
        content: result,
      });
    }

    // Second call — let the model compose its final reply with tool results
    const followUp = await client.chat.completions.create({
      model: MODEL,
      messages: [SYSTEM_PROMPT, ...history, { role: "user", content: userInput }, assistantMsg, ...toolResults],
      max_tokens: MAX_TOKENS,
    });

    const finalMsg = followUp.choices[0].message;
    console.log(`\nAssistant: ${finalMsg.content ?? ""}\n`);

    // Return updated history (without system prompt — it's always prepended)
    return [
      ...history,
      { role: "user", content: userInput },
      assistantMsg,
      ...toolResults,
      { role: "assistant", content: finalMsg.content ?? "" },
    ];
  }

  // ── Direct reply (no tool call) ───────────────────────────────────────────
  console.log(`\nAssistant: ${assistantMsg.content ?? ""}\n`);

  return [
    ...history,
    { role: "user", content: userInput },
    { role: "assistant", content: assistantMsg.content ?? "" },
  ];
}
