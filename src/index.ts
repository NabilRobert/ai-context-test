import * as readline from "readline";

// ---------------------------------------------------------------------------
//  main — async wrapper, ready for future DB / AI awaits
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false, // non-blocking; works in piped & interactive modes
  });

  console.log("what can I help you with today?");

  // Process each line of input as it arrives
  rl.on("line", (input: string) => {
    const trimmed = input.trim();

    if (trimmed === "exit" || trimmed === "quit") {
      console.log("Goodbye!");
      rl.close();
      process.exit(0);
    }

    console.log(`[Local Test]: ${trimmed}`);
  });

  // Graceful exit on Ctrl+C (SIGINT) or end-of-stream
  rl.on("close", () => {
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
