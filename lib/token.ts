import { SignJWT, jwtVerify } from "jose";

// Dev secret fallback only — set JOIN_TOKEN_SECRET in prod. Fail-fast in prod handled by caller.
const secret = new TextEncoder().encode(
  process.env.JOIN_TOKEN_SECRET ?? "dev-only-insecure-secret-change-me",
);

export interface JoinClaims {
  sessionId: string;
  participantId: string;
  role: "host" | "guest";
}

export async function issueJoinToken(claims: JoinClaims): Promise<string> {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(secret);
}

export async function verifyJoinToken(token: string): Promise<JoinClaims> {
  const { payload } = await jwtVerify(token, secret);
  return {
    sessionId: payload.sessionId as string,
    participantId: payload.participantId as string,
    role: payload.role as "host" | "guest",
  };
}
