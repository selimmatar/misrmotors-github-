# Supabase Browser Client Singleton Fix

## Problem
Multiple GoTrueClient instances were being created because:
1. `createClient()` function was called multiple times (on every component render)
2. Client initialization happened inside function calls instead of at module load
3. Auth components were creating new instances on every re-render

## Solution
Created a **true singleton pattern** in `lib/supabase/browser.ts`:

### Key Changes:
1. **Module-level initialization**: Client is created once when module loads (client-side)
2. **Direct export**: `export const supabase = browserClient` - import and use directly
3. **No function calls needed**: `import { supabase } from '@/lib/supabase/browser'`
4. **Server-safe**: Checks `typeof window !== "undefined"` before initializing

### Migration:
**Before:**
\`\`\`ts
import { createClient } from "@/lib/supabase/client"
const supabase = createClient() // ❌ Creates instance on every call
\`\`\`

**After:**
\`\`\`ts
import { supabase } from "@/lib/supabase/browser"
// ✅ Use singleton directly, no function call
await supabase.auth.signUp(...)
\`\`\`

### Files Changed:
1. `lib/supabase/browser.ts` - New singleton with module-level init
2. `lib/supabase/client.ts` - Re-exports from browser.ts for backwards compatibility
3. `app/auth/sign-up/page.tsx` - Uses singleton directly

### Verification:
- No "Multiple GoTrueClient" warning in console
- Only ONE Supabase client instance exists per browser tab
- Auth listeners don't duplicate
- Fewer redundant requests to Supabase

### Best Practices:
- ✅ Import singleton: `import { supabase } from '@/lib/supabase/browser'`
- ✅ Use directly: `supabase.auth.signIn()`
- ❌ Don't create new instances: `new SupabaseClient()`
- ❌ Don't call `createClient()` in component bodies
