#!/usr/bin/env node
import { Command, CommanderError } from "commander";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { generateDirectoryIndexes } from "./index.js";

export async function runCli(
  argv: readonly string[] = process.argv,
): Promise<number> {
  const program = new Command();
  program
    .name("directory-index")
    .exitOverride()
    .configureOutput({
      writeErr: (message) => process.stderr.write(message),
    })
    .requiredOption("--folder <path>", "root directory to index")
    .option("--template <path>", "custom Liquid template");

  try {
    program.parse([...argv]);
    const options = program.opts<{ folder: string; template?: string }>();
    const folder = path.resolve(options.folder);
    await generateDirectoryIndexes({
      folder,
      template: options.template ? path.resolve(options.template) : undefined,
    });
    process.stdout.write(`Generated indexes under '${folder}'.\n`);
    return 0;
  } catch (error) {
    if (error instanceof CommanderError) {
      process.stderr.write(`${error.message}\n`);
    } else {
      process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
    }
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runCli().then((code) => {
    process.exitCode = code;
  });
}
