export interface ApmUserInfo {
  userId: string | number | null;
  roleId: string | number | null;
  sessionId: string | null;
}

/**
 * Provides current logged-in user info for APM logs.
 * Called on every log flush — implementation should be fast (cached lookup preferred).
 */
export interface ApmUserProvider {
  getUserInfo(): ApmUserInfo | null;
}
