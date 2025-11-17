console.log("ENQUEUE DB URL =", process.env.SUPABASE_URL);
import { enqueueJob } from "./apps/worker/src/jobs/enqueue.ts";

const WS = "6cf86e2b-9fb4-48c2-822f-e6ed17591900";

const run = async () => {
  const id = await enqueueJob(WS, "transcribe", {
    src: "/test-assets/sample.mp4",
  });
  console.log("ENQUEUED JOB:", id);
};

run();
