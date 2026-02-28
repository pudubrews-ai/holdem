'use strict';

function isThreeCardStraight(cards) {
  // Handles all 3-card straights: A-K-Q down to A-2-3 (ace-low)
  // rankOrder index: 0=A, 1=K, 2=Q, 3=J, 4=T, 5=9, 6=8, 7=7, 8=6, 9=5, 10=4, 11=3, 12=2
  const rankOrder = 'AKQJT98765432';
  const indices = cards.map(c => rankOrder.indexOf(c[0]));
  const sorted = [...indices].sort((a, b) => a - b);
  // Standard consecutive: e.g. [0,1,2] (A-K-Q) or [10,11,12] (4-3-2)
  if (sorted[2] - sorted[0] === 2 && sorted[1] - sorted[0] === 1) return true;
  // Ace-low straight: A-2-3 → indices [0, 11, 12]
  if (sorted[0] === 0 && sorted[1] === 11 && sorted[2] === 12) return true;
  return false;
}

function getThreeCardHandName(cards) {
  // Returns: 'straight flush' | 'three of a kind' | 'straight' | 'flush' | 'pair' | 'high card'
  const rankOrder = 'AKQJT98765432';
  const suits = cards.map(c => c[1]);
  const isFlush = suits.every(s => s === suits[0]);
  const isStraight = isThreeCardStraight(cards);
  const ranks = cards.map(c => rankOrder.indexOf(c[0]));
  const rankCounts = {};
  ranks.forEach(r => rankCounts[r] = (rankCounts[r] || 0) + 1);
  const counts = Object.values(rankCounts).sort((a, b) => b - a);
  const isTrips = counts[0] === 3;
  const isPair = counts[0] === 2;

  if (isStraight && isFlush) return 'straight flush';
  if (isTrips) return 'three of a kind';
  if (isStraight) return 'straight';
  if (isFlush) return 'flush';
  if (isPair) return 'pair';
  return 'high card';
}

module.exports = { isThreeCardStraight, getThreeCardHandName };
