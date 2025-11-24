import type { NextApiRequest, NextApiResponse } from 'next';

import { BUCKET_VIDEOS } from '@cliply/shared/constants';
import { TRANSCRIBE } from '@cliply/shared/schemas/jobs';

import { handler, ok, err } from '@/lib/http';
import { logger } from '@/lib/logger';
import { getAdminClient } from '@/lib/supabase';

/**
 * Webhook handler for Supabase Storage events.
 * This endpoint is called when files are uploaded to storage buckets.
 * For file uploads to the videos bucket, it automatically enqueues TRANSCRIBE jobs.
 *
 * Expected webhook payload format (Supabase Storage webhook):
 * {
 *   "type": "INSERT",
 *   "table": "objects",
 *   "record": {
 *     "bucket_id": "videos",
 *     "name": "{workspaceId}/{projectId}/source.mp4",
 *     ...
 *   }
 * }
 */
export default handler(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json(err('method_not_allowed', 'Method not allowed'));
    return;
  }

  try {
    const body = req.body as unknown;
    logger.info('storage_webhook_received', { body: JSON.stringify(body) });

    // Parse webhook payload
    // Supabase storage webhooks can vary in format, so we handle both direct object events
    // and database trigger events
    let bucketId: string | undefined;
    let objectName: string | undefined;

    if (body && typeof body === 'object') {
      const payload = body as Record<string, unknown>;

      // Handle Supabase storage webhook format (from storage.objects table trigger)
      if (payload.record && typeof payload.record === 'object') {
        const record = payload.record as Record<string, unknown>;
        bucketId = record.bucket_id as string | undefined;
        objectName = record.name as string | undefined;
      }

      // Handle direct webhook format (if Supabase sends it differently)
      if (!bucketId && payload.bucket) {
        bucketId = payload.bucket as string;
      }
      if (!objectName && payload.name) {
        objectName = payload.name as string;
      }
    }

    if (!bucketId || !objectName) {
      logger.warn('storage_webhook_invalid_payload', { body });
      res.status(400).json(err('invalid_payload', 'Missing bucket_id or name in webhook payload'));
      return;
    }

    // Only process uploads to the videos bucket
    if (bucketId !== BUCKET_VIDEOS) {
      logger.info('storage_webhook_ignored_bucket', { bucketId, objectName });
      res.status(200).json(ok({ message: 'Ignored - not videos bucket' }));
      return;
    }

    // Parse object path: {workspaceId}/{projectId}/source.{ext}
    const pathParts = objectName.split('/');
    if (pathParts.length < 3 || !pathParts[2]?.startsWith('source.')) {
      logger.info('storage_webhook_ignored_path', { objectName, reason: 'Not a source file' });
      res.status(200).json(ok({ message: 'Ignored - not a source file path' }));
      return;
    }

    const workspaceId = pathParts[0];
    const projectId = pathParts[1];
    const sourceFile = pathParts[2];

    // Extract file extension
    const extMatch = sourceFile.match(/source\.(.+)$/);
    const sourceExt = extMatch?.[1] as 'mp4' | 'mov' | 'mkv' | 'webm' | undefined;

    if (!sourceExt || !['mp4', 'mov', 'mkv', 'webm'].includes(sourceExt)) {
      logger.info('storage_webhook_ignored_extension', { objectName, sourceExt });
      res.status(200).json(ok({ message: 'Ignored - unsupported file extension' }));
      return;
    }

    // Verify project exists and is in 'queued' status (not already processing)
    const admin = getAdminClient();
    const { data: project, error: projectError } = await admin
      .from('projects')
      .select('id,workspace_id,status,source_type')
      .eq('id', projectId)
      .eq('workspace_id', workspaceId)
      .maybeSingle();

    if (projectError || !project) {
      logger.warn('storage_webhook_project_not_found', {
        projectId,
        workspaceId,
        error: projectError?.message,
      });
      res.status(200).json(ok({ message: 'Project not found - skipping' }));
      return;
    }

    // Only auto-trigger for file uploads (not YouTube, which already has YOUTUBE_DOWNLOAD)
    if (project.source_type !== 'file') {
      logger.info('storage_webhook_ignored_source_type', {
        projectId,
        sourceType: project.source_type,
      });
      res.status(200).json(ok({ message: 'Ignored - not a file upload project' }));
      return;
    }

    // Only trigger if project is still in 'queued' status (hasn't started processing)
    if (project.status !== 'queued') {
      logger.info('storage_webhook_project_already_processing', {
        projectId,
        currentStatus: project.status,
      });
      res.status(200).json(ok({ message: 'Project already processing - skipping' }));
      return;
    }

    // Check if TRANSCRIBE job already exists for this project (idempotency)
    const { data: existingJobs } = await admin
      .from('jobs')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('kind', 'TRANSCRIBE')
      .eq('payload->>projectId', projectId)
      .in('status', ['queued', 'running']);

    if (existingJobs && existingJobs.length > 0) {
      logger.info('storage_webhook_job_already_exists', {
        projectId,
        existingJobIds: existingJobs.map((j) => j.id),
      });
      res.status(200).json(ok({ message: 'TRANSCRIBE job already queued' }));
      return;
    }

    // Enqueue TRANSCRIBE job
    const payload = TRANSCRIBE.parse({ projectId, sourceExt });
    const { error: jobError } = await admin.from('jobs').insert({
      workspace_id: workspaceId,
      kind: 'TRANSCRIBE',
      status: 'queued',
      payload,
    });

    if (jobError) {
      logger.error('storage_webhook_enqueue_failed', {
        projectId,
        workspaceId,
        error: jobError.message,
      });
      res.status(500).json(err('internal_error', 'Failed to enqueue TRANSCRIBE job'));
      return;
    }

    // Update project status to 'processing'
    await admin
      .from('projects')
      .update({ status: 'processing' })
      .eq('id', projectId)
      .eq('workspace_id', workspaceId);

    logger.info('storage_webhook_transcribe_enqueued', {
      projectId,
      workspaceId,
      objectName,
      sourceExt,
    });

    res.status(200).json(ok({ message: 'TRANSCRIBE job enqueued', projectId }));
  } catch (error) {
    logger.error('storage_webhook_error', {
      error: (error as Error)?.message ?? String(error),
      body: req.body,
    });
    res.status(500).json(err('internal_error', 'Webhook processing failed'));
  }
});

