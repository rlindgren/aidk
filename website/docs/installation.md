# Installation Guide

Get started with AIDK in minutes.

## Prerequisites

- Node.js 20 or later
- Package manager: pnpm (recommended), npm, or yarn

## Quick Install

Choose your integration path:

<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 1rem; margin: 2rem 0;">

<div class="feature-card">

### Progressive (AI SDK Users)

Start with minimal changes to existing code.

```bash
pnpm add @aidk/ai-sdk
```

[Progressive Adoption →](/docs/progressive-adoption)

</div>

<div class="feature-card">

### Full Framework

Complete framework with all features.

```bash
pnpm add aidk aidk-kernel
pnpm add @aidk/ai-sdk ai @ai-sdk/openai
```

[Getting Started →](/docs/getting-started)

</div>

</div>

## Core Packages

### Essential

```bash
# Core framework
pnpm add aidk aidk-kernel

# Choose an AI provider adapter
pnpm add @aidk/ai-sdk ai @ai-sdk/openai    # Vercel AI SDK
# OR
pnpm add @aidk/openai                      # Direct OpenAI
# OR
pnpm add @aidk/google                      # Google AI
```

### Server Integration

```bash
# Express.js
pnpm add aidk-express express

# NestJS
pnpm add aidk-nestjs @nestjs/common @nestjs/core
```

### Client Integration

```bash
# React
pnpm add aidk-react aidk-client

# Angular
pnpm add aidk-angular aidk-client
```

## TypeScript Configuration

AIDK requires JSX configuration. Update your `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "jsx": "react-jsx",
    "jsxImportSource": "aidk",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  }
}
```

## Package Manager Notes

### pnpm (Recommended)

```bash
pnpm add aidk
```

**Why pnpm?** Faster installs, better disk usage, strict dependency resolution.

**Installing in current directory only (ignore workspace):**

If you're in a pnpm workspace but want to install packages only in the current directory:

```bash
# Install in current directory, ignore workspace root
pnpm add --ignore-workspace aidk

# Or use the -w flag to disable workspace protocol
pnpm add -w aidk
```

Note: Use `--ignore-workspace` when you want packages installed locally rather than hoisted to the workspace root.

### npm

```bash
npm install aidk
```

### yarn

```bash
yarn add aidk
```

## Verify Installation

Create a test file to verify everything works:

``` tsx
// test.ts
import { Component } from 'aidk';

class TestAgent extends Component {
  render() {
    return <section>Hello AIDK</section>;
  }
}

console.log('✅ AIDK installed successfully!');
```

Run it:

```bash
npx tsx test.ts
```

## Common Issues

### JSX Transform Error

**Error:** `Cannot find module 'aidk/jsx-runtime'`

**Fix:** Ensure `jsxImportSource` is set to `"aidk"` in `tsconfig.json`

### Module Resolution

**Error:** `Cannot find module 'aidk'`

**Fix:** Use `"moduleResolution": "NodeNext"` or `"bundler"` in `tsconfig.json`

### Type Errors

**Error:** Type errors in IDE

**Fix:** Restart your TypeScript server or IDE

## Version Compatibility

| AIDK Version | Node.js | TypeScript |
|--------------|---------|------------|
| 1.x          | ≥ 20    | ≥ 5.0      |

## Monorepo Setup

If you're using a monorepo (Turborepo, Nx, etc.), install AIDK in individual packages:

```bash
# In your agent package
cd packages/agents
pnpm add aidk aidk-kernel @aidk/ai-sdk

# In your server package
cd packages/server
pnpm add aidk-express
```

## Docker

For Docker deployments:

```dockerfile
FROM node:20-alpine

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source
COPY . .

# Build
RUN pnpm build

CMD ["node", "dist/server.js"]
```

## Next Steps

<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-top: 2rem;">

<div class="feature-card">

### Quick Start

[Build your first agent →](/docs/getting-started)

</div>

<div class="feature-card">

### Progressive Adoption

[Start with compile() →](/docs/progressive-adoption)

</div>

<div class="feature-card">

### Examples

[See working code →](/examples/)

</div>

</div>











