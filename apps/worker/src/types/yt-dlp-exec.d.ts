declare module "yt-dlp-exec" {
  interface YtDlpExecOptions {
    output?: string;
    format?: string;
    mergeOutputFormat?: string;
    noPlaylist?: boolean;
    noCheckCertificate?: boolean;
    preferFreeFormats?: boolean;
    [key: string]: unknown;
  }

  interface YtDlpResult {
    _filename?: string;
    [key: string]: unknown;
  }

  type YtDlpExec = (url: string, options?: YtDlpExecOptions) => Promise<YtDlpResult>;

  const ytDlp: YtDlpExec;
  export default ytDlp;
}

