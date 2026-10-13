// Fork-only: Pendo (Novus) lifecycle for the install snippet in index.html. See FORK.md.
import { getAccessToken } from "@/auth-state";
import { ROUTES } from "@/router/routes";
import { type User, User_Role, type UserSetting_GeneralSetting } from "@/types/proto/api/user_service_pb";

/** `/memos/shares/{token}`. Route matching is case-insensitive, so the pattern is too. */
const SHARED_MEMO_TOKEN_PATH = /^(\/memos\/shares\/)[^/]+/i;

/**
 * Boots the agent once, at app entry, with an anonymous visitor: an empty id resumes the previous
 * visitor from the agent's own storage, if any. The signed-in user is registered later through
 * `identifyPendoVisitor`, never through a second `initialize`, which the agent would ignore.
 */
export const initializePendo = (): void => {
  const { pendo } = window;
  if (!pendo) {
    return;
  }
  pendo.initialize({
    visitor: { id: "" },
    location: {
      // Transforms run on every URL the agent records. They must not throw: the agent would then
      // fall back to recording the untransformed URL.
      transforms: [
        {
          // OAuth providers redirect back to /auth/callback?code=...&state=... (utils/sso.ts and
          // LinkedIdentitySection). Drop the authorization code and state on that page only, so a
          // `code` or `state` parameter anywhere else is still recorded.
          attr: "search",
          action: "ExcludeKeys",
          data: (_search, url) => (url?.pathname === ROUTES.AUTH_CALLBACK ? ["code", "state"] : []),
        },
        {
          // A share token grants read access to its memo without signing in, even a private one.
          attr: "pathname",
          action: "Replace",
          data: (pathname) => (typeof pathname === "string" ? pathname.replace(SHARED_MEMO_TOKEN_PATH, "$1redacted") : pathname),
        },
      ],
    },
  });
};

/**
 * The numeric user ID, which the API User does not expose: it is the `sub` claim of the access
 * token. The claim is only read here, not verified; the server verifies the token on every request.
 */
const getUserIdFromAccessToken = (): string | undefined => {
  const payload = getAccessToken()?.split(".")[1];
  if (!payload) {
    return undefined;
  }
  try {
    const { sub } = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as { sub?: unknown };
    return typeof sub === "string" && sub !== "" ? sub : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Registers the signed-in user. Called again when the profile or general settings change so the
 * metadata stays current. Memos has no account or tenant (a Space is not one), so no `account` is sent.
 */
export const identifyPendoVisitor = (user: User, generalSetting: UserSetting_GeneralSetting | undefined): void => {
  const { pendo } = window;
  if (!pendo) {
    return;
  }
  const visitorId = getUserIdFromAccessToken();
  if (!visitorId) {
    return;
  }
  pendo.identify({
    visitor: {
      id: visitorId,
      email: user.email,
      full_name: user.displayName,
      username: user.username,
      role: User_Role[user.role],
      createdTs: user.createTime ? Number(user.createTime.seconds) : undefined,
      updatedTs: user.updateTime ? Number(user.updateTime.seconds) : undefined,
      locale: generalSetting?.locale,
      theme: generalSetting?.theme,
      memoVisibility: generalSetting?.memoVisibility,
      saveMediaMetadata: generalSetting?.saveMediaMetadata,
    },
  });
};

/** Resets the agent to a fresh anonymous visitor on sign-out, so the next user is not tracked as this one. */
export const clearPendoSession = (): void => {
  const { pendo } = window;
  // The snippet does not stub clearSession: it is missing until the agent script loads, or if it is blocked.
  if (typeof pendo?.clearSession === "function") {
    pendo.clearSession();
  }
};
