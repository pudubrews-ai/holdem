'use strict';

const AI_NAMES = [
  'Alex', 'Blake', 'Casey', 'Drew', 'Emery',
  'Finley', 'Gray', 'Harley', 'Indigo', 'Jordan', 'Kendall'
];

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
const SUITS = ['s', 'h', 'd', 'c'];

const AI_THRESHOLDS = {
  'loose-passive':    { fold: 0.20, call: 0.65, raise: 0.65 },
  'tight-aggressive': { fold: 0.35, call: 0.55, raise: 0.55 },
  'loose-aggressive': { fold: 0.15, call: 0.45, raise: 0.45 }
};

const RAISE_MULTIPLIERS = {
  'loose-passive': 0.5,
  'tight-aggressive': 1.0,
  'loose-aggressive': 1.5
};

module.exports = { RANKS, SUITS, AI_NAMES, AI_THRESHOLDS, RAISE_MULTIPLIERS };
