/**
 * Fastify application factory.
 *
 * The server binds to loopback only. That is deliberate: this prototype has no
 * authentication, so it must not be reachable from a network. Hosting it
 * publicly would first require authentication, access control and a retention
 * review.
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  DecisionRequestSchema,
  EventRequestSchema,
  ProviderModeSchema,
  ReviewRequestSchema,
  SCHEMA_VERSION,
  SOLVER_VERSION,
  type ProviderMode,
} from '@turnproof/domain';
import { listAdapters } from '@turnproof/adapters';
import { loadPolicy } from '../../../fixtures/loader.js';
import { ApiError, badRequest, notFound } from './errors.js';
import { closeDatabase, openDatabase } from './storage/db.js';
import { appendEvent, buildSnapshotView, listScenarios } from './services/scenarios.js';
import { exportPacketFor, getDecisionRecord, recordDecision } from './services/decisions.js';
import { recordReview } from './services/reviews.js';
import { seedScenariosFromFixtures } from './services/seed.js';

export type BuildAppOptions = {
  dbPath?: string;
  /** Seeding is on by default; tests that need an empty database pass `false`. */
  seed?: boolean;
  logger?: boolean;
};

function resolveBodyLimit(): number {
  try {
    return loadPolicy('policy-default').maxRequestBytes;
  } catch {
    return 65536;
  }
}

function parseBody<S extends z.ZodTypeAny>(schema: S, value: unknown): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
      .join('; ');
    throw badRequest('Request body failed validation.', detail);
  }
  return result.data;
}

function parseProviderMode(value: unknown): ProviderMode {
  if (value === undefined || value === null || value === '') return 'deterministic';
  const parsed = ProviderModeSchema.safeParse(value);
  if (!parsed.success) {
    throw badRequest(
      `Unsupported providerMode "${String(value)}".`,
      'Supported modes are deterministic, replay and live.',
    );
  }
  return parsed.data;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const db = openDatabase(options.dbPath);
  if (options.seed !== false) seedScenariosFromFixtures(db);

  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: resolveBodyLimit(),
  });

  app.addHook('onClose', async () => {
    closeDatabase();
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) {
      reply.code(error.statusCode).send({
        error: { code: error.code, message: error.message, detail: error.detail },
      });
      return;
    }
    const statusCode = (error as { statusCode?: number }).statusCode ?? 500;
    if (statusCode === 413) {
      reply.code(413).send({
        error: {
          code: 'payload_too_large',
          message: 'Request body exceeds the configured limit.',
        },
      });
      return;
    }
    if (statusCode === 400) {
      reply.code(400).send({
        error: { code: 'validation_error', message: 'Request could not be processed.' },
      });
      return;
    }
    // Never leak a stack trace or internal detail to the client.
    request.log.error({ err: error }, 'unhandled API error');
    reply.code(500).send({
      error: { code: 'internal_error', message: 'Unexpected server error.' },
    });
  });

  app.get('/api/health', async () => ({
    status: 'ok',
    service: 'turnproof-api',
    schemaVersion: SCHEMA_VERSION,
    solverVersion: SOLVER_VERSION,
    adapters: listAdapters(),
  }));

  app.get('/api/adapters', async () => ({ adapters: listAdapters() }));

  app.get('/api/scenarios', async () => ({ scenarios: listScenarios(db) }));

  app.get('/api/scenarios/:id/snapshot', async (request) => {
    const { id } = request.params as { id: string };
    const query = request.query as { providerMode?: string };
    const providerMode = parseProviderMode(query.providerMode);
    const view = buildSnapshotView({ db, scenarioId: id, providerMode });
    return { ...view, adapters: listAdapters() };
  });

  app.post('/api/scenarios/:id/events', async (request) => {
    const { id } = request.params as { id: string };
    const body = parseBody(EventRequestSchema, request.body);
    const appended = appendEvent({ db, scenarioId: id, body });
    const view = buildSnapshotView({ db, scenarioId: id });
    return {
      scenario: appended.scenario,
      revision: appended.revision,
      snapshot: view.snapshot,
      decision: view.decision,
    };
  });

  app.post('/api/decisions', async (request) => {
    const body = parseBody(DecisionRequestSchema, request.body);
    const header = request.headers['x-idempotency-key'];
    const idempotencyKey = Array.isArray(header) ? header[0] : (header ?? null);
    const result = recordDecision({ db, body, idempotencyKey });
    return {
      decision: result.decision,
      packet: result.packet,
      replayOfDecisionId: result.replayOfDecisionId,
      idempotentReplay: result.idempotentReplay,
    };
  });

  app.get('/api/decisions/:id', async (request) => {
    const { id } = request.params as { id: string };
    return getDecisionRecord(db, id);
  });

  app.post('/api/decisions/:id/reviews', async (request) => {
    const { id } = request.params as { id: string };
    const body = parseBody(ReviewRequestSchema, request.body);
    return recordReview({ db, decisionId: id, body });
  });

  app.get('/api/decisions/:id/export', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { packet } = exportPacketFor(db, id);
    reply.header('Content-Disposition', `attachment; filename="turnproof-decision-${id}.json"`);
    reply.type('application/json; charset=utf-8');
    return packet;
  });

  app.setNotFoundHandler((request, reply) => {
    reply.code(404).send({
      error: { code: 'not_found', message: `No route for ${request.method} ${request.url}` },
    });
  });

  // Serve the built UI when it exists. `wildcard: false` keeps @fastify/static
  // from claiming a catch-all that would shadow the /api routes; the single
  // explicit handler below decides between a real asset and the SPA shell.
  const webDist = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'web', 'dist');
  if (existsSync(join(webDist, 'index.html'))) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false });
    app.get('/*', async (request, reply) => {
      const pathname = request.url.split('?')[0];
      if (pathname.startsWith('/api')) throw notFound(`No API route for GET ${pathname}.`);
      const relative = decodeURIComponent(pathname.replace(/^\//, ''));
      if (relative.includes('..')) throw notFound('Refusing a path that escapes the build directory.');
      if (relative && existsSync(join(webDist, relative))) return reply.sendFile(relative);
      return reply.sendFile('index.html');
    });
  }

  return app;
}

export { closeDatabase };
