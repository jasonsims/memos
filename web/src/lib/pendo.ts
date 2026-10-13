// Fork-only Pendo wiring (see FORK.md). The snippet in index.html loads the agent and stubs `window.pendo`
// until it arrives. Every call here is a no-op when the snippet is absent, e.g. under Vitest.
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { getAccessToken } from "@/auth-state";
import { ROUTES } from "@/router/routes";
import { type User, User_Role, type UserSetting_GeneralSetting } from "@/types/proto/api/user_service_pb";

// `/memos/shares/{token}`: the token alone opens the memo, no sign-in needed.
const SHARE_LINK_TOKEN = /^(\/memos\/shares\/)[^/]+/i;

const isOAuthCallback = (url: URL): boolean =>
  String(url?.pathname || "")
    .replace(/\/+$/, "")
    .toLowerCase() === ROUTES.AUTH_CALLBACK;

/** Analytics must never break the app, so agent errors are logged instead of thrown. */
function withPendo(call: (pendo: Pendo) => void): void {
  const pendo = window.pendo;
  if (!pendo) return;
  try {
    call(pendo);
  } catch (error) {
    console.warn("Pendo call failed:", error);
  }
}

/** Reads the access token's `sub` claim: the numeric user id, which the User message does not carry. */
function readAccessTokenSubject(): string | undefined {
  const payload = getAccessToken()?.split(".")[1];
  if (!payload) return undefined;
  try {
    const { sub } = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as { sub?: unknown };
    return typeof sub === "string" && sub !== "" ? sub : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Boots the agent once per page load with an anonymous visitor; Pendo restores a returning visitor when it can.
 * The transforms keep credentials out of every URL the agent records.
 */
export function initializePendo(): void {
  withPendo((pendo) =>
    pendo.initialize({
      visitor: { id: "" },
      location: {
        // Transforms must never throw: the agent would fall back to recording the untransformed URL.
        transforms: [
          // SSO sign-in and account linking land here with the one-time authorization code and its CSRF state.
          { attr: "search", action: "ExcludeKeys", data: (_search, url) => (isOAuthCallback(url) ? ["code", "state"] : []) },
          // Share links are recorded as /memos/shares/redacted.
          { attr: "pathname", action: "Replace", data: (pathname) => String(pathname || "").replace(SHARE_LINK_TOKEN, "$1redacted") },
        ],
      },
    }),
  );
}

/** Identifies the signed-in user with their profile and general settings. */
export function identifyPendoVisitor(user: User, generalSetting: UserSetting_GeneralSetting | undefined): void {
  withPendo((pendo) => {
    const id = readAccessTokenSubject();
    if (!id) {
      console.warn("Pendo: the access token has no user id, so the visitor stays anonymous.");
      return;
    }
    pendo.identify({
      visitor: {
        id,
        email: user.email,
        full_name: user.displayName,
        username: user.username,
        role: User_Role[user.role],
        createTime: user.createTime ? timestampDate(user.createTime).toISOString() : undefined,
        updateTime: user.updateTime ? timestampDate(user.updateTime).toISOString() : undefined,
        locale: generalSetting?.locale,
        theme: generalSetting?.theme,
        memoVisibility: generalSetting?.memoVisibility,
        saveMediaMetadata: generalSetting?.saveMediaMetadata,
      },
    });
  });
}

/** Starts a fresh anonymous visitor so the next person to sign in is not merged into this one. */
export function clearPendoSession(): void {
  withPendo((pendo) => pendo.clearSession?.());
}
