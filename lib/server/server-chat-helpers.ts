import { Database, Tables } from "@/supabase/types"
import { VALID_ENV_KEYS } from "@/types/valid-keys"
import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
import { LLM_LIST } from "@/lib/models/llm/llm-list"
import { LLMID } from "@/types"
import { SupabaseClient } from "@supabase/supabase-js"
import { getProfileByUserId } from "@/db/profile"

function createClient() {
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookies().get(name)?.value
        }
      }
    }
  )
}

export async function getServerProfile() {
  const cookieStore = cookies()
  const supabase = createClient()

  const user = (await supabase.auth.getUser()).data.user
  if (!user) {
    throw new Error("User not found")
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("user_id", user.id)
    .single()

  if (!profile) {
    throw new Error("Profile not found")
  }

  const profileWithKeys = addApiKeysToProfile(profile)

  return profileWithKeys
}

function addApiKeysToProfile(profile: Tables<"profiles">) {
  const apiKeys = {
    [VALID_ENV_KEYS.OPENAI_API_KEY]: "openai_api_key",
    [VALID_ENV_KEYS.ANTHROPIC_API_KEY]: "anthropic_api_key",
    [VALID_ENV_KEYS.GOOGLE_GEMINI_API_KEY]: "google_gemini_api_key",
    [VALID_ENV_KEYS.MISTRAL_API_KEY]: "mistral_api_key",
    [VALID_ENV_KEYS.PERPLEXITY_API_KEY]: "perplexity_api_key",
    [VALID_ENV_KEYS.AZURE_OPENAI_API_KEY]: "azure_openai_api_key",
    [VALID_ENV_KEYS.OPENROUTER_API_KEY]: "openrouter_api_key",

    [VALID_ENV_KEYS.OPENAI_ORGANIZATION_ID]: "openai_organization_id",

    [VALID_ENV_KEYS.AZURE_OPENAI_ENDPOINT]: "azure_openai_endpoint",
    [VALID_ENV_KEYS.AZURE_GPT_35_TURBO_NAME]: "azure_openai_35_turbo_id",
    [VALID_ENV_KEYS.AZURE_GPT_45_VISION_NAME]: "azure_openai_45vision_id",
    [VALID_ENV_KEYS.AZURE_GPT_45_TURBO_NAME]: "azure_openai_45_turbo_id",
    [VALID_ENV_KEYS.AZURE_EMBEDDINGS_NAME]: "azure_openai_embeddings_id"
  }

  for (const [envKey, profileKey] of Object.entries(apiKeys)) {
    if (process.env[envKey] && !(profile as any)[profileKey]) {
      ;(profile as any)[profileKey] = process.env[envKey]
    }
  }

  return profile
}

export function checkApiKey(apiKey: string | null, keyName: string) {
  if (apiKey === null || apiKey === "") {
    throw new Error(`${keyName} API Key not found`)
  }
}

export async function validateModel(profile: Tables<"profiles">, model: LLMID) {
  const { plan } = profile

  if (plan !== "free") {
    return
  }

  const paidLLMS = LLM_LIST.filter(x => x.paid).map(x => x.modelId)

  if (paidLLMS.includes(model)) {
    throw new LimitError("Pro plan required to use this model")
  }
}

class LimitError extends Error {
  status: number

  constructor(message: string) {
    super(message)
    this.name = "LimitError"
    this.status = 429
  }
}

export async function validateMessageCount(
  profile: Tables<"profiles">,
  date: Date,
  supabase: SupabaseClient
) {
  const { plan } = profile

  if (plan !== "free") {
    return
  }

  const { count, data, error } = await supabase
    .from("messages")
    .select("*", {
      count: "exact"
    })
    .gte("created_at", date.toISOString())

  if (count === null) {
    throw new Error("Could not fetch message count")
  }

  if (count > 30) {
    throw new LimitError(
      "You have reached daily message limit. Upgrade to Pro plan to continue come back tomorrow."
    )
  }
}

export async function validateModelAndMessageCount(model: LLMID, date: Date) {
  const client = createClient()
  const profile = await getServerProfile()
  await validateModel(profile, model)
  await validateMessageCount(profile, date, client)
}
