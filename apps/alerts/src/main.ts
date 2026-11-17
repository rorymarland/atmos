/**
 * The Atmos alerts service: a small API for the website's alerts page, and a scheduler that
 * checks the forecast and emails people. Runs beside the website container; nginx there
 * passes /api/ through to it, so browsers only ever talk to Atmos itself.
 *
 * Settings come from the environment (see .env.example):
 *   SMTP2GO_API_KEY, ALERTS_FROM          email through SMTP2GO's HTTP API (simplest), or
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, ALERTS_FROM   any SMTP service
 *   ATMOS_URL        the address people use, for links in emails
 *   ATMOS_DATA_URL   where the website container serves its data (default http://atmos/data)
 *   ALERTS_DATA_DIR  where alerts.json lives (default /data)
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import nodemailer from 'nodemailer';
import { z } from 'zod';
import { alertInput } from './model';
import { Runner } from './runner';
import { Store } from './store';
import { PlaceStore, placeInput } from './places';

const env = process.env;
const PORT = Number(env.PORT ?? 8080);
const SITE_URL = (env.ATMOS_URL ?? 'http://localhost:8085').replace(/\/+$/, '');
const DATA_URL = (env.ATMOS_DATA_URL ?? 'http://atmos/data').replace(/\/+$/, '');
const STORE = join(env.ALERTS_DATA_DIR ?? '/data', 'alerts.json');

const apiKey = env.SMTP2GO_API_KEY?.trim();
const apiUrl = (env.SMTP2GO_API_URL ?? 'https://api.smtp2go.com/v3').replace(/\/+$/, '');
const smtpReady = Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS && env.ALERTS_FROM);
const emailReady = Boolean(env.ALERTS_FROM && (apiKey || smtpReady));
const emailVia = apiKey ? 'the SMTP2GO API' : smtpReady ? `SMTP (${env.SMTP_HOST})` : 'nothing';
const smtpPort = Number(env.SMTP_PORT ?? 587);
const transport =
  smtpReady && !apiKey
    ? nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: smtpPort,
        secure: smtpPort === 465,
        auth: { user: env.SMTP_USER!, pass: env.SMTP_PASS! },
      })
    : null;

const log = (msg: string) => console.log(`${new Date().toISOString()} ${msg}`);
const store = new Store(STORE);
const placeStore = new PlaceStore(join(env.ALERTS_DATA_DIR ?? '/data', 'places.json'));
const runner = new Runner({
  store,
  dataUrl: DATA_URL,
  siteUrl: SITE_URL,
  log,
  places: () => placeStore.list(),
  send: async (email) => {
    if (!env.ALERTS_FROM) throw new Error('Email isn’t set up: set ALERTS_FROM in .env');
    if (apiKey) return sendViaSmtp2go(email);
    if (!transport)
      throw new Error('Email isn’t set up: set SMTP2GO_API_KEY (or the SMTP settings) in .env');
    await transport.sendMail({ from: env.ALERTS_FROM, ...email });
  },
});

/** SMTP2GO's HTTP API: one POST with the key in a header, no SMTP login to get wrong. */
async function sendViaSmtp2go(email: { to: string; subject: string; text: string; html: string }) {
  const res = await fetch(`${apiUrl}/email/send`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      'X-Smtp2go-Api-Key': apiKey!,
    },
    body: JSON.stringify({
      sender: env.ALERTS_FROM,
      to: [email.to],
      subject: email.subject,
      text_body: email.text,
      html_body: email.html,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    data?: {
      succeeded?: number;
      failed?: number;
      failures?: string[];
      error?: string;
      error_code?: string;
    };
  };
  const d = body.data ?? {};
  if (!res.ok || d.error || (d.failed ?? 0) > 0 || d.succeeded === 0) {
    const why = d.error ?? d.failures?.join('; ') ?? `HTTP ${res.status}`;
    throw new Error(`SMTP2GO refused it: ${why}${d.error_code ? ` (${d.error_code})` : ''}`);
  }
}

// The scheduler: daily alerts each minute; "as soon as" alerts at five past every hour,
// when the hourly model runs have reached Open-Meteo.
let lastHour = -1;
setInterval(() => {
  const now = new Date();
  const hourly = now.getMinutes() >= 5 && now.getHours() !== lastHour;
  if (hourly) lastHour = now.getHours();
  runner.tick(hourly ? 'hourly' : 'minute').catch(() => undefined);
}, 60_000);

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 64_000) throw new Error('Too large');
    chunks.push(c as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

/** What the browser sees of an alert: everything but the bookkeeping. */
const view = (a: ReturnType<Store['list']>[number]) => ({ ...a, notified: undefined });

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const path = url.pathname.replace(/\/+$/, '');
  const pm = path.match(/^\/api\/places(?:\/([0-9a-f-]{36}))?$/);
  if (pm) {
    const id = pm[1];
    try {
      if (!id && req.method === 'GET') return send(res, 200, { places: placeStore.list() });
      if (!id && req.method === 'POST')
        return send(res, 201, placeStore.create(placeInput.parse(await readJson(req))));
      if (id && req.method === 'PUT') {
        const p = placeStore.update(id, placeInput.parse(await readJson(req)));
        return p ? send(res, 200, p) : send(res, 404, { error: 'No such place' });
      }
      if (id && req.method === 'DELETE') {
        return placeStore.remove(id)
          ? send(res, 204, {})
          : send(res, 404, { error: 'No such place' });
      }
      return send(res, 405, { error: 'Not allowed' });
    } catch (e) {
      if (e instanceof z.ZodError) {
        return send(res, 400, {
          error: 'That place isn’t complete',
          issues: e.issues.map((i) => i.message),
        });
      }
      if (e instanceof SyntaxError) return send(res, 400, { error: 'Not valid JSON' });
      return send(res, 500, { error: (e as Error).message });
    }
  }
  const m = path.match(/^\/api\/alerts(?:\/([0-9a-f-]{36}))?(?:\/(test))?$/);
  try {
    if (path === '/api/alerts/status' && req.method === 'GET') {
      return send(res, 200, {
        ok: true,
        email: emailReady,
        via: emailVia,
        from: env.ALERTS_FROM ?? null,
        lastRun: runner.lastRun,
        count: store.list().length,
      });
    }
    if (!m) return send(res, 404, { error: 'Not found' });
    const [, id, action] = m;
    if (!id && req.method === 'GET') return send(res, 200, { alerts: store.list().map(view) });
    if (!id && req.method === 'POST') {
      const input = alertInput.parse(await readJson(req));
      return send(res, 201, view(store.create(input)));
    }
    if (id && !action && req.method === 'PUT') {
      const input = alertInput.parse(await readJson(req));
      const a = store.update(id, input);
      return a ? send(res, 200, view(a)) : send(res, 404, { error: 'No such alert' });
    }
    if (id && !action && req.method === 'DELETE') {
      return store.remove(id) ? send(res, 204, {}) : send(res, 404, { error: 'No such alert' });
    }
    if (id && action === 'test' && req.method === 'POST') {
      const a = store.get(id);
      if (!a) return send(res, 404, { error: 'No such alert' });
      if (!emailReady)
        return send(res, 400, {
          error: 'Email isn’t set up yet: set SMTP2GO_API_KEY and ALERTS_FROM in .env.',
        });
      const r = await runner.run([a], Date.now(), true);
      return send(res, 200, r);
    }
    return send(res, 405, { error: 'Not allowed' });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return send(res, 400, {
        error: 'That alert isn’t complete',
        issues: e.issues.map((i) => i.message),
      });
    }
    if (e instanceof SyntaxError) return send(res, 400, { error: 'Not valid JSON' });
    return send(res, 500, { error: (e as Error).message });
  }
});

server.listen(PORT, () => {
  log(
    `Atmos alerts on :${PORT}; data from ${DATA_URL}; links to ${SITE_URL}; ${store.list().length} alerts, ${placeStore.list().length} places`,
  );
  log(
    emailReady
      ? `Email via ${emailVia}, from ${env.ALERTS_FROM}`
      : 'Email isn’t set up: set SMTP2GO_API_KEY and ALERTS_FROM in .env.',
  );
});
