import { getQuotaExceededMessage, trackUsageLimitReached } from "@/lib/error";

export const errorService = {
  /**
   * Pass `operation` when the message is shown directly rather than through handleError, so a usage limit
   * refusal is still reported to Pendo with what the user was doing.
   */
  getErrorMessage(error: unknown, operation?: string): string {
    const limitMessage = getQuotaExceededMessage(error);
    if (limitMessage !== undefined) {
      if (operation) trackUsageLimitReached(error, operation);
      return limitMessage;
    }

    if (error && typeof error === "object" && "rawMessage" in error) {
      return (error as { rawMessage?: string }).rawMessage || "An error occurred";
    }

    // Handle ConnectError or errors with details property
    if (error && typeof error === "object" && "details" in error) {
      return (error as { details?: string }).details || "An error occurred";
    }

    if (error instanceof Error) {
      return error.message;
    }

    return "An unknown error occurred";
  },
};
