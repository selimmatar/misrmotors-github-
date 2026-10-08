#!/usr/bin/env bash
# Compiles and runs every unit / route test (no network, no database: the Supabase client is an in-memory fake).
#   lib/__tests__/run-tests.sh            run each suite once
#   lib/__tests__/run-tests.sh 5          run each suite 5 times (flake hunting)
# The route tests call the real handlers in app/api/**/route.ts; TypeScript errors that already exist in those
# route files do not block the run (the project type-check is tracked separately against a baseline).
set -u
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${TEST_OUT:-/tmp/misr-tests}"
REPEAT="${1:-1}"
rm -rf "$OUT" && mkdir -p "$OUT"
cat > "$OUT/tsconfig.json" <<JSON
{
  "compilerOptions": {
    "target": "es2020", "module": "commonjs", "moduleResolution": "node", "esModuleInterop": true,
    "skipLibCheck": true, "strict": true, "resolveJsonModule": true, "jsx": "preserve",
    "baseUrl": "$REPO", "rootDir": "$REPO", "outDir": "$OUT/out",
    "paths": { "@/*": ["*"] }, "typeRoots": ["$REPO/node_modules/@types"], "types": ["node"]
  },
  "files": [
    "$REPO/lib/__tests__/payment-type.test.ts",
    "$REPO/lib/__tests__/invoicing.test.ts",
    "$REPO/lib/__tests__/returns.test.ts",
    "$REPO/lib/__tests__/invoicing-returns.test.ts",
    "$REPO/lib/__tests__/so-edit.test.ts",
    "$REPO/lib/__tests__/routes.test.ts",
    "$REPO/lib/__tests__/print-totals.test.ts",
    "$REPO/lib/__tests__/missing-items.test.ts",
    "$REPO/lib/__tests__/print-routes.test.ts",
    "$REPO/lib/__tests__/goods-receiving.test.ts",
    "$REPO/lib/__tests__/accounts-payable-payments.test.ts",
    "$REPO/lib/__tests__/po-status.test.ts",
    "$REPO/lib/__tests__/po-over-order.test.ts",
    "$REPO/lib/__tests__/costing.test.ts",
    "$REPO/lib/__tests__/transfers.test.ts",
    "$REPO/lib/__tests__/legacy-paths.test.ts",
    "$REPO/lib/__tests__/supplier-credits.test.ts",
    "$REPO/lib/__tests__/stock-hold.test.ts",
    "$REPO/lib/__tests__/review-fixes.test.ts",
    "$REPO/lib/__tests__/leftovers.test.ts"
  ]
}
JSON
"$REPO/node_modules/.bin/tsc" -p "$OUT/tsconfig.json" > "$OUT/tsc.log" 2>&1
echo "compiled (tsc reported $(grep -c 'error TS' "$OUT/tsc.log") error line(s); new-file errors: $(grep 'error TS' "$OUT/tsc.log" | grep -E 'lib/(returns|return-lines|so-edit|delivery-status|invoicing|print-totals|print-html|missing-items|missing-items-html|so-print-html|goods-receiving|ap-payments|po-status|po-over-order|stock-hold|dp-stock|dp-planned|customer-dp-chip|__tests__)|finalize-cost/route|warehouse-transfers/complete/route' | wc -l))"
export NODE_PATH="$REPO/node_modules"
status=0
for run in $(seq 1 "$REPEAT"); do
  for suite in payment-type invoicing returns invoicing-returns so-edit routes print-totals missing-items print-routes goods-receiving accounts-payable-payments po-status po-over-order costing transfers legacy-paths supplier-credits stock-hold review-fixes leftovers; do
    result="$(node --test "$OUT/out/lib/__tests__/$suite.test.js" 2>&1)"
    line="$(echo "$result" | grep -E '^# (tests|pass|fail)' | tr '\n' ' ')"
    echo "run $run  $suite: $line"
    echo "$result" | grep -qE '^# fail 0' || { status=1; echo "$result" | grep -E '^not ok|error:' | head -10; }
  done
done
exit $status
