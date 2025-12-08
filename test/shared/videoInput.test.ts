import { describe, expect, it } from "vitest";
import { parseAndValidateVideoSource } from "../../packages/shared/src/engine/videoInput";
import { InvalidVideoUrlError } from "../../packages/shared/src/errors/video";

describe("Video Input Validation", () => {
  describe("YouTube URL parsing", () => {
    it("should parse standard YouTube watch URLs", () => {
      const result = parseAndValidateVideoSource("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
      expect(result.kind).toBe("YOUTUBE");
      if (result.kind === "YOUTUBE") {
        expect(result.videoId).toBe("dQw4w9WgXcQ");
        expect(result.url).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
      }
    });

    it("should parse youtu.be short URLs", () => {
      const result = parseAndValidateVideoSource("https://youtu.be/dQw4w9WgXcQ");
      expect(result.kind).toBe("YOUTUBE");
      if (result.kind === "YOUTUBE") {
        expect(result.videoId).toBe("dQw4w9WgXcQ");
      }
    });

    it("should parse YouTube Shorts URLs", () => {
      const result = parseAndValidateVideoSource("https://www.youtube.com/shorts/abc123");
      expect(result.kind).toBe("YOUTUBE");
      if (result.kind === "YOUTUBE") {
        expect(result.videoId).toBe("abc123");
      }
    });

    it("should parse YouTube embed URLs", () => {
      const result = parseAndValidateVideoSource("https://www.youtube.com/embed/dQw4w9WgXcQ");
      expect(result.kind).toBe("YOUTUBE");
      if (result.kind === "YOUTUBE") {
        expect(result.videoId).toBe("dQw4w9WgXcQ");
      }
    });

    it("should handle YouTube URLs with additional parameters", () => {
      const result = parseAndValidateVideoSource(
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30s&feature=share",
      );
      expect(result.kind).toBe("YOUTUBE");
      if (result.kind === "YOUTUBE") {
        expect(result.videoId).toBe("dQw4w9WgXcQ");
      }
    });
  });

  describe("TikTok URL parsing", () => {
    it("should parse TikTok URLs", () => {
      const result = parseAndValidateVideoSource("https://www.tiktok.com/@user/video/1234567890");
      expect(result.kind).toBe("TIKTOK");
      if (result.kind === "TIKTOK") {
        expect(result.url).toBe("https://www.tiktok.com/@user/video/1234567890");
      }
    });
  });

  describe("Direct URL parsing", () => {
    it("should accept valid HTTP URLs", () => {
      const result = parseAndValidateVideoSource("http://example.com/video.mp4");
      expect(result.kind).toBe("DIRECT_URL");
      if (result.kind === "DIRECT_URL") {
        expect(result.url).toBe("http://example.com/video.mp4");
      }
    });

    it("should accept valid HTTPS URLs", () => {
      const result = parseAndValidateVideoSource("https://example.com/video.mp4");
      expect(result.kind).toBe("DIRECT_URL");
      if (result.kind === "DIRECT_URL") {
        expect(result.url).toBe("https://example.com/video.mp4");
      }
    });
  });

  describe("URL validation - protocol rejection", () => {
    it("should reject file:// URLs", () => {
      expect(() => {
        parseAndValidateVideoSource("file:///path/to/video.mp4");
      }).toThrow(InvalidVideoUrlError);
    });

    it("should reject ftp:// URLs", () => {
      expect(() => {
        parseAndValidateVideoSource("ftp://example.com/video.mp4");
      }).toThrow(InvalidVideoUrlError);
    });

    it("should reject data: URLs", () => {
      expect(() => {
        parseAndValidateVideoSource("data:video/mp4;base64,AAAA");
      }).toThrow(InvalidVideoUrlError);
    });
  });

  describe("URL validation - private address rejection", () => {
    it("should reject localhost", () => {
      expect(() => {
        parseAndValidateVideoSource("http://localhost/video.mp4");
      }).toThrow(InvalidVideoUrlError);
    });

    it("should reject 127.0.0.1", () => {
      expect(() => {
        parseAndValidateVideoSource("http://127.0.0.1/video.mp4");
      }).toThrow(InvalidVideoUrlError);
    });

    it("should reject 10.x.x.x addresses", () => {
      expect(() => {
        parseAndValidateVideoSource("http://10.0.0.1/video.mp4");
      }).toThrow(InvalidVideoUrlError);
    });

    it("should reject 192.168.x.x addresses", () => {
      expect(() => {
        parseAndValidateVideoSource("http://192.168.1.1/video.mp4");
      }).toThrow(InvalidVideoUrlError);
    });

    it("should reject 172.16-31.x.x addresses", () => {
      expect(() => {
        parseAndValidateVideoSource("http://172.16.0.1/video.mp4");
      }).toThrow(InvalidVideoUrlError);

      expect(() => {
        parseAndValidateVideoSource("http://172.31.255.255/video.mp4");
      }).toThrow(InvalidVideoUrlError);
    });

    it("should accept 172.15.x.x (not in private range)", () => {
      const result = parseAndValidateVideoSource("http://172.15.0.1/video.mp4");
      expect(result.kind).toBe("DIRECT_URL");
    });
  });

  describe("URL validation - format errors", () => {
    it("should reject empty URLs", () => {
      expect(() => {
        parseAndValidateVideoSource("");
      }).toThrow(InvalidVideoUrlError);
    });

    it("should reject invalid URL format", () => {
      expect(() => {
        parseAndValidateVideoSource("not a url");
      }).toThrow(InvalidVideoUrlError);
    });

    it("should reject URLs with only whitespace", () => {
      expect(() => {
        parseAndValidateVideoSource("   ");
      }).toThrow(InvalidVideoUrlError);
    });
  });

  describe("Error details", () => {
    it("should include URL and reason in error", () => {
      try {
        parseAndValidateVideoSource("file:///video.mp4");
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(InvalidVideoUrlError);
        if (error instanceof InvalidVideoUrlError) {
          expect(error.url).toBe("file:///video.mp4");
          expect(error.reason).toBe("unsupported_protocol");
        }
      }
    });

    it("should include reason for private address errors", () => {
      try {
        parseAndValidateVideoSource("http://localhost/video.mp4");
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(InvalidVideoUrlError);
        if (error instanceof InvalidVideoUrlError) {
          expect(error.reason).toBe("private_address");
        }
      }
    });
  });
});

