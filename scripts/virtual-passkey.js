// Body for the Playwright MCP `browser_run_code_unsafe` tool (it supplies `page`).
// Adds a virtual WebAuthn authenticator to the page's browser context so Squad's
// "Create passkey" and "Sign in" buttons work without real hardware.
// Returns the authenticator id. Run it before clicking Create passkey.
async (page) => {
  const client = await page.context().newCDPSession(page);
  await client.send("WebAuthn.enable");
  const { authenticatorId } = await client.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
    },
  });
  return authenticatorId;
}
