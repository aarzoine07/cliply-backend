import { execSync } from "child_process";
import { describe, it, expect } from "vitest";
import { existsSync } from "fs";
import { join } from "path";

describe("ffmpeg verification", () => {
  it("should execute ffmpeg and print version", () => {
    const output = execSync("ffmpeg -version").toString();
    console.log(output);
    expect(output).toMatch(/ffmpeg version/);
  });

  it("should process a short sample clip successfully", () => {
    const samplePath = join(process.cwd(), "../../test-assets/sample.mp4");
    const outputPath = join(process.cwd(), "../../test-assets/out.mp4");

    // Ensure input file exists
    expect(existsSync(samplePath)).toBe(true);

    // Process clip: scale to 320x240, duration 1 second
    execSync(`ffmpeg -y -t 1 -i "${samplePath}" -vf scale=320:240 "${outputPath}"`);

    // Verify output file was created
    expect(existsSync(outputPath)).toBe(true);
    
    // Clean up
    execSync(`rm -f "${outputPath}"`);
  });
});

