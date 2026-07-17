export const SECURITY_ACTIONS = [
  "OWNER_CREATED", "PASSWORD_LOGIN", "PASSKEY_LOGIN", "SIGNED_OUT", "PROFILE_UPDATED",
  "EMAIL_CHANGED", "PASSWORD_CHANGED", "PASSWORD_RESET_CLI", "PASSKEY_REGISTERED",
  "PASSKEY_REVOKED", "SESSION_REVOKED", "OTHER_SESSIONS_REVOKED",
] as const;

export function securityEventLabel(action: string): string {
  return ({
    OWNER_CREATED: "Owner account created",
    PASSWORD_LOGIN: "Signed in with password",
    PASSKEY_LOGIN: "Signed in with passkey",
    SIGNED_OUT: "Signed out",
    PROFILE_UPDATED: "Profile updated",
    EMAIL_CHANGED: "Login email changed",
    PASSWORD_CHANGED: "Password changed",
    PASSWORD_RESET_CLI: "Password reset from server terminal",
    PASSKEY_REGISTERED: "Passkey added",
    PASSKEY_REVOKED: "Passkey revoked",
    SESSION_REVOKED: "Session revoked",
    OTHER_SESSIONS_REVOKED: "Other sessions revoked",
  } as Record<string,string>)[action] ?? "Security setting changed";
}
