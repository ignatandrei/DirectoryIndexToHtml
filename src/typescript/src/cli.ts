#!/usr/bin/env node
import { Command, CommanderError } from "commander";
import { realpath } from "node:fs/promises";
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
    await generateDirectoryIndexes({
      folder: options.folder,
      template: options.template,
    });
    const folder = path.resolve(options.folder);
    process.stdout.write(`Generated indexes under '${folder}'.\n`);
    return 0;
  } catch (error) {
    if (error instanceof CommanderError) {
      if (error.exitCode === 0) return 0;
      process.stderr.write(`${error.message}\n`);
    } else {
      process.stderr.write(`Error: ${formatError(error)}\n`);
    }
    return 1;
  }
}

function formatError(error: unknown, indentation = ""): string {
  if (error instanceof AggregateError) {
    const members = [...error.errors]
      .map((member) => formatError(member, `${indentation}  `))
      .join("\n");
    return members
      ? `${indentation}${error.message}\n${members}`
      : `${indentation}${error.message}`;
  }

  const message = error instanceof Error ? error.message : String(error);
  const cause = error instanceof Error ? error.cause : undefined;
  return cause === undefined
    ? `${indentation}${message}`
    : `${indentation}${message}\n${formatError(cause, `${indentation}  `)}`;
}

const invokedPath = process.argv[1]
  ? await realpath(process.argv[1]).catch(() => undefined)
  : undefined;
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  runCli().then((code) => {
    process.exitCode = code;
  });
}
