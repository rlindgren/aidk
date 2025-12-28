#!/bin/bash

echo "🚀 Setting up AIDK Website..."
echo ""

# Navigate to website directory
cd "$(dirname "$0")/website"

# Check if pnpm is installed
if ! command -v pnpm &> /dev/null; then
    echo "❌ pnpm not found. Installing pnpm..."
    npm install -g pnpm
fi

# Install dependencies
echo "📦 Installing dependencies..."
pnpm install

echo ""
echo "✅ Setup complete!"
echo ""
echo "Available commands:"
echo "  pnpm dev      - Start development server"
echo "  pnpm build    - Build for production"
echo "  pnpm preview  - Preview production build"
echo ""
echo "To get started:"
echo "  cd website"
echo "  pnpm dev"
echo ""











