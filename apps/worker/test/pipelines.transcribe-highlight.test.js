import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { BUCKET_TRANSCRIPTS, BUCKET_VIDEOS } from '@cliply/shared/constants';
import { run as runTranscribe } from '../src/pipelines/transcribe';
import { run as runHighlightDetect } from '../src/pipelines/highlight-detect';
const WORKSPACE_ID = '11111111-1111-1111-1111-111111111111';
const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const MOCK_SEGMENTS = [
    { start: 0, end: 5, text: 'Wow this intro reveals a secret trick.', confidence: 0.95 },
    { start: 6, end: 12, text: 'How to remix content so it feels new.', confidence: 0.92 },
    { start: 16, end: 26, text: 'Another wow tip to keep retention insane.', confidence: 0.9 },
    { start: 27, end: 36, text: 'Share a secret CTA they will appreciate.', confidence: 0.88 },
    { start: 50, end: 59, text: 'Wrap with a tip so they share it.', confidence: 0.91 },
];
vi.mock('../src/services/transcriber', () => {
    const transcribe = vi.fn(async () => ({
        srt: '1\n00:00:00,000 --> 00:00:05,000\nMock transcript\n',
        json: { segments: MOCK_SEGMENTS },
        durationSec: MOCK_SEGMENTS.at(-1)?.end ?? 40,
    }));
    return {
        getTranscriber: () => ({ transcribe }),
    };
});
describe('transcribe + highlight-detect pipelines', () => {
    let storage;
    let supabase;
    let logger;
    let queue;
    let sentry;
    let ctx;
    beforeEach(() => {
        storage = createStorageMock({
            [`${BUCKET_VIDEOS}/${WORKSPACE_ID}/${PROJECT_ID}/source.mp4`]: 'video-source',
        });
        supabase = createSupabaseMock({
            projects: [
                { id: PROJECT_ID, workspace_id: WORKSPACE_ID, status: 'uploaded' },
            ],
            clips: [],
        });
        logger = createLoggerMock();
        queue = createQueueMock();
        sentry = createSentryMock();
        ctx = {
            storage,
            supabase,
            logger,
            queue,
            sentry,
        };
    });
    it('uploads transcripts, enqueues highlight, proposes clips idempotently', async () => {
        const transcribeJob = {
            id: 'job-transcribe',
            type: 'TRANSCRIBE',
            workspaceId: WORKSPACE_ID,
            payload: { projectId: PROJECT_ID, sourceExt: 'mp4' },
        };
        const highlightJob = {
            id: 'job-highlight',
            type: 'HIGHLIGHT_DETECT',
            workspaceId: WORKSPACE_ID,
            payload: { projectId: PROJECT_ID },
        };
        await runTranscribe(transcribeJob, ctx);
        expect(storage.files.has(`${BUCKET_TRANSCRIPTS}/${WORKSPACE_ID}/${PROJECT_ID}/transcript.srt`)).toBe(true);
        expect(storage.files.has(`${BUCKET_TRANSCRIPTS}/${WORKSPACE_ID}/${PROJECT_ID}/transcript.json`)).toBe(true);
        expect(queue.enqueue).toHaveBeenCalledTimes(1);
        expect(projectStatus(supabase, PROJECT_ID)).toBe('transcribed');
        await runHighlightDetect(highlightJob, ctx);
        expect(supabase.state.clips.length).toBeGreaterThan(0);
        expect(projectStatus(supabase, PROJECT_ID)).toBe('clips_proposed');
        const uploadsAfterFirstRun = storage.upload.mock.calls.length;
        const enqueueCallsAfterFirstRun = queue.enqueue.mock.calls.length;
        const clipsAfterFirstRun = supabase.state.clips.length;
        await runTranscribe(transcribeJob, ctx);
        await runHighlightDetect(highlightJob, ctx);
        expect(storage.upload.mock.calls.length).toBe(uploadsAfterFirstRun);
        expect(queue.enqueue.mock.calls.length).toBe(enqueueCallsAfterFirstRun);
        expect(supabase.state.clips.length).toBe(clipsAfterFirstRun);
    });
});
function createStorageMock(initial) {
    const files = new Map(Object.entries(initial));
    return {
        files,
        exists: vi.fn(async (bucket, path) => files.has(`${bucket}/${path}`)),
        list: vi.fn(async (bucket, prefix) => {
            const base = `${bucket}/`;
            return Array.from(files.keys())
                .filter((key) => key.startsWith(base))
                .map((key) => key.slice(base.length))
                .filter((key) => key.startsWith(prefix));
        }),
        download: vi.fn(async (bucket, path, destination) => {
            const key = `${bucket}/${path}`;
            if (!files.has(key)) {
                throw new Error(`missing file: ${key}`);
            }
            await fs.mkdir(dirname(destination), { recursive: true });
            await fs.writeFile(destination, files.get(key) ?? '', 'utf8');
            return destination;
        }),
        upload: vi.fn(async (bucket, path, localFile) => {
            const data = await fs.readFile(localFile, 'utf8');
            files.set(`${bucket}/${path}`, data);
        }),
    };
}
function createSupabaseMock(initial) {
    const state = {
        projects: initial.projects.map((project) => ({ ...project })),
        clips: initial.clips.map((clip) => ({ ...clip })),
    };
    return {
        state,
        from(table) {
            if (table === 'projects') {
                return {
                    select: () => ({
                        eq: (field, value) => {
                            const rows = state.projects.filter((project) => project[field] === value);
                            return Promise.resolve({ data: rows, error: null });
                        },
                    }),
                    update: (values) => ({
                        eq: (field, value) => {
                            state.projects.forEach((project) => {
                                if (project[field] === value) {
                                    Object.assign(project, values);
                                }
                            });
                            return Promise.resolve({ data: null, error: null });
                        },
                    }),
                };
            }
            return {
                select: () => ({
                    eq: (field, value) => {
                        const rows = state.clips.filter((clip) => clip[field] === value);
                        return Promise.resolve({ data: rows, error: null });
                    },
                }),
                insert: (rows) => {
                    const items = Array.isArray(rows) ? rows : [rows];
                    items.forEach((item) => {
                        state.clips.push({
                            id: item.id ?? randomUUID(),
                            project_id: item.project_id,
                            workspace_id: item.workspace_id,
                            start_s: item.start_s,
                            end_s: item.end_s,
                            title: item.title,
                            confidence: item.confidence,
                            status: item.status,
                        });
                    });
                    return Promise.resolve({ data: items, error: null });
                },
            };
        },
    };
}
function createLoggerMock() {
    return {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    };
}
function createQueueMock() {
    return {
        enqueue: vi.fn(async () => { }),
    };
}
function createSentryMock() {
    return {
        captureException: vi.fn(),
    };
}
function projectStatus(mock, projectId) {
    return mock.state.projects.find((project) => project.id === projectId)?.status;
}
