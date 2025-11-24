import express, { type Request, type Response } from 'express';
import supertest from 'supertest';

type MinimalRequest = Record<string, unknown>;
type MinimalResponse = {
  status: (code: number) => MinimalResponse;
  json: (body: unknown) => void;
  headersSent?: boolean;
};

type ApiHandler = (req: MinimalRequest, res: MinimalResponse) => Promise<void> | void;

type HttpMethod = 'get' | 'post' | 'patch' | 'put' | 'delete';

export function supertestHandler(handler: ApiHandler, method: HttpMethod = 'post', path = '/') {
  const app = express();
  app.use(express.json({ limit: '5mb' }));

  (app as express.Express)[method](path, async (req: Request, res: Response) => {
    try {
      await handler(req as unknown as MinimalRequest, res as unknown as MinimalResponse);
      if (!res.headersSent) {
        res.status(200).json({ ok: true });
      }
    } catch (error) {
      if (!res.headersSent) {
        const message = (error as Error)?.message ?? 'internal_error';
        const stack = (error as Error)?.stack;
        console.error('Test handler error:', { message, stack, error });
        res.status(500).json({ ok: false, code: 'internal_error', message, stack });
      }
    }
  });

  return supertest(app);
}
