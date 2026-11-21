import path from "node:path";
import { Liquid } from "liquidjs";
import { PhysicalFileProvider } from "./physical.js";
import { TransactionalDirectoryOutputWriter } from "./output.js";

export interface DirectoryEntry {
  name: string;
  isDirectory: boolean;
  isSymbolicLink: boolean;
}

export interface DirectoryFileProvider {
  readDirectory(path: string): Promise<DirectoryEntry[]>;
  readFile(path: string): Promise<string>;
  isSymbolicLink(path: string): Promise<boolean>;
}

export interface DirectoryOutputWriter {
  writeAll(
    outputRoot: string,
    pages: ReadonlyMap<string, string>,
  ): Promise<void>;
}

export interface GenerateDirectoryIndexesOptions {
  folder: string;
  template?: string;
  templateName?: string;
  fileProvider?: DirectoryFileProvider;
  outputWriter?: DirectoryOutputWriter;
}

export interface GenerateDirectoryIndexesResult {
  pageCount: number;
  pages: string[];
}

interface LiquidEntry {
  name: string;
  path: string;
  is_directory: boolean;
  href: string;
}

interface LiquidBreadcrumb {
  name: string;
  href: string;
  is_current: boolean;
}

export const DEFAULT_TEMPLATE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{{ directory.name }}</title>
</head>
<body>
  <nav aria-label="Breadcrumb">
    {% for crumb in breadcrumbs %}
      {% if crumb.is_current %}<span aria-current="page">{{ crumb.name }}</span>{% else %}<a href="{{ crumb.href }}">{{ crumb.name }}</a>{% endif %}{% unless forloop.last %} / {% endunless %}
    {% endfor %}
  </nav>
  <main>
    <h1>{{ directory.name }}</h1>
    {% if entries.size == 0 %}
      <p>No files or folders</p>
    {% else %}
      <ul>
      {% for entry in entries %}
        <li><a href="{{ entry.href }}">{{ entry.name }}</a></li>
      {% endfor %}
      </ul>
    {% endif %}
  </main>
