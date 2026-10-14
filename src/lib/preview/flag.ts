/**
 * Preview mode (`npm run dev:preview`): the whole app runs WITHOUT Supabase/SMTP on an in-memory
 * mock backend so every screen can be clicked through with fake data.
 *
 * It can never be active in a production build: `next build` sets NODE_ENV=production, so this
 * constant is statically `false` there and every preview-only branch is dead code.
 * In a normal `npm run dev` NEXT_PUBLIC_PREVIEW_MODE is unset → also `false`.
 */
export const PREVIEW = process.env.NEXT_PUBLIC_PREVIEW_MODE === "1" && process.env.NODE_ENV !== "production";
