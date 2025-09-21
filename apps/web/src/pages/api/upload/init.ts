import { randomUUID } from 'node:crypto';

import { BUCKET_VIDEOS, SIGNED_URL_TTL_SEC, getExtension } from '@cliply/shared/constants';
import { UploadInitFileOut, UploadInitInput, UploadInitYtOut } from '@cliply/shared/schemas';
import type { NextApiRequest, NextApiResponse } from 'next';

import { requireUser } from '@/lib/auth';
import { handler, ok, err } from '@/lib/http';
import { logger } from '@/lib/logger';
import { checkRateLimit } from '@/lib/rate-limit';
import { getSignedUploadUrl } from '@/lib/storage';
import { getAdminClient } from '@/lib/supabase';

export default handler(async (req: NextApiRequest, res: NextApiResponse) => {
  const started = Date.now();
  logger.info('upload_init_start', { method: req.method ?? 'GET' });

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json(err('method_not_allowed', 'Method not allowed'));
    return;
  }

  const auth = requireUser(req);
  const { userId, workspaceId } = auth;

  if (!workspaceId) {
    res.status(400).json(err('invalid_request', 'workspace required'));
    return;
  }

  const rate = await checkRateLimit(userId, 'upload:init');
  if (!rate.allowed) {
    res.status(429).json(err('too_many_requests', 'Rate limited'));
    return;
  }

  const parsed = UploadInitInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(err('invalid_request', 'Invalid payload', parsed.error.flatten()));
    return;
  }

  const admin = getAdminClient();

  if (parsed.data.source === 'file') {
    const projectId = randomUUID();
    const extension = getExtension(parsed.data.filename) ?? '.mp4';
    const normalizedExtension = extension.startsWith('.') ? extension : `.${extension}`;
    const storageKey = `${workspaceId}/${projectId}/source${normalizedExtension}`;
    const storagePath = `${BUCKET_VIDEOS}/${storageKey}`;

    try {
      const signedUrl = await getSignedUploadUrl(storageKey, SIGNED_URL_TTL_SEC, BUCKET_VIDEOS);

      const title = deriveTitle(parsed.data.filename);
      const { data: project, error: insertError } = await admin
        .from('projects')
        .insert({
          id: projectId,
          workspace_id: workspaceId,
          title,
          source_type: 'file',
          source_path: storagePath,
          status: 'queued',
        })
        .select()
        .maybeSingle();

      if (insertError || !project) {
        logger.error('upload_init_project_insert_failed', {
          workspaceId,
          message: insertError?.message,
        });
        res.status(500).json(err('internal_error', 'Failed to create project'));
        return;
      }

      const payload = UploadInitFileOut.parse({
        uploadUrl: signedUrl,
        storagePath,
        projectId,
      });

      logger.info('upload_init_success', {
        userId,
        workspaceId,
        source: 'file',
        durationMs: Date.now() - started,
        remainingTokens: rate.remaining,
      });

      res.status(200).json(ok(payload));
      return;
    } catch (error) {
      logger.error('upload_init_file_flow_failed', {
        message: (error as Error)?.message ?? 'unknown',
        workspaceId,
      });
      res.status(500).json(err('internal_error', 'Failed to prepare upload'));
      return;
    }
  }

  try {
    const projectId = randomUUID();
    const { data: project, error: insertError } = await admin
      .from('projects')
      .insert({
        id: projectId,
        workspace_id: workspaceId,
        title: `YouTube Import ${new Date().toISOString()}`,
        source_type: 'youtube',
        source_path: parsed.data.url,
        status: 'queued',
      })
      .select()
      .maybeSingle();

    if (insertError || !project) {
      logger.error('upload_init_youtube_insert_failed', {
        workspaceId,
        message: insertError?.message,
      });
      res.status(500).json(err('internal_error', 'Failed to create project'));
      return;
    }

    const payload = UploadInitYtOut.parse({ projectId });

    logger.info('upload_init_success', {
      userId,
      workspaceId,
      source: 'youtube',
      durationMs: Date.now() - started,
      remainingTokens: rate.remaining,
    });

    res.status(200).json(ok(payload));
  } catch (error) {
    logger.error('upload_init_youtube_flow_failed', {
      message: (error as Error)?.message ?? 'unknown',
      workspaceId,
    });
    res.status(500).json(err('internal_error', 'Failed to create project'));
  }
});

function deriveTitle(filename: string): string {
  const trimmed = filename.trim();
  const lastDot = trimmed.lastIndexOf('.');
  if (lastDot <= 0) {
    return trimmed || 'Untitled Project';
  }
  const base = trimmed.slice(0, lastDot).trim();
  return base || 'Untitled Project';
}
