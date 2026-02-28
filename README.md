# Poker — Hold'em, 5-Card Draw, 3-Card Poker & Let It Ride

A locally-run, single-page web app supporting four game types: No-Limit Texas Hold'em, No-Limit 5-Card Draw, 3-Card Poker (casino mode), and Let It Ride (casino mode).

## Features

- **Four game types** — Texas Hold'em No-Limit, 5-Card Draw No-Limit, 3-Card Poker, and Let It Ride
- **Tournament mode** (Hold'em, 5-Card Draw) — play against up to 11 AI opponents; last player with chips wins
- **Casino mode** (3-Card Poker, Let It Ride) — play against the house with 5 AI companions; cash out any time
- **1–11 AI opponents** in tournament mode; 5 AI companions in casino mode — each assigned a random skill tier (loose-passive, tight-aggressive, loose-aggressive)
- **Full tournament rules** — blinds increase on a configurable schedule, side pot support, spectator mode when you bust
- **Let It Ride** — place 3 equal bets, withdraw up to 2 as community cards are revealed; optional bonus side bet on your 3 hole cards
- **3-Card Poker** — ante/play vs dealer, Pair Plus side bet, Six Card Bonus using best 5-of-6 cards
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

**Tournament mode (Hold'em, 5-Card Draw):**

| Setting | Default | Range |
|---|---|---|
| Number of AI players | 5 | 1–11 (1–5 for 5-Card Draw) |
| Starting stack | 1,000 chips | 100–1,000,000 |
| Hands per blind level | 5 | 1–100 |
| Blind schedule | 10/20 → 200/400 | min 2 levels |

The blind schedule textarea accepts one level per line in `small/big` format. The last level repeats indefinitely.

**Casino mode (3-Card Poker, Let It Ride):**

| Setting | Default | Range |
|---|---|---|
| Starting bankroll | 1,000 chips | 100–1,000,000 |
| Minimum bet | 5 chips | 1–10,000 |
| Maximum bet | 500 chips | 1–500,000 |

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
