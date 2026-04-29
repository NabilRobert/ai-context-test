import "dotenv/config";
import * as readline from "readline";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { runAgentTurn } from "./agent";

// ---------------------------------------------------------------------------
//  main — async readline loop wired to the AI agent
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  })

  // Persistent conversation history (excludes system prompt — agent prepends it)
  let history: ChatCompletionMessageParam[] = [];

  console.log("\n🚗  Used Car Lot AI — powered by Sumopod");
  console.log("    Type your question, or 'exit' to quit.\n");
  console.log("What can I help you with today?\n");

  // Promisify readline so we can await each answer inside an async loop
  const question = (prompt: string): Promise<string> =>
    new Promise((resolve) => rl.question(prompt, resolve));

  // Graceful exit on Ctrl+C
  rl.on("SIGINT", () => {
    console.log("\nGoodbye!");
    process.exit(0);
  });

  while (true) {
    const input = await question("You: ");
    const trimmed = input.trim();

    if (!trimmed) continue;

    if (trimmed === "exit" || trimmed === "quit") {
      console.log("Goodbye!");
      rl.close();
      process.exit(0);
    }

    try {
      history = await runAgentTurn(history, trimmed);
    } catch (err) {
      console.error("\n[Error] Agent call failed:", (err as Error).message, "\n");
    }
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
