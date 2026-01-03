import { defineConfig } from "vitepress";
import { withMermaid } from "vitepress-plugin-mermaid";
import fs from "fs";

// Load typedoc sidebar if it exists (API docs may not be generated yet)
// Strip .md extensions from links for VitePress clean URLs
function stripMdExtensions(items: any[]): any[] {
  return items.map((item) => ({
    ...item,
    link: item.link?.replace(/\.md$/, ""),
    items: item.items ? stripMdExtensions(item.items) : undefined,
  }));
}

let typedocSidebar: Array<{ text: string; link?: string; items?: any[] }> = [];
try {
  const sidebarPath = new URL("../api/typedoc-sidebar.json", import.meta.url);
  if (fs.existsSync(sidebarPath)) {
    const rawSidebar = JSON.parse(fs.readFileSync(sidebarPath, "utf-8"));
    typedocSidebar = stripMdExtensions(rawSidebar);
  }
} catch {
  // API docs not generated yet, use empty sidebar
}

export default withMermaid(
  defineConfig({
    title: "AIDK",
    description:
      "A runtime engine for model-driven applications. Your code runs between model calls.",
    base: "/aidk/",
    ignoreDeadLinks: true, // TODO: Fix remaining dead links as docs are completed

    vite: {
      optimizeDeps: {
        include: ["mermaid", "dayjs"],
      },
      ssr: {
        noExternal: ["mermaid"],
      },
    },

    head: [
      ["link", { rel: "icon", type: "image/svg+xml", href: "/aidk/logo-mark.svg" }],
      ["meta", { name: "theme-color", content: "#3b9eff" }],
      // Open Graph
      ["meta", { property: "og:type", content: "website" }],
      ["meta", { property: "og:site_name", content: "AIDK" }],
      [
        "meta",
        { property: "og:title", content: "AIDK - Runtime Engine for Model-Driven Applications" },
      ],
      [
        "meta",
        {
          property: "og:description",
          content:
            "Your code runs between model calls. Build agents today. Build world model apps tomorrow.",
        },
      ],
      ["meta", { property: "og:image", content: "https://rlindgren.github.io/aidk/og-image.png" }],
      ["meta", { property: "og:image:type", content: "image/png" }],
      ["meta", { property: "og:image:width", content: "1200" }],
      ["meta", { property: "og:image:height", content: "630" }],
      // Twitter Card
      ["meta", { name: "twitter:card", content: "summary_large_image" }],
      [
        "meta",
        { name: "twitter:title", content: "AIDK - Runtime Engine for Model-Driven Applications" },
      ],
      [
        "meta",
        {
          name: "twitter:description",
          content:
            "Your code runs between model calls. Build agents today. Build world model apps tomorrow.",
        },
      ],
      ["meta", { name: "twitter:image", content: "https://rlindgren.github.io/aidk/og-image.png" }],
    ],

    themeConfig: {
      logo: "/logo-mark.svg",
      siteTitle: "AIDK",

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
            ],
          },
          {
            text: "Learn",
            items: [
              { text: "Overview", link: "/docs/learn/" },
              { text: "Understanding Ticks", link: "/docs/learn/understanding-ticks" },
              { text: "Tools as Components", link: "/docs/learn/tools-as-components" },
              { text: "Components as Tools", link: "/docs/learn/components-as-tools" },
              { text: "Reactive State", link: "/docs/learn/reactive-state" },
              { text: "Dynamic Models", link: "/docs/learn/dynamic-models" },
              { text: "Parallel Agents", link: "/docs/learn/parallel-agents" },
              { text: "Autonomous Loops", link: "/docs/learn/autonomous-loops" },
            ],
          },
          {
            text: "Core Concepts",
            items: [
              { text: "Runtime Architecture", link: "/docs/concepts/runtime-architecture" },
              { text: "Context Object Model", link: "/docs/concepts/context-object-model" },
              { text: "Tick Lifecycle", link: "/docs/concepts/tick-lifecycle" },
              { text: "Overview", link: "/docs/concepts" },
            ],
          },
          {
            text: "Building Agents",
            items: [
              { text: "Components", link: "/docs/components" },
              { text: "State Management", link: "/docs/state-management" },
              { text: "Creating Tools", link: "/docs/guides/tools" },
              { text: "Semantic Primitives", link: "/docs/semantic-primitives" },
              { text: "Ephemeral vs Persisted", link: "/docs/guides/ephemeral-content" },
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
              { text: "Procedures & Middleware", link: "/docs/advanced/procedures" },
              { text: "Metrics & Telemetry", link: "/docs/guides/metrics-telemetry" },
              { text: "Error Handling", link: "/docs/guides/error-handling" },
              { text: "Testing", link: "/docs/guides/testing" },
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
          {
            text: "Reference",
            items: [{ text: "Message Roles", link: "/docs/reference/message-roles" }],
          },
        ],
        "/examples/": [
          {
            text: "Examples",
            items: [
              { text: "Overview", link: "/examples/" },
              { text: "Simple Chat", link: "/examples/simple-chat" },
              { text: "Task Assistant", link: "/examples/task-assistant" },
              { text: "Multi-Agent", link: "/examples/multi-agent" },
              { text: "Dynamic Router", link: "/examples/dynamic-router" },
              { text: "User Memory", link: "/examples/user-memory" },
              { text: "Voting Consensus", link: "/examples/voting-consensus" },
              { text: "Progressive Adoption", link: "/examples/progressive-adoption" },
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

      socialLinks: [{ icon: "github", link: "https://github.com/rlindgren/aidk" }],

      footer: {
        message: "Released under the MIT License.",
        copyright: "Copyright 2024-present",
      },

      search: {
        provider: "local",
      },

      editLink: {
        pattern: "https://github.com/rlindgren/aidk/edit/master/website/:path",
        text: "Edit this page on GitHub",
      },
    },
  }),
);
