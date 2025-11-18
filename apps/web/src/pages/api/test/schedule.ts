import type { NextApiRequest, NextApiResponse } from "next";
import { withPlanGate } from "../../../middleware/planGate";

async function handler(_req: NextApiRequest, res: NextApiResponse) {
  // If gate passes, pretend to schedule successfully.
  return res.status(200).json({ ok: true, data: { scheduled: true } });
}

export default withPlanGate(handler, "schedule");

