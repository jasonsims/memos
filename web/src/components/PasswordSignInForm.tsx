import { timestampDate } from "@bufbuild/protobuf/wkt";
import { LoaderIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "react-hot-toast";
import { setAccessToken } from "@/auth-state";
import ChallengeWidget, { CHALLENGE_TOKEN_HEADER } from "@/components/ChallengeWidget";
import CredentialFields from "@/components/CredentialFields";
import { Button } from "@/components/ui/button";
import { authServiceClient } from "@/connect";
import { useAuth } from "@/contexts/AuthContext";
import useLoading from "@/hooks/useLoading";
import useNavigateTo from "@/hooks/useNavigateTo";
import { ERROR_REASON_CHALLENGE_REQUIRED, getErrorTrackProperties, getRetryAfterSeconds, handleError, hasErrorReason } from "@/lib/error";
import { trackPendoEvent } from "@/lib/pendo";
import { ROUTES } from "@/router/routes";
import { User_Role } from "@/types/proto/api/user_service_pb";
import { useTranslate } from "@/utils/i18n";

interface PasswordSignInFormProps {
  redirectPath?: string;
  /** The sign-in page hosting the form, reported with sign-in track events. */
  entry?: "standard" | "admin";
}

function PasswordSignInForm({ redirectPath, entry = "standard" }: PasswordSignInFormProps) {
  const t = useTranslate();
  const navigateTo = useNavigateTo();
  const { initialize } = useAuth();
  const actionBtnLoadingState = useLoading(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [challengeResetKey, setChallengeResetKey] = useState(0);

  const handleFormSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (username === "" || password === "") {
      return;
    }

    if (actionBtnLoadingState.isLoading) {
      return;
    }

    try {
      actionBtnLoadingState.setLoading();
      const response = await authServiceClient.signIn(
        {
          credentials: {
            case: "passwordCredentials",
            value: { username, password },
          },
        },
        challengeToken ? { headers: { [CHALLENGE_TOKEN_HEADER]: challengeToken } } : undefined,
      );
      // Store access token from login response
      if (response.accessToken) {
        setAccessToken(response.accessToken, response.accessTokenExpireTime ? timestampDate(response.accessTokenExpireTime) : undefined);
      }
      await initialize();
      // initialize() identified the visitor; it also runs on every page load, so it cannot stand in for this event.
      trackPendoEvent("user_signed_in", () => ({
        auth_method: "password",
        sign_in_entry: entry,
        user_role: response.user ? User_Role[response.user.role] : undefined,
        challenge_completed: Boolean(challengeToken),
        has_redirect_path: Boolean(redirectPath),
      }));
      navigateTo(redirectPath || ROUTES.HOME, { replace: true });
    } catch (error: unknown) {
      // Never the username or password.
      trackPendoEvent("user_sign_in_failed", () => {
        const { error_reason, error_code } = getErrorTrackProperties(error);
        return {
          auth_method: "password",
          sign_in_entry: entry,
          failure_stage: "sign_in",
          error_reason,
          error_code,
          retry_after_seconds: getRetryAfterSeconds(error),
        };
      });
      if (hasErrorReason(error, ERROR_REASON_CHALLENGE_REQUIRED)) {
        setChallengeResetKey((key) => key + 1);
      }
      handleError(error, toast.error, {
        fallbackMessage: "Failed to sign in.",
      });
    }
    actionBtnLoadingState.setFinish();
  };

  return (
    <form className="flex w-full flex-col gap-4" onSubmit={handleFormSubmit}>
      <CredentialFields
        idPrefix="signin"
        username={username}
        password={password}
        passwordAutoComplete="current-password"
        readOnly={actionBtnLoadingState.isLoading}
        onUsernameChange={setUsername}
        onPasswordChange={setPassword}
      />
      <ChallengeWidget onToken={setChallengeToken} resetKey={challengeResetKey} />
      <Button type="submit" disabled={actionBtnLoadingState.isLoading}>
        {t("common.sign-in")}
        {actionBtnLoadingState.isLoading && <LoaderIcon className="ml-1 h-4 w-auto animate-spin opacity-60" />}
      </Button>
    </form>
  );
}

export default PasswordSignInForm;
