#!/usr/bin/env node
/**
 * Minimal post-processing for TypeDoc + VitePress compatibility.
 *
 * With useHTMLEncodedBrackets: true and sanitizeComments: true,
 * TypeDoc handles most escaping. This script handles remaining edge cases:
 *
 * 1. Wraps code blocks in v-pre to prevent Vue template parsing
 * 2. Escapes any remaining <Tag> patterns in prose
 * 3. Escapes curly braces that Vue interprets as interpolation
 * 4. Replaces TypeDoc index with custom API overview
 */

import { readdir, readFile, writeFile, stat, copyFile } from "fs/promises";
import { join } from "path";

const API_DIR = "./api";

async function processFile(filePath) {
  let content = await readFile(filePath, "utf-8");

  // Skip if already processed
  if (content.startsWith("<!-- PROCESSED -->")) {
    return false;
  }

  // Process line by line, handling code blocks specially
  const lines = content.split("\n");
  const result = [];
  let inCodeBlock = false;
  let codeBlockLines = [];

  for (const line of lines) {
    // Check for code block boundaries
    if (line.startsWith("```")) {
      if (!inCodeBlock) {
        // Starting a code block
        inCodeBlock = true;
        codeBlockLines = [line];
      } else {
        // Ending a code block - wrap it in v-pre
        codeBlockLines.push(line);
        result.push("<div v-pre>");
        result.push("");
        result.push(...codeBlockLines);
        result.push("");
        result.push("</div>");
        codeBlockLines = [];
        inCodeBlock = false;
      }
      continue;
    }

    if (inCodeBlock) {
      // Inside code block - just collect lines
      codeBlockLines.push(line);
      continue;
    }

    // Outside code block - apply escaping

    // a) Remove TypeDoc anchor tags <a id="..."></a> - they don't work in VitePress tables
    let escaped = line.replace(/<a\s+id="[^"]*"><\/a>\s*/g, "");

    // b) Escape ALL tag-like patterns: <word>, <Word>, </word>, </Word>
    // This is aggressive but safe - better to over-escape than have build failures
    escaped = escaped.replace(/(?<!&lt;)<(\/?[A-Za-z][A-Za-z0-9]*)([^>]*)>/g, "&lt;$1$2&gt;");

    // c) Convert backslash-escaped braces to HTML entities
    escaped = escaped.replace(/\\{/g, "&#123;");
    escaped = escaped.replace(/\\}/g, "&#125;");

    // d) Escape double curly braces {{ }}
    escaped = escaped.replace(/\{\{/g, "&#123;&#123;");
    escaped = escaped.replace(/\}\}/g, "&#125;&#125;");

    // e) Escape markdown image/link syntax with placeholder URLs
    // e.g., ![alt](url) - Vite tries to resolve "url" as a file
    escaped = escaped.replace(/!\[([^\]]*)\]\(url\)/g, "`![$1](url)`");

    result.push(escaped);
  }

  content = result.join("\n");

  // Add frontmatter to disable edit link (these are auto-generated, not in repo)
  // and add processed marker
  content = `---
editLink: false
---
<!-- PROCESSED -->
${content}`;

  await writeFile(filePath, content, "utf-8");
  return true;
}

async function processDirectory(dir) {
  let count = 0;
  const entries = await readdir(dir);

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stats = await stat(fullPath);

    if (stats.isDirectory()) {
      count += await processDirectory(fullPath);
    } else if (entry.endsWith(".md")) {
      if (await processFile(fullPath)) count++;
    }
  }
  return count;
}

async function replaceIndex() {
  // Replace TypeDoc-generated index with our custom API overview
  const customOverview = "./docs/api-overview.md";
  const apiIndex = "./api/index.md";

  try {
    await copyFile(customOverview, apiIndex);
    console.log("Replaced api/index.md with docs/api-overview.md");
  } catch (err) {
    console.warn("Could not replace API index:", err.message);
  }
}

console.log("Post-processing API docs for VitePress...");
processDirectory(API_DIR)
  .then(async (count) => {
    console.log(`Processed ${count} files.`);
    await replaceIndex();
  })
  .catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  });
