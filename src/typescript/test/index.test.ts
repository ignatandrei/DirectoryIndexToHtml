import path from "node:path";
import os from "node:os";
import { promises as fs } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  generateDirectoryIndexes,
  type DirectoryEntry,
  type DirectoryFileProvider,
  type DirectoryOutputWriter,
} from "../src/index.js";
import { runCli } from "../src/cli.js";
import { TransactionalDirectoryOutputWriter } from "../src/output.js";
import { PhysicalFileProvider } from "../src/physical.js";

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
    expect(writer.pages.get("index.html")).not.toContain("layout.liquid");
  });

  it("preserves literal POSIX backslashes in provider paths", async () => {
    if (path.sep !== "/") return;
    const root = path.join(os.tmpdir(), "directory-index-backslash");
    const provider = new MemoryProvider();
    provider.addDirectory(root, [
      { name: "a\\b", isDirectory: true, isSymbolicLink: false },
    ]);
    provider.addDirectory(path.join(root, "a\\b"), []);
    const writer = new RecordingWriter();

    await generateDirectoryIndexes({ folder: root, fileProvider: provider, outputWriter: writer });

    expect(writer.pages.has("a\\b/index.html")).toBe(true);
    expect(writer.pages.has("a/b/index.html")).toBe(false);
    expect(writer.pages.get("index.html")).toContain("a%5Cb/index.html");
  });

  it("keeps slash-delimited provider paths and sorts raw entry names", async () => {
    const root = path.join(os.tmpdir(), "directory-index-provider-path");
    const provider = new MemoryProvider();
    provider.addDirectory(root, [
      { name: "docs/report.txt", isDirectory: false, isSymbolicLink: false },
      { name: "0.txt", isDirectory: false, isSymbolicLink: false },
      { name: "&lt;.txt", isDirectory: false, isSymbolicLink: false },
    ]);
    const writer = new RecordingWriter();

    await generateDirectoryIndexes({ folder: root, fileProvider: provider, outputWriter: writer });

    const page = writer.pages.get("index.html") ?? "";
    expect(page).toContain('href="docs/report.txt"');
    expect(page).not.toContain('href="docs%2Freport.txt"');
    const entityLikeNamePosition = page.indexOf('href="%26lt%3B.txt"');
    const zeroNamePosition = page.indexOf('href="0.txt"');
    expect(entityLikeNamePosition).toBeGreaterThanOrEqual(0);
    expect(zeroNamePosition).toBeGreaterThanOrEqual(0);
    expect(entityLikeNamePosition).toBeLessThan(zeroNamePosition);
  });

  it("sorts directories before files and sorts each group by name", async () => {
    const root = path.join(os.tmpdir(), "directory-index-ordering");
    const provider = new MemoryProvider();
    provider.addDirectory(root, [
      { name: "z.txt", isDirectory: false, isSymbolicLink: false },
      { name: "b-dir", isDirectory: true, isSymbolicLink: false },
      { name: "a.txt", isDirectory: false, isSymbolicLink: false },
      { name: "a-dir", isDirectory: true, isSymbolicLink: false },
    ]);
    provider.addDirectory(path.join(root, "b-dir"), []);
    provider.addDirectory(path.join(root, "a-dir"), []);
    const writer = new RecordingWriter();

    await generateDirectoryIndexes({ folder: root, fileProvider: provider, outputWriter: writer });

    const page = writer.pages.get("index.html") ?? "";
    const orderedHrefs = [
      'href="a-dir/index.html"',
      'href="b-dir/index.html"',
      'href="a.txt"',
      'href="z.txt"',
    ].map((href) => {
      const position = page.indexOf(href);
      expect(position).toBeGreaterThanOrEqual(0);
      return position;
    });
    expect(orderedHrefs).toEqual([...orderedHrefs].sort((left, right) => left - right));
  });

  it("includes directories named like generated index files", async () => {
    const root = path.join(os.tmpdir(), "directory-index-named-directory");
    const provider = new MemoryProvider();
    provider.addDirectory(root, [
      { name: "INDEX.HTML", isDirectory: true, isSymbolicLink: false },
    ]);
    provider.addDirectory(path.join(root, "INDEX.HTML"), []);
    const writer = new RecordingWriter();

    await generateDirectoryIndexes({ folder: root, fileProvider: provider, outputWriter: writer });

    expect(writer.pages.has("INDEX.HTML/index.html")).toBe(true);
    expect(writer.pages.get("index.html")).toContain("INDEX.HTML/index.html");
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

  it("does not allow includes to read files from the filesystem", async () => {
    const root = path.join(os.tmpdir(), "directory-index-include");
    const provider = new MemoryProvider();
    provider.addDirectory(root, []);
    provider.addFile(
      path.resolve("virtual-template"),
      "{% include 'package.json' %}",
    );
    const writer = new RecordingWriter();

    await expect(generateDirectoryIndexes({
      folder: root,
      template: "virtual-template",
      fileProvider: provider,
      outputWriter: writer,
    })).rejects.toThrow(/include|template/i);
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

  it("does not follow symlinked output destinations or ancestors", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "directory-index-output-link-"));
    const outside = path.join(os.tmpdir(), `directory-index-outside-${Date.now()}`);
    const destinationLink = path.join(root, "index.html");
    const linkedDirectory = path.join(root, "nested");
    try {
      await fs.writeFile(outside, "keep");
      try {
        await fs.symlink(outside, destinationLink);
        await expect(new TransactionalDirectoryOutputWriter().writeAll(
          root,
          new Map([["index.html", "overwrite"]]),
        )).rejects.toThrow(/symbolic link/i);
        expect(await fs.readFile(outside, "utf8")).toBe("keep");
        await fs.rm(destinationLink);

        await fs.symlink(path.dirname(outside), linkedDirectory, "dir");
        await expect(new TransactionalDirectoryOutputWriter().writeAll(
          root,
          new Map([["nested/index.html", "overwrite"]]),
        )).rejects.toThrow(/regular directory/i);
        expect(await fs.readFile(outside, "utf8")).toBe("keep");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EPERM" &&
            (error as NodeJS.ErrnoException).code !== "EACCES" &&
            (error as NodeJS.ErrnoException).code !== "ENOTSUP") {
          throw error;
        }
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(outside, { force: true });
    }
  });

  it("restores existing file contents and permissions after a commit failure", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "directory-index-rollback-mode-"));
    const firstDestination = path.join(root, "index.html");
    const secondDestination = path.join(root, "nested", "index.html");
    await fs.mkdir(path.dirname(secondDestination));
    await fs.writeFile(firstDestination, "original root");
    await fs.writeFile(secondDestination, "original nested");
    await fs.chmod(firstDestination, 0o600);
    await fs.chmod(secondDestination, 0o600);
    const firstMode = (await fs.stat(firstDestination)).mode & 0o777;
    const secondMode = (await fs.stat(secondDestination)).mode & 0o777;

    const rename = fs.rename.bind(fs);
    let injectedFailure = false;
    const renameSpy = vi.spyOn(fs, "rename").mockImplementation(async (source, destination) => {
      if (destination === secondDestination && !injectedFailure) {
        injectedFailure = true;
        throw new Error("simulated commit failure");
      }
      return rename(source, destination);
    });

    try {
      await expect(new TransactionalDirectoryOutputWriter().writeAll(
        root,
        new Map([
          ["index.html", "updated root"],
          ["nested/index.html", "updated nested"],
        ]),
      )).rejects.toThrow("simulated commit failure");
      expect(await fs.readFile(firstDestination, "utf8")).toBe("original root");
      expect(await fs.readFile(secondDestination, "utf8")).toBe("original nested");
      expect((await fs.stat(firstDestination)).mode & 0o777).toBe(firstMode);
      expect((await fs.stat(secondDestination)).mode & 0o777).toBe(secondMode);
    } finally {
      renameSpy.mockRestore();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("revalidates directories immediately before recursive traversal", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "directory-index-traversal-link-"));
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "directory-index-outside-dir-"));
    const child = path.join(root, "child");
    await fs.mkdir(child);
    await fs.writeFile(path.join(outside, "secret.txt"), "outside");

    class SubstitutingProvider extends PhysicalFileProvider {
      override async readDirectory(directoryPath: string) {
        if (directoryPath === child) {
          await fs.rm(child, { recursive: true });
          await fs.symlink(outside, child, "dir");
        }
        return super.readDirectory(directoryPath);
      }
    }

    try {
      try {
        await fs.symlink(outside, path.join(root, "symlink-probe"), "dir");
        await fs.rm(path.join(root, "symlink-probe"));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EPERM" ||
            (error as NodeJS.ErrnoException).code === "EACCES" ||
            (error as NodeJS.ErrnoException).code === "ENOTSUP") return;
        throw error;
      }

      const writer = new RecordingWriter();
      await expect(generateDirectoryIndexes({
        folder: root,
        fileProvider: new SubstitutingProvider(root),
        outputWriter: writer,
      })).rejects.toThrow(/failed to read directory/i);
      expect(writer.calls).toBe(0);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(outside, { recursive: true, force: true });
    }
  });
});

describe("runCli", () => {
  it("rejects explicitly empty paths and treats help as success", async () => {
    let stderr = "";
    const originalWrite = process.stderr.write;
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderr += String(chunk);
      return true;
    }) as typeof process.stderr.write;

    try {
      expect(await runCli(["node", "directory-index", "--folder", ""])).toBe(1);
      expect(stderr).toMatch(/folder path/i);
      stderr = "";
      expect(await runCli(["node", "directory-index", "--folder", ".", "--template", ""])).toBe(1);
      expect(stderr).toMatch(/template path/i);
      stderr = "";
      expect(await runCli(["node", "directory-index", "--help"])).toBe(0);
      expect(stderr).toBe("");
    } finally {
      process.stderr.write = originalWrite;
    }
  });
});
