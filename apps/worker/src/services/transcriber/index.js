import { randomUUID } from 'node:crypto';
import { toSrt } from '../captions/srt';
class StubTranscriber {
    async transcribe(_localFile) {
        const segments = buildSegments();
        const captionSegments = segments.map(({ start, end, text }) => ({ start, end, text }));
        return {
            srt: toSrt(captionSegments),
            json: { segments },
            durationSec: captionSegments.at(-1)?.end,
        };
    }
}
function buildSegments() {
    const lines = [
        { text: 'Wow this workflow trims long recordings fast.', duration: 4.0, confidence: 0.95 },
        { text: 'Secret sauce is tagging highlight beats as you record.', duration: 4.8, confidence: 0.92 },
        { text: 'Leave a breathing gap, then deliver the punchline.', duration: 4.3, confidence: 0.9 },
        { text: 'How to remix a clip without losing the hook.', duration: 5.0, confidence: 0.91 },
        { text: 'Insane retention when captions follow the rhythm.', duration: 4.5, confidence: 0.93 },
        { text: 'Another wow moment keeps viewers watching.', duration: 4.1, confidence: 0.92 },
        { text: 'Share a tip the audience can use immediately.', duration: 4.7, confidence: 0.9 },
        { text: 'Wrap with a secret CTA so they click through.', duration: 4.2, confidence: 0.94 },
    ];
    let clock = 0;
    return lines.map((entry) => {
        const start = Number(clock.toFixed(3));
        const end = Number((clock + entry.duration).toFixed(3));
        clock = end + 1.2;
        return {
            id: randomUUID(),
            start,
            end,
            text: entry.text,
            confidence: entry.confidence,
        };
    });
}
export function getTranscriber() {
    if (process.env.DEEPGRAM_API_KEY) {
        throw new Error('Deepgram disabled in tests');
    }
    return new StubTranscriber();
}
export { StubTranscriber };
