import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { config } from 'dotenv';
import path from 'path';

// Load env from DOTENV_CONFIG_PATH (used by npm scripts) or fallback to root .env
const envPath = process.env.DOTENV_CONFIG_PATH
    ? path.resolve(process.cwd(), process.env.DOTENV_CONFIG_PATH)
    : path.resolve(__dirname, '../../.env');
config({ path: envPath });
import { protectedRoute } from './routes/protected';
import { pollRoute } from './routes/poll';
import { createDemoTracksRouter } from './routes/demo-tracks';

// Load environment variables strictly
const NANO_RPC_URL = process.env.NANO_RPC_URL;
const NANO_SERVER_ADDRESS = process.env.NANO_SERVER_ADDRESS;
const NANO_TEST_SEED = process.env.NANO_TEST_SEED;

if (!NANO_RPC_URL) {
    console.error('FATAL: NANO_RPC_URL environment variable is required.');
    process.exit(1);
}

if (!NANO_SERVER_ADDRESS && !NANO_TEST_SEED) {
    console.error('FATAL: NANO_SERVER_ADDRESS or NANO_TEST_SEED environment variable is required.');
    process.exit(1);
}

const app = express();
app.use(cors({ exposedHeaders: ['PAYMENT-REQUIRED', 'PAYMENT-RESPONSE'] }));
app.use(express.json());

const server = createServer(app);

// Setup routes
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Attach our specific X402 routes
app.use('/api/protected', protectedRoute);
app.use('/api/poll-for-demo', pollRoute);

// Per-track demo checkout routes (separate pages for Track A and Track B,
// stable per-invoice deposits, proper payment shapes).
app.use('/api/demo', createDemoTracksRouter());

// Parse binding PORT from the Unified Server URL (12-factor standard)
const serverUrlCandidate = process.env.VITE_TEST_AND_DEMO_SERVER_URL || 'http://localhost:3001';
let PORT: number = 3001;
let HOST: string = 'localhost';

try {
    const parsedUrl = new URL(serverUrlCandidate);
    PORT = parsedUrl.port ? parseInt(parsedUrl.port, 10) : (parsedUrl.protocol === 'https:' ? 443 : 80);
    HOST = parsedUrl.hostname || 'localhost';
} catch (e) {
    console.warn(`WARNING: Failed to parse VITE_TEST_AND_DEMO_SERVER_URL ('${serverUrlCandidate}'). Defaulting to port 3001 on 0.0.0.0.`);
    HOST = '0.0.0.0';
}

server.listen(PORT, HOST, () => {
  console.log(`Demo X402 Facilitator Server running on ${HOST}:${PORT}`);
  console.log('Demo tracks available at /api/demo/track-a and /api/demo/track-b (per-invoice deposits + stable sessions)');
  if (NANO_TEST_SEED) {
    console.log('Using NANO_TEST_SEED for per-invoice deposit derivation');
  } else {
    console.log(`Falling back to fixed address: ${NANO_SERVER_ADDRESS}`);
  }

    // Event loop lag monitor — detect if something is blocking the event loop
    setInterval(() => {
        const start = Date.now();
        setImmediate(() => {
            const lag = Date.now() - start;
            if (lag > 50) console.warn(`[PERF] Event loop lag: ${lag}ms`);
        });
    }, 2000);
});

// Setup graceful shutdown
process.on('SIGINT', () => {
    console.log('Shutting down Gracefully...');
    server.close(() => process.exit(0));
});
process.on('SIGTERM', () => {
    console.log('Shutting down Gracefully...');
    server.close(() => process.exit(0));
});
