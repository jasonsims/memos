import { type Timestamp, timestampDate } from "@bufbuild/protobuf/wkt";
import { isEqual } from "lodash-es";
import { getAccessToken } from "@/auth-state";
import { ROUTES } from "@/router/routes";
import { State } from "@/types/proto/api/common_pb";
import {
  InstanceAccessMode,
  type InstanceSetting,
  InstanceSetting_AIProviderType,
  type InstanceSetting_AISetting,
  InstanceSetting_StorageType,
} from "@/types/proto/api/instance_service_pb";
import { type Memo, Visibility } from "@/types/proto/api/memo_service_pb";
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

/**
 * Track events registered in Pendo. Pendo matches a track type by its exact name, so a reworded or re-cased name
 * silently starts a new, empty track type: never rename one.
 */
export type PendoTrackEvent =
  // Authentication and account access
  | "user_signed_up"
  | "user_signed_in"
  | "user_sign_in_failed"
  | "sso_sign_in_initiated"
  | "linked_identity_added"
  // Composing memos
  | "memo_created"
  | "memo_updated"
  | "memo_save_failed"
  | "memo_comment_created"
  | "memo_suggestion_accepted"
  | "attachment_uploaded"
  | "attachment_upload_failed"
  | "audio_note_recorded"
  | "audio_transcription_completed"
  // Acting on memos
  | "memo_pin_toggled"
  | "memo_archive_state_changed"
  | "memo_deleted"
  | "memo_task_toggled"
  | "memo_tasks_bulk_toggled"
  | "memo_reaction_toggled"
  | "memo_share_link_created"
  | "memo_share_link_revoked"
  | "memo_image_exported"
  | "inbox_notification_opened"
  // Finding memos
  | "memo_search_submitted"
  | "memo_search_completed"
  | "tag_filter_applied"
  | "memo_view_applied"
  | "memo_view_saved"
  | "memo_view_deleted"
  | "memo_view_filter_validated"
  | "tag_rules_saved"
  // Spaces
  | "space_created"
  | "space_deleted"
  | "space_invitation_sent"
  | "space_invitation_accepted"
  | "space_invitation_declined"
  | "space_member_role_changed"
  | "space_member_removed"
  | "space_left"
  // Account and data
  | "profile_updated"
  | "password_changed"
  | "account_deleted"
  | "user_preference_changed"
  | "access_token_created"
  | "webhook_created"
  | "memos_exported"
  | "memo_import_staged"
  | "memos_imported"
  | "memo_import_failed"
  | "unused_attachments_deleted"
  // Instance administration
  | "instance_setting_updated"
  | "ai_provider_configured"
  | "ai_transcription_configured"
  | "smtp_test_email_sent"
  | "identity_provider_saved"
  | "member_account_created"
  | "member_account_updated"
  | "member_account_state_changed"
  | "usage_limits_updated"
  // Reliability
  | "map_load_failed"
  | "usage_limit_reached"
  | "app_error_encountered";

export type PendoTrackProperties = Record<string, PendoTrackValue | undefined>;

/**
 * Sends a track event for the current visitor; the agent attaches the visitor, account, URL and time itself.
 * Properties are built by a callback so they cost nothing without the agent, and so a failure while building them
 * is contained like any other analytics failure instead of breaking the flow being tracked.
 */
export const trackPendoEvent = (event: PendoTrackEvent, getProperties?: () => PendoTrackProperties): void =>
  withPendo((pendo) => pendo.track(event, getProperties?.()));

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

const elapsedSince = (timestamp: Timestamp | undefined, unitMs: number): number | undefined =>
  timestamp ? Math.floor((Date.now() - timestampDate(timestamp).getTime()) / unitMs) : undefined;

/** Whole minutes since a timestamp, e.g. how long a notification waited. */
export const minutesSince = (timestamp: Timestamp | undefined) => elapsedSince(timestamp, MINUTE_MS);

