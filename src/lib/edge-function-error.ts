import { FunctionsHttpError, FunctionsRelayError, FunctionsFetchError } from "@supabase/supabase-js";

/**
 * Extract a meaningful error message from Supabase edge function errors.
 * supabase.functions.invoke() returns generic messages in error.message —
 * the actual error body is in error.context (a Response object).
 */
export async function extractEdgeFunctionError(
  error: unknown,
  fallback: string,
): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    try {
      const body = await error.context.json();
      return body?.error || body?.message || error.message || fallback;
    } catch {
      return error.message || fallback;
    }
  }
  if (error instanceof FunctionsRelayError) {
    return "Analysfunktionen kunde inte nås — försök igen";
  }
  if (error instanceof FunctionsFetchError) {
    return "Nätverksfel — kontrollera din anslutning";
  }
  if (error instanceof Error) {
    return error.message || fallback;
  }
  return fallback;
}
