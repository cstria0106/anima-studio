export const PORTABLE_APP_HOST = "127.0.0.1";
export const PORTABLE_APP_PORT = 8787;

export function portableAccessHost(bindingHost: string): string {
  return bindingHost === "0.0.0.0" ? PORTABLE_APP_HOST : bindingHost;
}

export function portableUrl(bindingHost: string, port: number): string {
  return `http://${portableAccessHost(bindingHost)}:${port}`;
}
