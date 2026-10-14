import { type Timestamp, timestampDate } from "@bufbuild/protobuf/wkt";
import { getAccessToken } from "@/auth-state";
import { ROUTES } from "@/router/routes";
import { State } from "@/types/proto/api/common_pb";
import { type User, User_Role, type UserSetting_GeneralSetting } from "@/types/proto/api/user_service_pb";

// The OAuth callback receives a one-time authorization code and the CSRF state on its query string.
const OAUTH_CALLBACK_PATHNAME = new RegExp(`^${ROUTES.AUTH_CALLBACK}/?$`, "i");

// The path segment after the share prefix is an opaque bearer token that grants read access to the memo.
const SHARED_MEMO_TOKEN = new RegExp(`^${ROUTES.SHARED_MEMO}/[^/]+`, "i");

/**
 * Keeps credentials out of the URLs the agent records. Transforms run on every recorded URL, so each one is scoped
 * to the route that carries the credential. They must never throw: the agent would record the untransformed URL.
 */
const LOCATION_TRANSFORMS: PendoLocationTransform[] = [
  {
    attr: "search",
    action: "ExcludeKeys",
    data: (_search, url) => (OAUTH_CALLBACK_PATHNAME.test(String(url?.pathname)) ? ["code", "state"] : []),
  },
  {
    attr: "pathname",
    action: "Replace",
    data: (pathname) => (typeof pathname === "string" ? pathname.replace(SHARED_MEMO_TOKEN, `${ROUTES.SHARED_MEMO}/redacted`) : pathname),
  },
];

/** The immutable user ID is only carried by the access token's `sub` claim; the User message has the renameable username. */
const getAccessTokenSubject = (): string | undefined => {
  const payload = getAccessToken()?.split(".")[1];
  if (!payload) return undefined;
  try {
    const { sub } = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as { sub?: unknown };
    return typeof sub === "string" && sub !== "" ? sub : undefined;
  } catch {
    return undefined;
  }
};

const timestampToISO = (timestamp: Timestamp | undefined): string | undefined =>
  timestamp ? timestampDate(timestamp).toISOString() : undefined;

/** Analytics must never break the app. The agent is absent in tests and when the install snippet is removed. */
const withPendo = (call: (pendo: PendoAgent) => void): void => {
  const { pendo } = window;
  if (!pendo) return;
  try {
    call(pendo);
  } catch (error) {
    console.warn("Pendo call failed:", error);
  }
};

/** Boots the agent once per page load as an anonymous visitor; the agent resumes a known visitor from its own storage. */
export const initializePendo = (): void =>
  withPendo((pendo) => pendo.initialize({ visitor: { id: "" }, location: { transforms: LOCATION_TRANSFORMS } }));

/** Identifies the signed-in user once sign-in has loaded the user and their general setting. */
export const identifyPendoVisitor = (user: User, generalSetting: UserSetting_GeneralSetting | undefined): void =>
  withPendo((pendo) => {
    const id = getAccessTokenSubject();
    if (!id) return;
    pendo.identify({
      visitor: {
        id,
        email: user.email,
        full_name: user.displayName,
        username: user.username,
        role: User_Role[user.role],
        state: State[user.state],
        createTime: timestampToISO(user.createTime),
        updateTime: timestampToISO(user.updateTime),
        locale: generalSetting?.locale,
        memoVisibility: generalSetting?.memoVisibility,
        theme: generalSetting?.theme,
        saveMediaMetadata: generalSetting?.saveMediaMetadata,
      },
    });
  });

/** Resets to a fresh anonymous visitor so the next user is not tracked as the one signing out. */
export const clearPendoSession = (): void =>
  withPendo((pendo) => {
    if (pendo.clearSession) pendo.clearSession();
  });
