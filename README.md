# Texas Hold'em Poker

A locally-run, single-page web app for No-Limit Texas Hold'em. Play against 1–11 AI opponents in a tournament format — last player with chips wins.

## Features

- **1–11 AI opponents** — each assigned a random skill tier (loose-passive, tight-aggressive, loose-aggressive) with distinct betting strategies
- **Full tournament rules** — blinds increase on a configurable schedule, play until one player holds all the chips
- **Side pot support** — correct multi-player all-in handling with separate side pot calculation
- **Spectator mode** — when you bust out, watch the AI finish the game
- **No dependencies on external servers** — runs entirely on your machine

## Requirements

- Node.js v18 or higher

## Install & Run

```bash
npm install
node server.js
```

The server prints the port it's listening on:
```
Poker server listening on port 3001
```

Open `http://localhost:3001` (or whatever port is printed) in your browser.

To use a specific port:
```bash
PORT=4000 node server.js
```

## Configuration

Before each game you can set:

| Setting | Default | Range |
|---|---|---|
| Number of AI players | 5 | 1–11 |
| Starting stack | 1,000 chips | 100–1,000,000 |
| Hands per blind level | 5 | 1–100 |
| Blind schedule | 10/20 → 200/400 | min 2 levels |

The blind schedule textarea accepts one level per line in `small/big` format. The last level repeats indefinitely.

## How to Play

1. Configure the game and click **Start Game**
2. Your cards are shown at the bottom of the table (seat 0)
3. On your turn, the action panel appears — choose **Fold**, **Check**, **Call**, **Raise**, or **All In**
4. After each hand, click **Next Hand** to continue
5. If you bust out, spectator mode activates and the AI plays on automatically

## Stack

- **Runtime:** Node.js 18+
- **Server:** Express.js
- **Hand evaluation:** [pokersolver](https://github.com/goldfire/pokersolver)
- **Frontend:** Vanilla HTML/CSS/JS — no frameworks, no build tools
- **API:** REST (HTTP polling, no WebSockets)
