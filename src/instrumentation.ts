import { getServerEnv } from "@/lib/env/server";

/**
 * Next.js calls register once when a server instance starts. Parsing the
 * server environment here makes deployed instances fail before serving a
 * request when required staging or production configuration is incomplete.
 */
export function register() {
  getServerEnv();
}
