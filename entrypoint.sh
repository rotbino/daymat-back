#!/bin/sh
set -e

echo "=========================================="
echo "  Daymat Backend"
echo "=========================================="

# اجرای سید (خودش چک می‌کنه)
npx tsx prisma/seed/seed-all.ts

echo ""
echo "=========================================="
echo "  Starting Application..."
echo "=========================================="

exec node dist/main