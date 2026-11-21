import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { DirectoryOutputWriter } from "./index.js";

function isInside(parent: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function comparePaths(left: string, right: string): number {
  const normalize = (value: string) =>
    process.platform === "win32" ? value.toLowerCase() : value;
  const leftNormalized = normalize(left);
  const rightNormalized = normalize(right);
  return leftNormalized < rightNormalized ? -1 : leftNormalized > rightNormalized ? 1 : 0;
}

export class TransactionalDirectoryOutputWriter implements DirectoryOutputWriter {
  async writeAll(
    outputRoot: string,
    pages: ReadonlyMap<string, string>,
  ): Promise<void> {
    const root = path.resolve(outputRoot);
    const tempBase = path.resolve(os.tmpdir());
    let stagingRoot: string;

    if (!isInside(root, tempBase)) {
      stagingRoot = await fs.mkdtemp(path.join(tempBase, "directory-index-"));
    } else {
      const parent = path.dirname(root);
      if (comparePaths(parent, root) === 0) {
        throw new Error(`No staging location outside the scanned folder '${root}' is available.`);
      }
      const sibling = path.join(parent, `.directory-index-${randomUUID()}`);
      await fs.mkdir(sibling);
      stagingRoot = sibling;
    }

    const staged = path.join(stagingRoot, "staged");
    const backups = path.join(stagingRoot, "backups");
    const originals = new Map<string, boolean>();
    const rollbackErrors: Error[] = [];
    const cleanupErrors: Error[] = [];
    let failure: unknown;
    let commitStarted = false;

    try {
      await fs.mkdir(staged, { recursive: true });
      await fs.mkdir(backups, { recursive: true });

      for (const [relativePath, content] of pages) {
        const stagedPath = resolveWithin(staged, relativePath);
        await fs.mkdir(path.dirname(stagedPath), { recursive: true });
        await fs.writeFile(stagedPath, content, "utf8");
      }

      for (const relativePath of pages.keys()) {
        const destination = resolveWithin(root, relativePath);
        let exists = false;
        try {
          exists = (await fs.stat(destination)).isFile();
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code !== "ENOENT") throw error;
        }
        originals.set(destination, exists);
        if (exists) {
          const backupPath = resolveWithin(backups, relativePath);
          await fs.mkdir(path.dirname(backupPath), { recursive: true });
          await fs.copyFile(destination, backupPath);
        }
      }

      commitStarted = true;
      for (const relativePath of pages.keys()) {
        const stagedPath = resolveWithin(staged, relativePath);
        const destination = resolveWithin(root, relativePath);
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await fs.copyFile(stagedPath, destination);
      }
    } catch (error) {
      failure = error;
      if (commitStarted) {
        for (const [destination, existed] of originals) {
          try {
            if (existed) {
              const relativePath = path.relative(root, destination);
              const backupPath = resolveWithin(backups, relativePath);
              await fs.copyFile(backupPath, destination);
            } else {
              await fs.rm(destination, { force: true });
            }
          } catch (rollbackError) {
            rollbackErrors.push(
              new Error(`Failed to roll back '${destination}'.`, {
                cause: rollbackError,
              }),
            );
          }
        }
      }
    }

    try {
      await fs.rm(stagingRoot, { recursive: true, force: true });
    } catch (error) {
      cleanupErrors.push(
        new Error(`Failed to clean staging directory '${stagingRoot}'.`, {
          cause: error,
        }),
      );
    }

    if (failure !== undefined) {
      if (rollbackErrors.length > 0 || cleanupErrors.length > 0) {
        throw new AggregateError(
          [toError(failure), ...rollbackErrors, ...cleanupErrors],
          "Output generation failed; rollback or cleanup operations also failed.",
        );
      }
      throw toError(failure);
    }

    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        cleanupErrors,
        "Output generation succeeded, but staging cleanup failed.",
      );
    }
  }
}

function resolveWithin(root: string, relativePath: string): string {
  if (relativePath.includes("\0")) {
    throw new Error(`Output path '${relativePath}' escapes the output root.`);
  }
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(root, relativePath.replace(/\//g, path.sep));
  if (!isInside(resolvedRoot, resolved)) {
    throw new Error(`Output path '${relativePath}' escapes the output root.`);
  }
  return resolved;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