</body>
</html>`;

function normalizeProviderPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

function isWindows(): boolean {
  return process.platform === "win32";
}

function pathKey(value: string): string {
  const normalized = normalizeProviderPath(path.resolve(value));
  return isWindows() ? normalized.toLowerCase() : normalized;
}

function escapePathSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function compareNames(left: string, right: string): number {
  const leftFolded = left.toUpperCase();
  const rightFolded = right.toUpperCase();
  if (leftFolded < rightFolded) return -1;
  if (leftFolded > rightFolded) return 1;
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function toLiquidDataValue(value: unknown): unknown {
  return value;
}

function createBreadcrumbs(
  ancestors: string[],
  currentName: string,
): LiquidBreadcrumb[] {
  const names = [...ancestors, currentName];
  const currentDepth = names.length - 1;
  return names.map((name, index) => {
    const upLevels = currentDepth - index;
    const href = [...Array(upLevels).fill(".."), "index.html"].join("/");
    return {
      name: toLiquidDataValue(name) as string,
      href,
      is_current: index === currentDepth,
    };
  });
}

export async function generateDirectoryIndexes(
  options: GenerateDirectoryIndexesOptions,
): Promise<GenerateDirectoryIndexesResult> {
  if (typeof options?.folder !== "string" || options.folder.trim().length === 0) {
    throw new Error("Folder path must not be null, empty, or whitespace.");
  }

  const root = path.resolve(options.folder);
  const provider = options.fileProvider ?? new PhysicalFileProvider(root);
  const writer =
    options.outputWriter ?? new TransactionalDirectoryOutputWriter();

  let templateSource = DEFAULT_TEMPLATE;
  let templateName = "built-in template";
  let excludedTemplatePath: string | undefined;

  if (options.template !== undefined) {
    if (typeof options.template !== "string" || options.template.trim().length === 0) {
      throw new Error("Template path must not be null, empty, or whitespace.");
    }
    const templatePath = path.resolve(options.template);
    templateName = options.templateName ?? templatePath;

    if (!options.fileProvider) {
      await (provider as PhysicalFileProvider).validateTemplate(templatePath);
    }

    try {
      templateSource = await provider.readFile(templatePath);
    } catch (error) {
      throw new Error(`Failed to read template '${templateName}'.`, { cause: error });
    }
    excludedTemplatePath = normalizeProviderPath(templatePath);
  }

  const liquid = new Liquid({
    strictVariables: true,
    outputEscape: "escape",
  });
  let parsedTemplate: Awaited<ReturnType<Liquid["parse"]>>;
  try {
    parsedTemplate = liquid.parse(templateSource);
  } catch (error) {
    throw new Error(
      `Template '${templateName}' parse failed: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }

  const pages = new Map<string, string>();
  const rootName = path.basename(root) || root;
  const templateExclusionKey = excludedTemplatePath
    ? isTemplateUnderRoot(excludedTemplatePath, root)
      ? pathKey(excludedTemplatePath)
      : undefined
    : undefined;

  async function renderDirectory(
    directoryAbsolutePath: string,
    directoryRelativePath: string,
    directoryName: string,
    ancestors: string[],
  ): Promise<void> {
    let children: DirectoryEntry[];
    try {
      children = await provider.readDirectory(directoryAbsolutePath);
    } catch (error) {
      throw new Error(
        `Failed to read directory '${directoryAbsolutePath}'.`,
        { cause: error },
      );
    }

    const entries: LiquidEntry[] = [];
    const childDirectories: Array<{
      absolutePath: string;
      relativePath: string;
      name: string;
    }> = [];

    for (const child of children) {
      if (child.isSymbolicLink) continue;
      if (/^index\.html$/i.test(child.name)) continue;

      const childRelativePath = directoryRelativePath
        ? `${directoryRelativePath}/${child.name}`
        : child.name;
      const childAbsolutePath = path.join(directoryAbsolutePath, child.name);
      if (templateExclusionKey && pathKey(childAbsolutePath) === templateExclusionKey) {
        continue;
      }

      const escapedName = escapePathSegment(child.name);
      entries.push({
        name: toLiquidDataValue(child.name) as string,
        path: normalizeProviderPath(childRelativePath),
        is_directory: child.isDirectory,
        href: child.isDirectory ? `${escapedName}/index.html` : escapedName,
      });

      if (child.isDirectory) {
        childDirectories.push({
          absolutePath: childAbsolutePath,
          relativePath: normalizeProviderPath(childRelativePath),
          name: child.name,
        });
      }
    }

    entries.sort((left, right) => {
      if (left.is_directory !== right.is_directory) {
        return left.is_directory ? -1 : 1;
      }
      const decodedLeft = decodeHtml(left.name);
      const decodedRight = decodeHtml(right.name);
      return compareNames(decodedLeft, decodedRight);
    });

    const breadcrumbs = createBreadcrumbs(ancestors, directoryName);
    const data = {
      directory: {
        name: toLiquidDataValue(directoryName),
        path: normalizeProviderPath(directoryRelativePath),
      },
      entries,
      breadcrumbs,
    };

    let page: string;
    try {
      page = await liquid.render(parsedTemplate, data);
    } catch (error) {
      const relative = directoryRelativePath || ".";
      throw new Error(
        `Rendering template '${templateName}' failed for directory '${relative}': ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }

    const outputPath =
      directoryRelativePath.length === 0
        ? "index.html"
        : `${normalizeProviderPath(directoryRelativePath)}/index.html`;
    if (outputPath.includes("\0") || outputPath.split("/").includes("..")) {
      throw new Error(`Generated output path '${outputPath}' escapes the output root.`);
    }
    pages.set(outputPath, page);

    for (const child of childDirectories) {
      await renderDirectory(
        child.absolutePath,
        child.relativePath,
        child.name,
        [...ancestors, directoryName],
      );
    }
  }

  if (!options.fileProvider) {
    await (provider as PhysicalFileProvider).validateRoot();
  } else {
    try {
      await provider.readDirectory(root);
    } catch (error) {
      throw new Error(`Failed to read root directory '${root}'.`, { cause: error });
    }
  }

  await renderDirectory(root, "", rootName, []);
  await writer.writeAll(root, pages);

  return {
    pageCount: pages.size,
    pages: [...pages.keys()],
  };
}

function decodeHtml(value: string): string {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&");
}

function isTemplateUnderRoot(templatePath: string, root: string): boolean {
  const relative = path.relative(root, templatePath);
  return relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative);
}

export { PhysicalFileProvider } from "./physical.js";
export { TransactionalDirectoryOutputWriter } from "./output.js";
