declare module "@cliply/shared/errorCodes" {
  /**
   * Minimal type surface for ERROR_CODES, just enough for the web app.
   * At runtime, the real implementation comes from @cliply/shared.
   */
  export const ERROR_CODES: Record<string, string>;
}
