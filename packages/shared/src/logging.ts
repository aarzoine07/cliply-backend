type ContextLike = Record<string, unknown>;

type PrimaryInput =
  | string
  | {
      msg?: string;
      context?: ContextLike;
      jobId?: string | number;
      job_id?: string | number;
      status?: string;
      job?: { id?: string | number; status?: string } | null;
      [key: string]: unknown;
    };

type MetaInput = ContextLike | undefined;

function toStringOpt(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  return String(v);
}

export function createLogger(component: string) {
  const base = () => ({
    component,
    timestamp: new Date().toISOString(),
  });

  function normalize(input: PrimaryInput, meta?: MetaInput) {
    // Normalize first arg to object with msg if needed
    const obj: Record<string, unknown> =
      typeof input === "string" ? { msg: input } : { ...input };

    // Start with any provided context object
    const context: Record<string, unknown> = obj.context && typeof obj.context === "object"
      ? { ...(obj.context as object) }
      : {};

    // Allow meta arg (second param) as extra context
    if (meta && typeof meta === "object") {
      Object.assign(context, meta);
    }

    // Accept shorthand and alternative shapes
    const jobId =
      toStringOpt(obj.jobId) ??
      toStringOpt((obj as any).job_id) ??
      (obj.job && typeof obj.job === "object" ? toStringOpt((obj.job as any).id) : undefined);

    const status =
      toStringOpt(obj.status) ??
      (obj.job && typeof obj.job === "object" ? toStringOpt((obj.job as any).status) : undefined);

    if (jobId) context.jobId = jobId;
    if (status) context.status = status;

    // Remove fields we’ve hoisted into context to avoid duplicates
    const {
      context: _skipCtx,
      jobId: _skipJobId,
      job_id: _skipJob_id,
      status: _skipStatus,
      job: _skipJob,
      ...rest
    } = obj;

    return { context, rest };
  }

  function format(level: "info" | "error", input: PrimaryInput, meta?: MetaInput): string {
    const { context, rest } = normalize(input, meta);

    // Only include context if it has keys
    const ctx = Object.keys(context).length ? { context } : {};

    return JSON.stringify({
      level,
      ...base(),
      ...ctx,
      ...rest,
    });
  }

  return {
    info(input: PrimaryInput, meta?: MetaInput) {
      console.log(format("info", input, meta));
    },
    error(input: PrimaryInput, meta?: MetaInput) {
      console.error(format("error", input, meta));
    },
  };
}
