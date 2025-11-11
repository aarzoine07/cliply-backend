import { describe, expect, it } from "vitest";
import { parseSrt, secToTimestamp, timestampToSec, toSrt } from "../src/services/captions/srt";
describe('srt utils', () => {
    it('converts seconds to timestamp and back', () => {
        const ts = secToTimestamp(3723.4567);
        expect(ts).toBe('01:02:03,457');
        expect(timestampToSec(ts)).toBeCloseTo(3723.457, 3);
    });
    it('serialises segments to SRT format', () => {
        const srt = toSrt([
            { start: 0, end: 2.345, text: 'Hello world' },
            { start: 3.5, end: 8.75, text: 'Another line' },
        ]);
        expect(srt.trim()).toBe([
            '1',
            '00:00:00,000 --> 00:00:02,345',
            'Hello world',
            '',
            '2',
            '00:00:03,500 --> 00:00:08,750',
            'Another line',
        ].join('\n'));
    });
    it('parses SRT back into segments', () => {
        const input = [
            '1',
            '00:00:00,000 --> 00:00:02,345',
            'Hello world',
            '',
            '2',
            '00:00:03,500 --> 00:00:08,750',
            'Another line',
            '',
            '',
        ].join('\n');
        const parsed = parseSrt(input);
        expect(parsed).toHaveLength(2);
        expect(parsed[0].index).toBe(1);
        expect(parsed[0].text).toBe('Hello world');
        expect(parsed[0].start).toBeCloseTo(0, 3);
        expect(parsed[0].end).toBeCloseTo(2.345, 3);
        expect(parsed[1].index).toBe(2);
        expect(parsed[1].start).toBeCloseTo(3.5, 3);
        expect(parsed[1].end).toBeCloseTo(8.75, 3);
    });
    it('throws on invalid timestamp', () => {
        expect(() => timestampToSec('invalid')).toThrow();
    });
});