/** Whole days since a timestamp, e.g. the age of an account or a share link. */
export const daysSince = (timestamp: Timestamp | undefined) => elapsedSince(timestamp, DAY_MS);

// Free text such as an error message can carry what an event must not: an address, a URL whose path holds a token,
// or a secret, masked or not.
const URL_AFTER_ORIGIN = /\b(https?:\/\/[^\s/?#]+)\S*/gi;
const EMAIL_ADDRESS = /[^\s@<>()[\]"',;:]+@[^\s@<>()[\]"',;:]+\.[^\s@<>()[\]"',;:]+/g;
const SECRET_LIKE = /\S*\*{3,}\S*|[\w-]{32,}/g;

/** Free text for a property: URLs cut to their origin, addresses and secret-like tokens removed, length capped. */
export const toPendoText = (text: string | undefined, maxLength = 100): string | undefined =>
  text?.replace(URL_AFTER_ORIGIN, "$1").replace(EMAIL_ADDRESS, "<email>").replace(SECRET_LIKE, "<redacted>").slice(0, maxLength) ||
  undefined;

/** Properties every memo event shares. Never the content. */
export const getMemoTrackProperties = (memo: Memo): PendoTrackProperties => ({
  visibility: Visibility[memo.visibility],
  is_comment: Boolean(memo.parent),
  has_space: Boolean(memo.space),
});

// Composer draft cache keys start with the host that mounted the editor (see the MemoEditor `cacheKey` props).
const COMPOSER_SOURCES: [cacheKeyPrefix: string, source: string][] = [
  ["home-memo-editor", "home"],
  ["global-memo-editor", "global_composer"],
  ["calendar-day-editor", "calendar"],
  ["map-editor", "map"],
  ["inline-memo-editor-", "inline_edit"],
];

/** Which composer saved a memo, read from the editor's draft cache key. */
export const getComposerSource = (cacheKey: string | undefined): string | undefined => {
  if (!cacheKey) return undefined;
  const source = COMPOSER_SOURCES.find(([prefix]) => cacheKey.startsWith(prefix))?.[1];
  return source ?? (cacheKey.endsWith("-comment") ? "comment" : "other");
};

/** The provider and model the instance transcribes audio with. */
export const getTranscriptionTrackProperties = (aiSetting: InstanceSetting_AISetting | undefined): PendoTrackProperties => {
  const provider = aiSetting?.providers.find((item) => item.id === aiSetting.transcription?.providerId);
  return {
    transcription_provider_type: provider ? InstanceSetting_AIProviderType[provider.type] : undefined,
    transcription_model: toPendoText(aiSetting?.transcription?.model, 50),
  };
};

/** Top-level fields that differ between two versions of a protobuf message, named as in an update mask. */
export const getChangedFields = (previous: object | undefined, next: object): string[] =>
  Object.entries(next)
    .filter(([field, value]) => !field.startsWith("$") && !isEqual(value, (previous as Record<string, unknown> | undefined)?.[field]))
    .map(([field]) => field.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`));

/** The key values of a saved instance setting. Never secrets, credentials or custom script contents. */
export const getInstanceSettingTrackProperties = ({ value }: InstanceSetting): PendoTrackProperties => {
  switch (value.case) {
    case "generalSetting":
      return {
        disallow_user_registration: value.value.disallowUserRegistration,
        disallow_password_auth: value.value.disallowPasswordAuth,
      };
    case "accessSetting":
      return { access_mode: InstanceAccessMode[value.value.accessMode] };
    case "storageSetting": {
      const storage = value.value.storages.find((item) => item.id === value.value.defaultStorageId);
      return {
        storage_type: InstanceSetting_StorageType[storage?.type ?? (value.value.storageType as number as InstanceSetting_StorageType)],
      };
    }
    case "notificationSetting":
      return { email_notifications_enabled: Boolean(value.value.email?.enabled) };
    case "memoRelatedSetting":
      return { reaction_count: value.value.reactions.length, enable_double_click_edit: value.value.enableDoubleClickEdit };
    default:
      return {};
  }
};
