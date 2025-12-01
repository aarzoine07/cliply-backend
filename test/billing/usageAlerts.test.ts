import { describe, expect, it } from "vitest";
import { calculateUsageAlerts, getPreviousAlertLevel } from "../../packages/shared/billing/usageAlerts";
import type { UsageSummary } from "../../packages/shared/billing/usageTracker";

describe("usageAlerts", () => {
  describe("calculateUsageAlerts", () => {
    it("returns normal level when usage is well below limits", () => {
      const summary: UsageSummary = {
        workspaceId: "test-workspace",
        planName: "basic",
        periodStart: new Date("2025-01-01"),
        metrics: {
          source_minutes: { used: 30, limit: 150 },
          clips: { used: 50, limit: 450 },
          projects: { used: 10, limit: 150 },
        },
      };

      const alerts = calculateUsageAlerts(summary);

      expect(alerts.hasWarning).toBe(false);
      expect(alerts.hasExceeded).toBe(false);
      expect(alerts.metrics).toHaveLength(3);

      const sourceMinutes = alerts.metrics.find((m) => m.metric === "source_minutes");
      expect(sourceMinutes?.level).toBe("normal");
      expect(sourceMinutes?.percent).toBe(20);
    });

    it("returns warning level when usage is exactly 80%", () => {
      const summary: UsageSummary = {
        workspaceId: "test-workspace",
        planName: "basic",
        periodStart: new Date("2025-01-01"),
        metrics: {
          source_minutes: { used: 120, limit: 150 }, // 80%
          clips: { used: 360, limit: 450 }, // 80%
          projects: { used: 120, limit: 150 }, // 80%
        },
      };

      const alerts = calculateUsageAlerts(summary);

      expect(alerts.hasWarning).toBe(true);
      expect(alerts.hasExceeded).toBe(false);

      alerts.metrics.forEach((m) => {
        expect(m.level).toBe("warning");
        expect(m.percent).toBe(80);
      });
    });

    it("returns warning level when usage is between 80% and 99%", () => {
      const summary: UsageSummary = {
        workspaceId: "test-workspace",
        planName: "pro",
        periodStart: new Date("2025-01-01"),
        metrics: {
          source_minutes: { used: 850, limit: 900 }, // ~94%
          clips: { used: 10000, limit: 10800 }, // ~93%
        },
      };

      const alerts = calculateUsageAlerts(summary);

      expect(alerts.hasWarning).toBe(true);
      expect(alerts.hasExceeded).toBe(false);

      const sourceMinutes = alerts.metrics.find((m) => m.metric === "source_minutes");
      expect(sourceMinutes?.level).toBe("warning");
      expect(sourceMinutes?.percent).toBe(94);
    });

    it("returns exceeded level when usage is exactly 100%", () => {
      const summary: UsageSummary = {
        workspaceId: "test-workspace",
        planName: "basic",
        periodStart: new Date("2025-01-01"),
        metrics: {
          source_minutes: { used: 150, limit: 150 }, // 100%
          clips: { used: 450, limit: 450 }, // 100%
        },
      };

      const alerts = calculateUsageAlerts(summary);

      expect(alerts.hasWarning).toBe(false);
      expect(alerts.hasExceeded).toBe(true);

      alerts.metrics.forEach((m) => {
        expect(m.level).toBe("exceeded");
        expect(m.percent).toBe(100);
      });
    });

    it("returns exceeded level when usage exceeds 100%", () => {
      const summary: UsageSummary = {
        workspaceId: "test-workspace",
        planName: "basic",
        periodStart: new Date("2025-01-01"),
        metrics: {
          source_minutes: { used: 200, limit: 150 }, // 133%
          clips: { used: 600, limit: 450 }, // 133%
        },
      };

      const alerts = calculateUsageAlerts(summary);

      expect(alerts.hasWarning).toBe(false);
      expect(alerts.hasExceeded).toBe(true);

      const sourceMinutes = alerts.metrics.find((m) => m.metric === "source_minutes");
      expect(sourceMinutes?.level).toBe("exceeded");
      expect(sourceMinutes?.percent).toBe(133);
    });

    it("handles unlimited metrics (limit: null)", () => {
      const summary: UsageSummary = {
        workspaceId: "test-workspace",
        planName: "premium",
        periodStart: new Date("2025-01-01"),
        metrics: {
          source_minutes: { used: 1000, limit: null },
          clips: { used: 500, limit: null },
        },
      };

      const alerts = calculateUsageAlerts(summary);

      expect(alerts.hasWarning).toBe(false);
      expect(alerts.hasExceeded).toBe(false);

      alerts.metrics.forEach((m) => {
        expect(m.level).toBe("normal");
        expect(m.percent).toBe(0);
        expect(m.limit).toBeNull();
      });
    });

    it("handles zero limits safely", () => {
      const summary: UsageSummary = {
        workspaceId: "test-workspace",
        planName: "basic",
        periodStart: new Date("2025-01-01"),
        metrics: {
          source_minutes: { used: 100, limit: 0 },
          clips: { used: 50, limit: 0 },
        },
      };

      const alerts = calculateUsageAlerts(summary);

      // Should not throw, should return normal level with 0% (treated as unlimited)
      alerts.metrics.forEach((m) => {
        expect(m.level).toBe("normal");
        expect(m.percent).toBe(0);
      });
    });

    it("handles mixed alert levels across metrics", () => {
      const summary: UsageSummary = {
        workspaceId: "test-workspace",
        planName: "pro",
        periodStart: new Date("2025-01-01"),
        metrics: {
          source_minutes: { used: 50, limit: 900 }, // normal (~6%)
          clips: { used: 9000, limit: 10800 }, // warning (~83%)
          projects: { used: 950, limit: 900 }, // exceeded (~106%)
        },
      };

      const alerts = calculateUsageAlerts(summary);

      expect(alerts.hasWarning).toBe(true);
      expect(alerts.hasExceeded).toBe(true);

      const sourceMinutes = alerts.metrics.find((m) => m.metric === "source_minutes");
      expect(sourceMinutes?.level).toBe("normal");

      const clips = alerts.metrics.find((m) => m.metric === "clips");
      expect(clips?.level).toBe("warning");

      const projects = alerts.metrics.find((m) => m.metric === "projects");
      expect(projects?.level).toBe("exceeded");
    });

    it("works with different plans (basic, pro, premium)", () => {
      const plans: Array<"basic" | "pro" | "premium"> = ["basic", "pro", "premium"];

      for (const plan of plans) {
        const summary: UsageSummary = {
          workspaceId: "test-workspace",
          planName: plan,
          periodStart: new Date("2025-01-01"),
          metrics: {
            source_minutes: { used: 100, limit: 150 },
            clips: { used: 200, limit: 450 },
            projects: { used: 50, limit: 150 },
          },
        };

        const alerts = calculateUsageAlerts(summary);

        expect(alerts.metrics).toHaveLength(3);
        expect(alerts.hasWarning).toBe(false);
        expect(alerts.hasExceeded).toBe(false);
      }
    });
  });

  describe("getPreviousAlertLevel", () => {
    it("returns null when previous summary is null", () => {
      const level = getPreviousAlertLevel("source_minutes", null);
      expect(level).toBeNull();
    });

    it("returns previous level for a metric", () => {
      const previousSummary = {
        metrics: [
          { metric: "source_minutes" as const, used: 100, limit: 150, percent: 67, level: "normal" as const },
          { metric: "clips" as const, used: 400, limit: 450, percent: 89, level: "warning" as const },
        ],
        hasWarning: true,
        hasExceeded: false,
      };

      const level = getPreviousAlertLevel("clips", previousSummary);
      expect(level).toBe("warning");
    });

    it("returns null when metric not found in previous summary", () => {
      const previousSummary = {
        metrics: [
          { metric: "source_minutes" as const, used: 100, limit: 150, percent: 67, level: "normal" as const },
        ],
        hasWarning: false,
        hasExceeded: false,
      };

      const level = getPreviousAlertLevel("clips", previousSummary);
      expect(level).toBeNull();
    });
  });
});

