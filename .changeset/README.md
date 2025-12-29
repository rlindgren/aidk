# Changesets

This directory is used by [Changesets](https://github.com/changesets/changesets) to manage versioning and changelogs.

## Adding a changeset

When you make a change that should be released, run:

```bash
pnpm changeset
```

This will prompt you to:

1. Select which packages have changed
2. Choose the bump type (major/minor/patch)
3. Write a summary of the changes

## Releasing

To release new versions:

```bash
# Version packages (updates package.json versions and CHANGELOG.md)
pnpm version-packages

# Build and publish to npm
pnpm publish-packages
```

## Versioning guidelines

- **patch**: Bug fixes, documentation, internal changes
- **minor**: New features, non-breaking additions
- **major**: Breaking changes

While in pre-1.0 (`0.x.x`), breaking changes can be minor bumps.
