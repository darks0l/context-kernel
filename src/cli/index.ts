#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { ContextKernel } from "../core/kernel.js";
import type { KernelConfig, KernelInput } from "../core/types.js";

function parseArgs() {
  const args = process.argv.slice(2);
  const out: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 1) {
    const key = args[i];
    if (key.startsWith("--")) out[key.slice(2)] = args[i + 1];
  }
  return out;
}

async function main() {
  const args = parseArgs();

  if (!args.config || !args.input) {
    console.error("Usage: context-kernel --config ./kernel.config.json --input ./input.json");
    process.exit(1);
  }

  const config = JSON.parse(readFileSync(args.config, "utf8")) as KernelConfig;
  const input = JSON.parse(readFileSync(args.input, "utf8")) as KernelInput;

  const kernel = new ContextKernel(config, {
    onEvent: (event) => {
      if (!args.quiet) console.log(JSON.stringify(event));
    }
  });

  const decision = await kernel.decide(input);
  console.log(JSON.stringify({ decision }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
