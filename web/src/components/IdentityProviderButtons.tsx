import { LoaderIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "react-hot-toast";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { handleError } from "@/lib/error";
import { toPendoText, trackPendoEvent } from "@/lib/pendo";
import { ROUTES } from "@/router/routes";
import { IdentityProvider } from "@/types/proto/api/idp_service_pb";
import { AUTH_AUTO_SIGN_IN_PARAM } from "@/utils/auth-redirect";
import { useTranslate } from "@/utils/i18n";
import { getSSOConfig, signInWithSSO } from "@/utils/sso";

interface Props {
  identityProviderList: IdentityProvider[];
  redirectTarget?: string;
  autoSignIn?: boolean;
}

const IdentityProviderButtons = ({ identityProviderList, redirectTarget, autoSignIn = false }: Props) => {
  const t = useTranslate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [pendingProvider, setPendingProvider] = useState<IdentityProvider>();
  const pendingRef = useRef(false);
  const automaticAttemptedRef = useRef(false);

  const handleSignInWithIdentityProvider = useCallback(
    async (identityProvider: IdentityProvider, isAutomatic = false) => {
      if (pendingRef.current) return;
      pendingRef.current = true;
      setPendingProvider(identityProvider);
      try {
        // Mark this history entry before leaving, so Back/reload offers manual sign-in.
        setSearchParams(
          (previous) => {
            const next = new URLSearchParams(previous);
            next.set(AUTH_AUTO_SIGN_IN_PARAM, "false");
            return next;
          },
          { replace: true },
        );
        // The automatic redirect is not a click, so only this event shows it.
        trackPendoEvent("sso_sign_in_initiated", () => ({
          identity_provider: identityProvider.name,
          identity_provider_title: toPendoText(identityProvider.title, 50),
          is_automatic: isAutomatic,
          provider_count: identityProviderList.length,
          page: window.location.pathname.startsWith(ROUTES.AUTH_SIGNUP) ? "signup" : "signin",
          has_redirect_target: Boolean(redirectTarget),
        }));
        await signInWithSSO(identityProvider, redirectTarget);
      } catch (error) {
        pendingRef.current = false;
        setPendingProvider(undefined);
        handleError(error, toast.error, {
          context: "Failed to initiate OAuth flow",
          fallbackMessage: "Failed to initiate sign-in. Please try again.",
        });
      }
    },
    [identityProviderList.length, redirectTarget, setSearchParams],
  );

  useEffect(() => {
    const provider = identityProviderList[0];
    if (
      !autoSignIn ||
      identityProviderList.length !== 1 ||
      !provider ||
      !getSSOConfig(provider) ||
      searchParams.get(AUTH_AUTO_SIGN_IN_PARAM) === "false" ||
      automaticAttemptedRef.current
    ) {
      return;
    }
    automaticAttemptedRef.current = true;
    void handleSignInWithIdentityProvider(provider, true);
  }, [autoSignIn, identityProviderList, searchParams, handleSignInWithIdentityProvider]);

  useEffect(() => {
    // Back may restore the page from bfcache with React's pending state intact.
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        pendingRef.current = false;
        setPendingProvider(undefined);
      }
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  return (
    <div className="flex w-full flex-col gap-2">
      {identityProviderList.map((identityProvider) => (
        <Button
          key={identityProvider.name}
          variant="outline"
          disabled={Boolean(pendingProvider)}
          aria-busy={pendingProvider?.name === identityProvider.name}
          onClick={() => void handleSignInWithIdentityProvider(identityProvider)}
        >
          {pendingProvider?.name === identityProvider.name && (
            <LoaderIcon className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          )}
          {t("auth.continue-with", { provider: identityProvider.title })}
        </Button>
      ))}
    </div>
  );
};

export default IdentityProviderButtons;
