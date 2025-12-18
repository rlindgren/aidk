# Contributing to AIDK

Thank you for your interest in contributing to AIDK! This document provides guidelines and instructions for contributing.

## Development Setup

### Prerequisites

- Node.js 24+
- pnpm 10+

### Getting Started

```bash
# Clone the repository
git clone https://github.com/your-org/aidk.git
cd aidk

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test
```

### Project Structure

```
aidk/
├── packages/           # Published packages
│   ├── core/          # aidk - Core framework
│   ├── kernel/        # aidk-kernel - Execution primitives
│   ├── client/        # aidk-client - Browser client
│   ├── express/       # aidk-express - Express middleware
│   ├── server/        # aidk-server - Server utilities
│   ├── react/         # aidk-react - React bindings
│   ├── angular/       # aidk-angular - Angular bindings
│   └── adapters/      # AI provider adapters
│       ├── ai-sdk/    # aidk-ai-sdk
│       ├── openai/    # aidk-openai
│       └── google/    # aidk-google
├── example/           # Example applications (separate workspace)
│   ├── backend/       # Express backend example
│   ├── frontend-react/    # React frontend example
│   └── frontend-angular/  # Angular frontend example
└── docs/              # Documentation
```

## Development Workflow

### Running in Development

```bash
# Watch mode for a specific package
cd packages/core
pnpm dev

# Run the example app
cd example
pnpm install
pnpm dev:backend    # Terminal 1
pnpm dev:frontend   # Terminal 2
```

### Testing

```bash
# Run all tests
pnpm test

# Run tests for a specific package
pnpm --filter aidk test

# Run tests in watch mode
pnpm --filter aidk test -- --watch

# Run a specific test file
pnpm --filter aidk test -- src/engine/engine.spec.ts
```

### Type Checking

```bash
# Type check all packages
pnpm typecheck

# Type check a specific package
pnpm --filter aidk typecheck
```

### Building

```bash
# Build all packages
pnpm build

# Build a specific package
pnpm --filter aidk build

# Clean build artifacts
pnpm clean
```

## Code Style

### TypeScript

- Use TypeScript for all code
- Enable strict mode
- Prefer `type` imports for type-only imports: `import type { Foo } from './foo'`
- Use explicit return types for public APIs

### JSX

- The core package uses a custom JSX runtime (`aidk/jsx-runtime`)
- React/Angular packages use their respective JSX runtimes
- Use `.tsx` extension for files with JSX

### Naming Conventions

- **Files**: kebab-case (`engine-client.ts`)
- **Classes**: PascalCase (`EngineClient`)
- **Functions**: camelCase (`createEngine`)
- **Constants**: SCREAMING_SNAKE_CASE (`DEFAULT_TIMEOUT`)
- **Types/Interfaces**: PascalCase (`EngineConfig`)

### Exports

- Use named exports (avoid default exports)
- Re-export from `index.ts` files
- Use `export type` for type-only exports

## Pull Request Process

### Before Submitting

1. **Create an issue first** for significant changes
2. **Fork the repository** and create a feature branch
3. **Write tests** for new functionality
4. **Update documentation** if needed
5. **Run the full test suite** and ensure it passes
6. **Run type checking** and fix any errors

### PR Guidelines

- Use clear, descriptive PR titles
- Reference related issues in the description
- Keep PRs focused - one feature/fix per PR
- Ensure CI passes before requesting review

### Commit Messages

Follow conventional commits:

```
feat: add streaming support to engine
fix: resolve memory leak in channel client
docs: update getting started guide
chore: upgrade dependencies
refactor: simplify tool execution logic
test: add integration tests for hooks
```

## Package Guidelines

### Adding a New Package

1. Create the package directory under `packages/`
2. Initialize with standard structure:
   ```
   packages/new-package/
   ├── src/
   │   └── index.ts
   ├── package.json
   ├── tsconfig.json
   ├── tsconfig.build.json
   ├── tsconfig.spec.json
   └── jest.config.js
   ```
3. Add to `pnpm-workspace.yaml` if needed
4. Add package README

### Package Dependencies

- Use `workspace:*` for internal dependencies
- Keep external dependencies minimal
- Document peer dependencies clearly

## Testing Guidelines

### Test Structure

```typescript
describe('FeatureName', () => {
  describe('methodName', () => {
    it('should do something specific', () => {
      // Arrange
      const input = createTestInput();
      
      // Act
      const result = methodName(input);
      
      // Assert
      expect(result).toBe(expected);
    });
  });
});
```

### Test Types

- **Unit tests**: Test individual functions/classes in isolation
- **Integration tests**: Test interactions between components
- **Spec files**: Named `*.spec.ts` or `*.spec.tsx`

### Mocking

- Use Jest's built-in mocking
- Reset mocks in `beforeEach`
- Prefer dependency injection for testability

## Documentation

### Code Documentation

- Add JSDoc comments to public APIs
- Include examples in documentation
- Document complex logic with inline comments

### Package READMEs

Each package should have a README with:
- Package description
- Installation instructions
- Basic usage example
- API reference (or link to docs)

## Questions?

- Open an issue for bugs or feature requests
- Use discussions for questions and ideas

Thank you for contributing! 🎉

