import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://yzirqrlnbcllqzpdpefk.supabase.co",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "sb_publishable_Kize5e7pRhFU4dnZLd16tg_B60R7IcV"
);
