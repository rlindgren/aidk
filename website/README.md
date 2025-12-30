# AIDK Website

Official documentation website for AIDK, built with VitePress.

## Development

```bash
# Install dependencies
pnpm install

# Start dev server
pnpm dev

# Build for production
pnpm build

# Preview production build
pnpm preview
```

## Structure

```
website/
├── .vitepress/
│   ├── config.ts          # VitePress configuration
│   └── theme/
│       ├── index.ts       # Theme customization
│       └── custom.css     # Custom styles
├── index.md               # Landing page
├── docs/                  # Documentation
│   ├── getting-started.md
│   ├── concepts.md
│   ├── progressive-adoption.md
│   └── state-management.md
├── examples/              # Examples
│   ├── simple-chat.md
│   ├── progressive-adoption.md
│   └── fullstack.md
└── api/                   # API reference
    └── index.md
```

## Deployment

The site is automatically deployed to GitHub Pages on push to `main`:

- **URL:** https://rlindgren.github.io/aidk/
- **Workflow:** `.github/workflows/deploy-docs.yml`

### Manual Deployment

```bash
pnpm build
```

The built site will be in `.vitepress/dist/`.

## Writing Documentation

### Code Examples

Use VitePress code groups for multi-file examples:

````markdown
::: code-group

``` tsx [agent.tsx]
export class MyAgent extends Component {
  // ...
}
```

``` tsx [server.ts]
import { createEngine } from 'aidk';
```

:::
````

### Custom Styling

Add custom styles in `.vitepress/theme/custom.css`:

```css
.adoption-level {
  border-left: 4px solid var(--vp-c-brand-1);
  padding-left: 1.5rem;
}
```

### Navigation

Edit sidebar and nav in `.vitepress/config.ts`.

## Features

- ⚡ Fast hot reload with Vite
- 🎨 Custom theme with gradient branding
- 🔍 Built-in search
- 📱 Responsive design
- 🌙 Dark mode support
- 📝 Markdown with Vue components
- 🔗 Auto-generated navigation
- 📊 Code syntax highlighting

## Contributing

1. Edit markdown files in `docs/`, `examples/`, or `api/`
2. Test locally with `pnpm dev`
3. Submit a PR

See [CONTRIBUTING.md](../CONTRIBUTING.md) for guidelines.
