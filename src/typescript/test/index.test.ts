import path from "node:path";
import os from "node:os";
import { promises as fs } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  generateDirectoryIndexes,
  type DirectoryEntry,
  type DirectoryFileProvider,
  type DirectoryOutputWriter,
} from "../src/index.js";

class MemoryProvider implements DirectoryFileProvider {
  private directories = new Map<string, DirectoryEntry[]>();
  private files = new Map<string, string>();

  addDirectory(directoryPath: string, entries: DirectoryEntry[]) {
    this.directories.set(path.resolve(directoryPath), entries);
  }

  addFile(filePath: string, content = "") {
    this.files.set(path.resolve(filePath), content);
  }

  async readDirectory(directoryPath: string) {
    const entries = this.directories.get(path.resolve(directoryPath));
    if (!entries) throw new Error(`No directory: ${directoryPath}`);
    return entries;
  }

  async readFile(filePath: string) {
    const content = this.files.get(path.resolve(filePath));
    if (content === undefined) throw new Error(`No file: ${filePath}`);
    return content;
  }

  async isSymbolicLink() {
    return false;
  }
}

class RecordingWriter implements DirectoryOutputWriter {
  pages = new Map<string, string>();
  calls = 0;
  failure?: Error;

  async writeAll(outputRoot: string, pages: ReadonlyMap<string, string>) {
    this.calls++;
    if (this.failure) throw this.failure;
    this.pages = new Map(pages);
  }
}

describe("generateDirectoryIndexes", () => {
  it("generates root and nested pages with sorted entries", async () => {
    const root = path.join(os.tmpdir(), "directory-index-unit");
    const provider = new MemoryProvider();
    provider.addDirectory(root, [
      { name: "b.txt", isDirectory: false, isSymbolicLink: false },
      { name: "A", isDirectory: true, isSymbolicLink: false },
      { name: "a", isDirectory: true, isSymbolicLink: false },
    ]);
    provider.addDirectory(path.join(root, "A"), []);
    provider.addDirectory(path.join(root, "a"), [
      { name: "deep.txt", isDirectory: false, isSymbolicLink: false },
    ]);
    provider.addDirectory(path.join(root, "a"), [
      { name: "deep.txt", isDirectory: false, isSymbolicLink: false },
    ]);
    const writer = new RecordingWriter();

    const result = await generateDirectoryIndexes({
      folder: root,
      fileProvider: provider,
      outputWriter: writer,
    });

    expect(result.pageCount).toBe(3);
    expect(writer.pages.has("index.html")).toBe(true);
    expect(writer.pages.has("A/index.html")).toBe(true);
    expect(writer.pages.has("a/index.html")).toBe(true);
    expect(writer.pages.get("index.html")).toContain("A");
    expect(writer.calls).toBe(1);
  });

  it("excludes index.html and symlinks case-insensitively", async () => {
    const root = path.join(os.tmpdir(), "directory-index-exclusions");
    const provider = new MemoryProvider();
    provider.addDirectory(root, [
      { name: "INDEX.HTML", isDirectory: false, isSymbolicLink: false },
      { name: "link", isDirectory: true, isSymbolicLink: true },
      { name: "kept.txt", isDirectory: false, isSymbolicLink: false },
    ]);
    const writer = new RecordingWriter();
    await generateDirectoryIndexes({ folder: root, fileProvider: provider, outputWriter: writer });
    expect(writer.pages.get("index.html")).not.toContain("INDEX.HTML");
    expect(writer.pages.get("index.html")).not.toContain("link");
  });

  it("excludes an exact custom template path under the root", async () => {
    const root = path.join(os.tmpdir(), "directory-index-template");
    const template = path.join(root, "layout.liquid");
    const provider = new MemoryProvider();
    provider.addDirectory(root, [
      { name: "layout.liquid", isDirectory: false, isSymbolicLink: false },
      { name: "other.txt", isDirectory: false, isSymbolicLink: false },
    ]);
    provider.addFile(template, "Name: {{ directory.name }}");
    const writer = new RecordingWriter();
    await generateDirectoryIndexes({
      folder: root,
      template,
      fileProvider: provider,
      outputWriter: writer,
    });
    expect(writer.pages.get("index.html")).toBe("Name: directory-index-template");
  });

  it("renders strict custom Liquid templates and escapes values", async () => {
    const root = path.join(os.tmpdir(), "directory-index-liquid");
    const provider = new MemoryProvider();
    provider.addDirectory(root, [
      { name: "<badge>", isDirectory: false, isSymbolicLink: false },
    ]);
    provider.addFile(path.resolve("virtual-template"), "{{ directory.name }}: {{ entries[0].name }}");
    const writer = new RecordingWriter();
    await generateDirectoryIndexes({
      folder: root,
      template: "virtual-template",
      templateName: "unit-template",
      fileProvider: provider,
      outputWriter: writer,
    });
    expect(writer.pages.size).toBe(1);
    expect(writer.pages.get("index.html")).toContain("&lt;badge&gt;");
  });

  it("fails custom rendering before calling the writer", async () => {
    const root = path.join(os.tmpdir(), "directory-index-render-error");
    const provider = new MemoryProvider();
    provider.addDirectory(root, []);
    provider.addFile(path.resolve("virtual-template"), "{{ missing.value }}");
    const writer = new RecordingWriter();
    await expect(generateDirectoryIndexes({
      folder: root,
      template: "virtual-template",
      templateName: "unit-template",
      fileProvider: provider,
      outputWriter: writer,
    })).rejects.toThrow(/rendering template|undefined/i);
    expect(writer.calls).toBe(0);
  });

  it("rejects missing roots, missing templates, and whitespace folders", async () => {
    await expect(generateDirectoryIndexes({ folder: "   " })).rejects.toThrow(/folder/i);

    const provider = new MemoryProvider();
    await expect(generateDirectoryIndexes({
      folder: "/missing",
      fileProvider: provider,
      outputWriter: new RecordingWriter(),
    })).rejects.toThrow(/root directory/i);
  });

  it("supports more than 1000 entries", async () => {
    const root = path.join(os.tmpdir(), "directory-index-many");
    const provider = new MemoryProvider();
    provider.addDirectory(root, Array.from({ length: 1200 }, (_, index) => ({
      name: `file-${String(index).padStart(4, "0")}.txt`,
      isDirectory: false,
      isSymbolicLink: false,
    })));
    const writer = new RecordingWriter();
    await generateDirectoryIndexes({ folder: root, fileProvider: provider, outputWriter: writer });
    expect(writer.pages.size).toBe(1);
  });

  it("uses a physical directory and writes nested indexes", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "directory-index-physical-"));
    await fs.mkdir(path.join(root, "nested"));
    await fs.writeFile(path.join(root, "nested", "a.txt"), "a");
    await generateDirectoryIndexes({ folder: root });
    expect(await fs.readFile(path.join(root, "index.html"), "utf8")).toContain("nested");
    expect(await fs.readFile(path.join(root, "nested", "index.html"), "utf8")).toContain("a.txt");
  });
});
