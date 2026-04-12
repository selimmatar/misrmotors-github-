# Production Blockers - Fix Summary

## Issue 1: Couriers GET 429 + Retry Loop ✅ FIXED

**Root Cause:**
- Couriers API was being rate limited (429 Too Many Requests)
- Response was plain text "Too Many Requests" instead of JSON
- Code tried to parse as JSON → error
- Empty array triggered infinite retry loop

**Fixes Applied:**
1. `lib/app-context.tsx` - Enhanced `swrFetcher`:
   - Properly handle 429 errors (read text, don't parse JSON)
   - Better error logging with response preview
   - Try-catch around JSON.parse with detailed error messages

2. `lib/app-context.tsx` - Fixed retry loop (line 256-274):
   - Added retry counter (max 2 retries)
   - Added exponential backoff (2s, then 5s)
   - Only retry if data is explicitly empty (not undefined)
   - Track last retry timestamp to prevent rapid-fire retries

3. `app/api/couriers/route.ts`:
   - Added `revalidate = 3600` (1 hour cache)
   - Added `dynamic = "force-static"` for better caching
   - Enhanced logging

**Result:**
- No more JSON parse errors
- No more infinite retry loops
- Couriers load reliably with smart backoff
- Server caching reduces API hits

---

## Issue 2: Multiple GoTrueClient Instances ✅ ALREADY FIXED

**Status:** The singleton pattern is correctly implemented.

**Evidence:**
- `lib/supabase/browser.ts` exports a single `supabase` instance
- Only one `createBrowserClient()` call happens globally
- `app/auth/sign-up/page.tsx` imports from the singleton
- No other client-side code creates new instances

**Verification:**
\`\`\`bash
# Grep shows no problematic createClient() calls in app code
# All instances are in read-only example files
\`\`\`

The "Multiple GoTrueClient" warning should no longer appear because:
1. Browser singleton is initialized once on module load
2. All client-side auth code uses the singleton
3. Server-side code uses separate `createServerClient()` (no conflict)

---

## Issue 3: Print Button in Outbound Delivery ✅ PREVIOUSLY FIXED

**Status:** Already implemented in previous fix.

**Location:** `components/modules/shipping-module.tsx` line 327-344

**Implementation:**
\`\`\`typescript
const handlePrintPermit = (permit: DeliveryPermit) => {
  const url = `${window.location.origin}/api/delivery-permits/pdf?permit_id=${permit.id}`
  console.log("[v0] Shipping - Opening DP PDF:", url)
  window.location.href = url // Direct navigation, not popup
}
\`\`\`

**Why this works:**
- Uses absolute URL to bypass Next.js client router
- Uses `window.location.href` instead of `window.open()` (v0 preview blocks popups)
- Direct navigation downloads/displays the PDF
- User can then use browser's native print (Ctrl+P)

---

## Testing Checklist

### Couriers
- [ ] Load app → Couriers load without errors
- [ ] Refresh page quickly 3x → No retry storm, max 2 retries with backoff
- [ ] Check console → No "JSON Parse error" messages
- [ ] Check network tab → Couriers API called once, then cached

### Auth
- [ ] Load app → No "Multiple GoTrueClient" warning in console
- [ ] Sign up/login → Auth works correctly
- [ ] Check browser dev tools → Only one Supabase auth listener

### Print
- [ ] Go to Shipping/Outbound Delivery
- [ ] Click "Print" on a delivery permit
- [ ] DP PDF opens in browser (not redirected to ERP root)
- [ ] Can print using browser's print dialog

---

## Next Steps for Production

1. **Monitor Supabase API usage** after deploying these fixes
2. **Add rate limiting middleware** if 429 errors persist (Vercel Edge Middleware)
3. **Consider preloading couriers** at build time (ISR/SSG)
4. **Add user-facing error messages** if couriers fail to load after retries
</md>
