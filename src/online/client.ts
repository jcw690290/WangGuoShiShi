import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const onlineConfigured = Boolean(url && key);
const supabase = onlineConfigured ? createClient(url, key) : null;

export function onlineClient() {
  if (!supabase) throw new Error("联机服务尚未配置");
  return supabase;
}

export class OnlineRequestError extends Error {
  constructor(message: string, readonly retryable = false) {
    super(message);
  }
}

export async function onlineUser() {
  const client = onlineClient();
  const { data, error } = await client.auth.getSession();
  if (error) throw new OnlineRequestError(error.message, error.status === 0);
  if (data.session) return data.session.user.id;
  const result = await client.auth.signInAnonymously();
  if (result.error) throw new OnlineRequestError(result.error.message, result.error.status === 0);
  if (!result.data.user) throw new Error("登录服务没有返回玩家身份");
  return result.data.user.id;
}

export async function request(action: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error, status } = await onlineClient().rpc("wgss_online", { action, args }).abortSignal(AbortSignal.timeout(10000));
  if (error) throw new OnlineRequestError(error.message, status === 0 || status >= 500);
  return data;
}
