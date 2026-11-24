export function portInUseMessage(port: number): string {
  return `Squad: port ${port} is in use — is Squad already running? Open http://localhost:${port}/ or use --port.`;
}

/** Listens, turning "port in use" into one line for the user (false) instead of a stack trace. */
export async function listenOrExplain(listen: () => Promise<unknown>, port: number, log: (s: string) => void): Promise<boolean> {
  try {
    await listen();
    return true;
  } catch (e) {
    if ((e as { code?: string }).code !== "EADDRINUSE") throw e;
    log(portInUseMessage(port));
    return false;
  }
}
