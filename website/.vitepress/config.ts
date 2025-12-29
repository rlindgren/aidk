import { defineConfig } from "vitepress";
import fs from "fs";

// Load typedoc sidebar if it exists (API docs may not be generated yet)
let typedocSidebar: Array<{ text: string; link: string }> = [];
try {
  const sidebarPath = new URL("../api/typedoc-sidebar.json", import.meta.url);
  if (fs.existsSync(sidebarPath)) {
    typedocSidebar = JSON.parse(fs.readFileSync(sidebarPath, "utf-8"));
  }
} catch {
  // API docs not generated yet, use empty sidebar
}

export default defineConfig({
  title: "AIDK",
  description:
    "Context engineering for AI agents. Control what your model sees on every tick.",
  base: "/aidk/",
  ignoreDeadLinks: true, // TODO: Fix remaining dead links as docs are completed

  head: [
    ["link", { rel: "icon", type: "image/svg+xml", href: "/aidk/logo.svg" }],
    ["meta", { name: "theme-color", content: "#3b9eff" }],
    ["meta", { property: "og:type", content: "website" }],
    [
      "meta",
      {
        property: "og:title",
        content: "AIDK - Context Engineering for AI Agents",
      },
    ],
    [
      "meta",
      {
        property: "og:description",
        content:
          "Control what your model sees on every tick. No templates. No YAML. Just code.",
      },
    ],
  ],

  themeConfig: {
    logo: "/logo.svg",

    nav: [
      { text: "Docs", link: "/docs/" },
      { text: "API", link: "/api/" },
      { text: "Examples", link: "/examples/" },
      {
        text: "GitHub",
        link: "https://github.com/rlindgren/aidk",
      },
    ],

    sidebar: {
      "/docs/": [
        {
          text: "Getting Started",
          items: [
            { text: "What is AIDK?", link: "/docs/" },
            { text: "Installation", link: "/docs/installation" },
            { text: "Quick Start", link: "/docs/getting-started" },
            { text: "Core Concepts", link: "/docs/concepts" },
          ],
        },
        {
          text: "Building Agents",
          items: [
            { text: "Components", link: "/docs/components" },
            { text: "State Management", link: "/docs/state-management" },
            { text: "Creating Tools", link: "/docs/guides/tools" },
            { text: "Semantic Primitives", link: "/docs/semantic-primitives" },
            { text: "Renderers", link: "/docs/guides/renderers" },
          ],
        },
        {
          text: "Advanced",
          items: [
            {
              text: "Progressive Adoption",
              link: "/docs/progressive-adoption",
            },
            { text: "Real-time Channels", link: "/docs/guides/channels" },
            { text: "Fork & Spawn", link: "/docs/guides/fork-spawn" },
          ],
        },
        {
          text: "Integration",
          items: [
            { text: "Vercel AI SDK", link: "/docs/adapters/ai-sdk" },
            { text: "Express", link: "/docs/frameworks/express" },
            { text: "React", link: "/docs/frameworks/react" },
          ],
        },
      ],
      "/examples/": [
        {
          text: "Examples",
          items: [
            { text: "Overview", link: "/examples/" },
            { text: "Simple Chat", link: "/examples/simple-chat" },
            { text: "Task Assistant", link: "/examples/task-assistant" },
          ],
        },
      ],
      "/api/": [
        {
          text: "API Reference",
          items: [{ text: "Overview", link: "/api/" }, ...typedocSidebar],
        },
      ],
    },

    socialLinks: [
      { icon: "github", link: "https://github.com/rlindgren/aidk" },
    ],

    footer: {
      message: "Released under the MIT License.",
      copyright: "Copyright 2024-present",
    },

    search: {
      provider: "local",
    },

    editLink: {
      pattern: "https://github.com/rlindgren/aidk/edit/main/website/:path",
      text: "Edit this page on GitHub",
    },
  },
});
