import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  DirectoryEntry,
  DirectoryFileProvider,
} from "./index.js";

export class PhysicalFileProvider implements DirectoryFileProvider {
  constructor(private readonly root: string) {}

  async validateRoot(): Promise<void> {
    const resolved = path.resolve(this.root);
    let stat;
    try {
      stat = await fs.stat(resolved);
    } catch (error) {
      throw new Error(`Folder '${resolved}' does not exist or cannot be read.`, {
        cause: error,
      });
    }
    if (!stat.isDirectory()) {
      throw new Error(`Folder '${resolved}' is not a directory.`);
    }
  }

  async validateTemplate(templatePath: string): Promise<void> {
    const resolved = path.resolve(templatePath);
    let stat;
    try {
      stat = await fs.stat(resolved);
    } catch (error) {
      throw new Error(`Template '${resolved}' does not exist or cannot be read.`, {
        cause: error,
      });
    }
    if (!stat.isFile()) {
      throw new Error(`Template '${resolved}' is not a regular readable file.`);
    }
  }

  async readDirectory(directoryPath: string): Promise<DirectoryEntry[]> {
    const entries = await fs.readdir(directoryPath, { withFileTypes: true });
    const result: DirectoryEntry[] = [];
    for (const entry of entries) {
      const fullPath = path.join(directoryPath, entry.name);
      let symbolic = entry.isSymbolicLink();
      if (!symbolic) {
        try {
          const stat = await fs.lstat(fullPath);
          symbolic = stat.isSymbolicLink();
        } catch {
          symbolic = true;
        }
      }
      if (symbolic) continue;
      result.push({
        name: entry.name,
        isDirectory: entry.isDirectory(),
        isSymbolicLink: false,
      });
    }
    return result;
  }

  async readFile(filePath: string): Promise<string> {
    return fs.readFile(filePath, "utf8");
  }

  async isSymbolicLink(filePath: string): Promise<boolean> {
    try {
      return (await fs.lstat(filePath)).isSymbolicLink();
    } catch {
      return true;
    }
  }
}
