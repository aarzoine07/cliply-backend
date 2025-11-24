import { createClient } from '@supabase/supabase-js';
import { getEnv } from '@cliply/shared/env';

const env = getEnv();

const SUPABASE_URL = env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing required environment variables: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

// Parse command line arguments or use env vars
const args = process.argv.slice(2);
const workspaceId = args.find((arg) => arg.startsWith('--workspace-id='))?.split('=')[1] || process.env.WORKSPACE_ID;
const clipId = args.find((arg) => arg.startsWith('--clip-id='))?.split('=')[1] || process.env.CLIP_ID;
const accountId = args.find((arg) => arg.startsWith('--account-id='))?.split('=')[1] || process.env.CONNECTED_ACCOUNT_ID;
const caption = args.find((arg) => arg.startsWith('--caption='))?.split('=')[1] || process.env.CAPTION;

if (!workspaceId || !clipId || !accountId) {
  console.error('Missing required arguments:');
  console.error('  --workspace-id=<uuid> or WORKSPACE_ID env var');
  console.error('  --clip-id=<uuid> or CLIP_ID env var');
  console.error('  --account-id=<uuid> or CONNECTED_ACCOUNT_ID env var');
  console.error('');
  console.error('Optional:');
  console.error('  --caption=<text> or CAPTION env var');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main(): Promise<void> {
  console.log('🔍 Validating clip and account...');

  // Validate clip exists and belongs to workspace
  const { data: clip, error: clipError } = await supabase
    .from('clips')
    .select('id, workspace_id, status, storage_path, caption_suggestion')
    .eq('id', clipId)
    .eq('workspace_id', workspaceId)
    .maybeSingle();

  if (clipError) {
    console.error('❌ Failed to fetch clip:', clipError.message);
    process.exit(1);
  }

  if (!clip) {
    console.error(`❌ Clip ${clipId} not found in workspace ${workspaceId}`);
    process.exit(1);
  }

  if (clip.status !== 'ready') {
    console.error(`❌ Clip is not ready for publishing (status: ${clip.status})`);
    process.exit(1);
  }

  if (!clip.storage_path) {
    console.error('❌ Clip has no storage_path');
    process.exit(1);
  }

  console.log(`✅ Clip validated: ${clip.id}`);
  console.log(`   Status: ${clip.status}`);
  console.log(`   Storage path: ${clip.storage_path}`);

  // Validate connected account exists and is TikTok
  const { data: account, error: accountError } = await supabase
    .from('connected_accounts')
    .select('id, workspace_id, platform, status')
    .eq('id', accountId)
    .eq('workspace_id', workspaceId)
    .maybeSingle();

  if (accountError) {
    console.error('❌ Failed to fetch connected account:', accountError.message);
    process.exit(1);
  }

  if (!account) {
    console.error(`❌ Connected account ${accountId} not found in workspace ${workspaceId}`);
    process.exit(1);
  }

  if (account.platform !== 'tiktok') {
    console.error(`❌ Connected account is not TikTok (platform: ${account.platform})`);
    process.exit(1);
  }

  if (account.status !== 'active' && account.status !== null) {
    console.error(`❌ Connected account is not active (status: ${account.status})`);
    process.exit(1);
  }

  console.log(`✅ Account validated: ${account.id}`);
  console.log(`   Platform: ${account.platform}`);
  console.log(`   Status: ${account.status || 'active'}`);

  // Create PUBLISH_TIKTOK job
  console.log('\n📝 Creating PUBLISH_TIKTOK job...');

  const jobPayload = {
    clipId,
    connectedAccountId: accountId,
    caption: caption || clip.caption_suggestion || undefined,
    privacyLevel: 'PUBLIC_TO_EVERYONE' as const,
  };

  const { data: job, error: jobError } = await supabase
    .from('jobs')
    .insert({
      workspace_id: workspaceId,
      kind: 'PUBLISH_TIKTOK',
      status: 'queued',
      payload: jobPayload,
    })
    .select('id, kind, status, created_at')
    .single();

  if (jobError) {
    console.error('❌ Failed to create job:', jobError.message);
    process.exit(1);
  }

  console.log('✅ Job created successfully!');
  console.log('\n📊 Job Details:');
  console.log(`   Job ID: ${job.id}`);
  console.log(`   Kind: ${job.kind}`);
  console.log(`   Status: ${job.status}`);
  console.log(`   Created at: ${job.created_at}`);
  console.log(`   Workspace ID: ${workspaceId}`);
  console.log(`   Clip ID: ${clipId}`);
  console.log(`   Account ID: ${accountId}`);
  if (caption || clip.caption_suggestion) {
    console.log(`   Caption: ${caption || clip.caption_suggestion}`);
  }

  console.log('\n💡 Next steps:');
  console.log('   1. Ensure the worker is running: pnpm -C apps/worker dev');
  console.log('   2. Monitor logs for PUBLISH_TIKTOK pipeline execution');
  console.log('   3. Check variant_posts table for posted status');
  console.log(`   4. Query job status: SELECT * FROM jobs WHERE id = '${job.id}'`);
}

main().catch((error) => {
  console.error('❌ Smoke test failed:', error);
  process.exit(1);
});

