/**
 * The hosted gateway. `plan.md` section 2, "Hosted BYOK".
 *
 * The connect page seals to this gateway's public key and the remote MCP URL is built from it.
 * Set the day it went live; `repo:check` 29 lifted its ban on the hostname in the same change.
 */
export const HOSTED_GATEWAY: string | undefined = 'https://api.proxlane.dev';
