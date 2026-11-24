import { cookieName, type SignIn } from "../src/signin/index.ts";

/** A signed-in cookie map for `app.inject({ cookies })`, made by creating a remember session directly. */
export function signedInCookie(signin: SignIn, port: number): Record<string, string> {
  const { id } = signin.sessions.create("remember", null, "test");
  return { [cookieName("session", port)]: id };
}
