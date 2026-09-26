import type { ActionFunctionArgs } from "react-router";
import { kickJob, verifyJobContinueSignature } from "../lib/jobs/worker.server";

/**
 * Server-to-server hand-off between job chunks on serverless hosts (see
 * worker.server.ts). Signed with an HMAC of the job ID keyed by the app's
 * client secret, so it can't be triggered from outside. Responds immediately;
 * the chunk runs under waitUntil in this fresh invocation.
 */
export const action = async ({ request, params }: ActionFunctionArgs) => {
  const jobId = params.id!;
  if (!verifyJobContinueSignature(jobId, request.headers.get("x-bulkflow-signature"))) {
    return new Response("Forbidden", { status: 403 });
  }
  kickJob(jobId);
  return new Response(null, { status: 202 });
};

export const loader = () => new Response("Method Not Allowed", { status: 405 });
