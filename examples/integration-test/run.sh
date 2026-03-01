#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TEST_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== ElsiumAI Integration Tests ==="
echo ""

# Step 1: Build all packages
echo "→ Building all packages..."
cd "$REPO_ROOT"
bun run build
echo "  ✓ Build complete"
echo ""

# Step 2: Install dependencies (links workspace packages)
echo "→ Installing dependencies..."
bun install
echo "  ✓ Dependencies installed"
echo ""

# Step 3: Run integration tests
echo "→ Running integration tests..."
cd "$TEST_DIR"
npx vitest run
echo ""
echo "=== All integration tests passed ==="
