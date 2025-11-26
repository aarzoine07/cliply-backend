"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PLAN_MATRIX = void 0;
/** Plan capability matrix consumed by backend services and UI gating. */
exports.PLAN_MATRIX = {
    /** Basic — individual creators getting started with automated clipping. */
    basic: {
        description: "Individual creators experimenting with AI-powered clipping.",
        limits: {
            schedule: false,
            ai_titles: false,
            ai_captions: false,
            watermark_free_exports: false,
            uploads_per_day: 5,
            clips_per_project: 3,
            max_team_members: 1,
            storage_gb: 15,
            concurrent_jobs: 2,
            source_minutes_per_month: 150, // 5 uploads/day * 30 days * ~1 min avg
            clips_per_month: 450, // 5 uploads/day * 30 days * 3 clips/project
            projects_per_month: 150, // 5 uploads/day * 30 days
        },
    },
    /** Pro — small teams scaling their content workflows. */
    pro: {
        description: "Growing teams needing faster throughput and AI assistance.",
        limits: {
            schedule: true,
            ai_titles: true,
            ai_captions: true,
            watermark_free_exports: true,
            uploads_per_day: 30,
            clips_per_project: 12,
            max_team_members: 5,
            storage_gb: 80,
            concurrent_jobs: 6,
            source_minutes_per_month: 900, // 30 uploads/day * 30 days * ~1 min avg
            clips_per_month: 10800, // 30 uploads/day * 30 days * 12 clips/project
            projects_per_month: 900, // 30 uploads/day * 30 days
        },
    },
    /** Premium — agencies managing multiple clients with high volume demands. */
    premium: {
        description: "Agencies coordinating multiple brands with high volume needs.",
        limits: {
            schedule: true,
            ai_titles: true,
            ai_captions: true,
            watermark_free_exports: true,
            uploads_per_day: 150,
            clips_per_project: 40,
            max_team_members: 15,
            storage_gb: 250,
            concurrent_jobs: 15,
            source_minutes_per_month: 4500, // 150 uploads/day * 30 days * ~1 min avg
            clips_per_month: 180000, // 150 uploads/day * 30 days * 40 clips/project
            projects_per_month: 4500, // 150 uploads/day * 30 days
        },
    },
};
//# sourceMappingURL=planMatrix.js.map