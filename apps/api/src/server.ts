/**
 * Entry point. Binds to loopback by default: this prototype has no
 * authentication, so it is not meant to be reachable from a network.
 */
import { buildApp } from './app.js';

const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? 4181);

async function main(): Promise<void> {
  const app = await buildApp({ logger: true });
  await app.listen({ host, port });
  app.log.info(`TurnProof AI API listening on http://${host}:${port} (prototype, synthetic data, advisory only)`);
}

main().catch((error) => {
  console.error('Failed to start TurnProof AI API:', error);
  process.exitCode = 1;
});
