const AUTHENTICATION_ERROR_MESSAGES: Record<string, string> = {
  AccessDenied:
    "This account could not be signed in. Choose the correct school account and try again, or contact application support.",
  CallbackRouteError:
    "Sign-in was interrupted before it finished. Please try again.",
  Configuration:
    "Sign-in is temporarily unavailable. Please try again later or contact application support.",
  CredentialsSignin:
    "The selected test account could not be signed in. Choose another account and try again.",
  IdentityConflict:
    "This school account needs help from application support before it can be used. No accounts or progress were linked.",
  OAuthAccountNotLinked:
    "This school account needs help from application support before it can be used. No accounts or progress were linked.",
  OAuthCallbackError:
    "Sign-in was interrupted before it finished. Please try again.",
  OAuthProfileParseError:
    "Sign-in was interrupted before it finished. Please try again.",
  OAuthSignInError: "Sign-in could not be started. Please try again.",
  OAuthSignin: "Sign-in could not be started. Please try again.",
  SessionRequired: "Sign in to continue to that page.",
};

export function authenticationErrorMessage(code: string | undefined) {
  if (!code) {
    return undefined;
  }

  return (
    AUTHENTICATION_ERROR_MESSAGES[code] ??
    "Sign-in could not be completed. Please try again or contact application support."
  );
}
