'use strict';

const express = require('express');
const path    = require('path');
const fs      = require('fs');

const app = express();

// ─── Security configuration ──────────────────────────────────────────────────

// Disable X-Powered-By header
app.disable('x-powered-by');

// Request body size limit — 10kb on all POST routes
app.use(express.json({ limit: '10kb' }));

// Security headers on ALL responses
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Serve static files from public/
app.use(express.static(path.join(__dirname, 'public')));

// ─── Shared state container ───────────────────────────────────────────────────

const stateContainer = { game: null };

// ─── Game module factory calls (no try/catch — crash on failure) ─────────────

const holdemRouter    = require('./games/holdem')(stateContainer);
const threecardRouter = require('./games/threecard')(stateContainer);
const letitRideRouter = require('./games/letitride')(stateContainer);

// ─── Routes ───────────────────────────────────────────────────────────────────

// GET /api/health — registered first, before any router mounts
app.get('/api/health', (req, res) => {
  return res.status(200).json({ status: 'ok' });
});

// POST /api/game — Start a new game (dispatcher)
app.post('/api/game', (req, res) => {
  const { tournamentType } = req.body;

  // tournamentType whitelist check
  if (!['holdem', 'fivecard', 'threecard', 'letitride'].includes(tournamentType)) {
    return res.status(400).json({ error: "tournamentType must be 'holdem', 'fivecard', 'threecard', or 'letitride'." });
  }

  if (tournamentType === 'threecard') {
    require('./games/threecard').initGame(stateContainer, req.body, res);
  } else if (tournamentType === 'letitride') {
    require('./games/letitride').initGame(stateContainer, req.body, res);
  } else {
    require('./games/holdem').initGame(stateContainer, req.body, res);
  }

  // Note: Cannot assert stateContainer.game.tournamentType here because initGame always
  // sends the response before returning (res.headersSent is always true at this point).
  // Cross-wiring detection is provided by the test suite (Groups 21 and 37 verify
  // tournamentType in the response body).
});

// GET /api/game — Get current game state (dispatcher)
app.get('/api/game', (req, res) => {
  if (!stateContainer.game) {
    return res.status(404).json({ error: 'No game in progress.' });
  }
  const type = stateContainer.game.tournamentType;
  if (type === 'threecard') {
    require('./games/threecard').getGameState(stateContainer, res);
  } else if (type === 'letitride') {
    require('./games/letitride').getGameState(stateContainer, res);
  } else {
    require('./games/holdem').getGameState(stateContainer, res);
  }
});

app.use('/', holdemRouter);
app.use('/', threecardRouter);
app.use('/', letitRideRouter);

// ─── Global error handler (CISO-V3-06) ────────────────────────────────────────
// Suppresses stack traces from reaching HTTP responses
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'An internal error occurred.' });
});

// ─── Port selection and startup ────────────────────────────────────────────────

async function findPort() {
  const envPort = process.env.PORT ? parseInt(process.env.PORT, 10) : null;
  if (envPort) return envPort;

  const net = require('net');
  for (let port = 3001; port <= 3999; port++) {
    const available = await new Promise((resolve) => {
      const server = net.createServer();
      server.once('error', () => resolve(false));
      server.once('listening', () => { server.close(); resolve(true); });
      server.listen(port);
    });
    if (available) return port;
  }
  throw new Error('No available port found between 3001 and 3999');
}

findPort().then((port) => {
  app.listen(port, () => {
    console.log(`Poker server running on port ${port}`);
    fs.writeFileSync(
      path.join(__dirname, 'reports', 'v5', 'server-port.md'),
      `PORT=${port}\nPID=${process.pid}\n`
    );
  });
});
