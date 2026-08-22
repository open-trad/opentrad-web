export const PRODUCTION_CSP =
  "default-src 'self'; base-uri 'self'; object-src 'none'; form-action 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:";

export function shouldInjectProductionCsp(command: string): boolean {
  return command === "build";
}
