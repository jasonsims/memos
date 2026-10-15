import { timestampDate } from "@bufbuild/protobuf/wkt";
import { ConnectError } from "@connectrpc/connect";
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { setAccessToken } from "@/auth-state";
import { authServiceClient, userServiceClient } from "@/connect";
import { useAuth } from "@/contexts/AuthContext";
import useNavigateTo from "@/hooks/useNavigateTo";
import { absolutifyLink } from "@/lib/browser";
import { getErrorTrackProperties, handleError } from "@/lib/error";
import { toPendoText, trackPendoEvent } from "@/lib/pendo";
import { ROUTES } from "@/router/routes";
import { type User, User_Role } from "@/types/proto/api/user_service_pb";
import { buildAuthRoute, getSafeRedirectPath } from "@/utils/auth-redirect";
import { useTranslate } from "@/utils/i18n";
import { validateOAuthState } from "@/utils/oauth";

// An SSO account created this recently was provisioned just in time by the sign-in itself.
const NEW_ACCOUNT_WINDOW_MS = 5 * 60 * 1000;

interface State {
  loading: boolean;
  errorMessage: string;
  returnUrl?: string;
}

const AuthCallback = () => {
  const t = useTranslate();
  const navigateTo = useNavigateTo();
  const { currentUser, initialize, isInitialized } = useAuth();
  const [searchParams] = useSearchParams();
  const handledRef = useRef(false);
  const [state, setState] = useState<State>({
    loading: true,
    errorMessage: "",
  });

  useEffect(() => {
    if (!isInitialized) {
      return;
    }
    if (handledRef.current) {
      return;
    }
    handledRef.current = true;
    // Check for OAuth error response first (e.g., user denied access)
    const error = searchParams.get("error");
    const errorDescription = searchParams.get("error_description");
    const errorUri = searchParams.get("error_uri");

    if (error) {
      const oauthState = searchParams.get("state");
      const validatedState = oauthState ? validateOAuthState(oauthState) : null;
      // Sign-in failure events carry the provider's error code at most: never the authorization code or state.
      trackPendoEvent("user_sign_in_failed", () => ({
        auth_method: "sso",
        failure_stage: "provider",
        oauth_error: toPendoText(error, 50),
        identity_provider: validatedState?.identityProviderName,
        flow_mode: validatedState?.flowMode,
      }));
      // OAuth provider returned an error
      let errorMessage = `OAuth error: ${error}`;
      if (errorDescription) {
        errorMessage += `\n${decodeURIComponent(errorDescription)}`;
      }
      if (errorUri) {
        errorMessage += `\nMore info: ${errorUri}`;
      }

      setState({
        loading: false,
        errorMessage,
        returnUrl: validatedState?.returnUrl,
      });
      return;
    }

    const code = searchParams.get("code");
    const state = searchParams.get("state");

    if (!code || !state) {
      trackPendoEvent("user_sign_in_failed", () => ({ auth_method: "sso", failure_stage: "missing_code_or_state" }));
      setState({
        loading: false,
        errorMessage: "Failed to authorize. Missing authorization code or state parameter.",
      });
      return;
    }

    // Validate OAuth state (CSRF protection) and retrieve PKCE code_verifier
    const validatedState = validateOAuthState(state);
    if (!validatedState) {
      trackPendoEvent("user_sign_in_failed", () => ({ auth_method: "sso", failure_stage: "invalid_state" }));
      setState({
        loading: false,
        errorMessage: "Failed to authorize. Invalid or expired state parameter. This may indicate a CSRF attack attempt.",
      });
      return;
    }

    const { flowMode, identityProviderName, returnUrl, linkingUserName, codeVerifier } = validatedState;
    const redirectUri = absolutifyLink("/auth/callback");
    (async () => {
      try {
        let signedInUser: User | undefined;
        if (flowMode === "link") {
          if (!currentUser?.name) {
            throw new Error("Failed to link account. Please sign in to Memos again and retry.");
          }
          if (linkingUserName && currentUser.name !== linkingUserName) {
            throw new Error("The signed-in user changed before the OAuth callback completed. Please retry linking from account settings.");
          }
          await userServiceClient.createLinkedIdentity({
            parent: currentUser.name,
            identityProvider: identityProviderName,
            code,
            redirectUri,
            codeVerifier: codeVerifier || "",
          });
          // Never the authorization code or the PKCE verifier.
          trackPendoEvent("linked_identity_added", () => ({
            identity_provider: identityProviderName,
            pkce_used: Boolean(codeVerifier),
            has_return_url: Boolean(returnUrl),
          }));
        } else {
          const response = await authServiceClient.signIn({
            credentials: {
              case: "ssoCredentials",
              value: {
                identityProvider: identityProviderName,
                code,
                redirectUri,
                codeVerifier: codeVerifier || "", // Pass PKCE code_verifier for token exchange
              },
            },
          });
          // Store access token from login response
          if (response.accessToken) {
            setAccessToken(
              response.accessToken,
              response.accessTokenExpireTime ? timestampDate(response.accessTokenExpireTime) : undefined,
            );
          }
          signedInUser = response.user;
        }
        setState({
          loading: false,
          errorMessage: "",
        });
        await initialize();
        if (flowMode !== "link") {
          // After initialize() identified the visitor, so the sign-in is credited to the signed-in user.
          trackPendoEvent("user_signed_in", () => ({
            auth_method: "sso",
            identity_provider: identityProviderName,
            user_role: signedInUser ? User_Role[signedInUser.role] : undefined,
            is_new_account: signedInUser?.createTime
              ? Date.now() - timestampDate(signedInUser.createTime).getTime() < NEW_ACCOUNT_WINDOW_MS
              : undefined,
            pkce_used: Boolean(codeVerifier),
            has_redirect_path: Boolean(returnUrl),
          }));
        }
        // Defense-in-depth: even though `returnUrl` was sanitized before being
        // stored (see storeOAuthState in SignIn), re-validate on the way out so
        // a corrupted state entry can never be used for an open redirect.
        navigateTo(getSafeRedirectPath(returnUrl) ?? ROUTES.HOME);
      } catch (error: unknown) {
        trackPendoEvent("user_sign_in_failed", () => {
          const { error_reason, error_code } = getErrorTrackProperties(error);
          return {
            auth_method: "sso",
            // The linking checks above throw plain errors; a failed token exchange on the server is a Connect error.
            failure_stage: error instanceof ConnectError ? "token_exchange" : "link_check",
            identity_provider: identityProviderName,
            flow_mode: flowMode,
            error_reason,
            error_code,
          };
        });
        handleError(error, () => {}, {
          fallbackMessage: "Failed to authenticate.",
          onError: (err) => {
            const message = err instanceof Error ? err.message : "Failed to authenticate.";
            setState({
              loading: false,
              errorMessage: message,
              returnUrl,
            });
          },
        });
      }
    })();
  }, [currentUser?.name, initialize, isInitialized, navigateTo, searchParams]);

  if (state.loading) return null;

  return (
    <div className="p-4 py-24 w-full h-full flex flex-col justify-center items-center gap-4">
      <div className="max-w-lg font-mono whitespace-pre-wrap break-words opacity-80" role="alert">
        {state.errorMessage}
      </div>
      {state.errorMessage && (
        <Link to={buildAuthRoute({ autoSignIn: false, redirect: state.returnUrl })} className="text-sm text-primary hover:underline">
          {t("auth.back-to-sign-in")}
        </Link>
      )}
    </div>
  );
};

export default AuthCallback;
