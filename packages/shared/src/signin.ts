export type SessionKind = "remember" | "restart";
export interface SessionStatus { signedIn: boolean; setupNeeded: boolean; setupGrant: boolean }
export interface PasskeyInfo { id: string; name: string; createdAt: number; lastUsedAt: number | null }
export interface SessionInfo { id: string; kind: SessionKind; label: string; createdAt: number; lastUsedAt: number; current: boolean }
export interface SignInOverview { passkeys: PasskeyInfo[]; sessions: SessionInfo[] }
