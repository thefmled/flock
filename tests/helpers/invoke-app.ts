import { EventEmitter } from 'node:events';
import { createRequest, createResponse } from 'node-mocks-http';

export async function invokeApp(app: any, options: {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  rawBody?: Buffer | string;
}) {
  const headers = { ...options.headers };
  const requestBody = options.rawBody ?? options.body;

  if (options.rawBody && !headers['content-type']) {
    headers['content-type'] = 'application/json';
  }

  const req = createRequest({
    method: options.method,
    url: options.url,
    headers,
    body: requestBody,
  });

  if (options.rawBody) {
    req.body = Buffer.isBuffer(options.rawBody)
      ? options.rawBody
      : Buffer.from(options.rawBody, 'utf8');
    req._body = true;
  }

  const res = createResponse({ eventEmitter: EventEmitter });

  await new Promise<void>((resolve, reject) => {
    res.on('end', resolve);
    res.on('finish', resolve);
    app.handle(req, res, (error: unknown) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  let body = res._getData();
  if (typeof body === 'string' && body) {
    try {
      body = JSON.parse(body);
    } catch {
      // keep raw string
    }
  }

  return {
    status: res.statusCode,
    body,
    headers: res._getHeaders(),
  };
}
