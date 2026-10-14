import { timestampDate } from "@bufbuild/protobuf/wkt";
import { getAccessToken } from "@/auth-state";
import { ROUTES } from "@/router/routes";
import { State } from "@/types/proto/api/common_pb";
import { type User, User_Role, type UserSetting_GeneralSetting } from "@/types/proto/api/user_service_pb";

// The snippet in index.html defines window.pendo. Without it (tests, a blocked inline script) every call is a no-op,
// and a failing call is logged instead of thrown so analytics can never break sign-in or sign-out.
const withPendo = (run: (pendo: PendoAgent) => void): void => {
  const pendo = window.pendo;
  if (!pendo) return;
  try {
    run(pendo);
  } catch (error) {
    console.warn("Pendo call failed:", error);
  }
};

// OAuth sign-in returns to /auth/callback?code=…&state=… (see utils/sso.ts). Transforms run on every recorded URL,
// so drop those keys on the callback path only.
const excludeOAuthCallbackKeys = (_search: string, url?: URL): string[] =>
  url?.pathname === ROUTES.AUTH_CALLBACK ? ["code", "state"] : [];

// A share link (/memos/shares/{token}) opens its memo without signing in and may never expire, so the token is a
// credential. Record every share page as /memos/shares/redacted instead.
const redactShareToken = (pathname: string): string => {
  const path = String(pathname || "");
  const prefix = `${ROUTES.SHARED_MEMO}/`;
  return path.length > prefix.length && path.toLowerCase().startsWith(prefix) ? `${path.slice(0, prefix.length)}redacted` : path;
};

/** Boots Pendo as an anonymous visitor. Call once per page load, at app entry: the SDK ignores later calls. */
export const initializePendo = (): void =>
  withPendo((pendo) =>
    pendo.initialize({
      visitor: { id: "" },
      location: {
        transforms: [
          { attr: "search", action: "ExcludeKeys", data: excludeOAuthCallbackKeys },
          { attr: "pathname", action: "Replace", data: redactShareToken },
        ],
      },
    }),
  );

// The User message has no numeric ID, so read it from the access token's `sub` claim. Unlike the username, it never changes.
const getUserId = (): string | undefined => {
  const payload = getAccessToken()?.split(".")[1];
  if (!payload) return undefined;
  try {
    const claims: { sub?: unknown } = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return typeof claims.sub === "string" && claims.sub !== "" ? claims.sub : undefined;
  } catch {
    return undefined;
  }
};

/** Identifies the signed-in user. Call it again whenever the user or their settings change to refresh the metadata. */
export const identifyPendoVisitor = (user: User, generalSetting?: UserSetting_GeneralSetting): void =>
  withPendo((pendo) => {
    const id = getUserId();
    if (!id) return;
    pendo.identify({
      visitor: {
        id,
        email: user.email,
        full_name: user.displayName,
        username: user.username,
        role: User_Role[user.role],
        state: State[user.state],
        createTime: user.createTime ? timestampDate(user.createTime).toISOString() : undefined,
        updateTime: user.updateTime ? timestampDate(user.updateTime).toISOString() : undefined,
        avatarUrl: user.avatarUrl,
        description: user.description,
        locale: generalSetting?.locale,
        theme: generalSetting?.theme,
        memoVisibility: generalSetting?.memoVisibility,
        saveMediaMetadata: generalSetting?.saveMediaMetadata,
      },
    });
  });

/** Resets Pendo to a new anonymous visitor so whoever uses this browser next is not tracked as the signed-out user. */
export const clearPendoSession = (): void => withPendo((pendo) => pendo.clearSession?.());
