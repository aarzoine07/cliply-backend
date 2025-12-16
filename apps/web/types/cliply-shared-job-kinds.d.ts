declare module "@cliply/shared/job-kinds" {
  /**
   * Minimal type surface for JOB_KINDS/JobKind, just enough for the web app.
   * At runtime, the real implementation comes from @cliply/shared.
   */
  export type JobKind = string;
  export const JOB_KINDS: readonly JobKind[];
}
