/**
 * The hosted gateway, once it is live. `plan.md` section 2, "Hosted BYOK".
 *
 * UNDEFINED UNTIL IT RESOLVES, and that is the whole of this file. The connect page works against
 * any gateway running hosted mode, so it ships before ours does: until this is set, it asks for a
 * gateway URL, is kept out of search, and names no hostname of ours. `repo:check` bans hostnames
 * with no DNS record, so setting this is the same change that lifts the ban.
 */
export const HOSTED_GATEWAY: string | undefined = undefined;
