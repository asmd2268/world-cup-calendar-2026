// Mapping of source match IDs to their target match IDs and slots
const KNOCKOUT_MAP = {
  // Round of 16 to Quarterfinals
  81: { winner: { targetId: 89, slot: 'team1' } },
  82: { winner: { targetId: 89, slot: 'team2' } },
  83: { winner: { targetId: 90, slot: 'team1' } },
  84: { winner: { targetId: 90, slot: 'team2' } },
  85: { winner: { targetId: 91, slot: 'team1' } },
  86: { winner: { targetId: 91, slot: 'team2' } },
  87: { winner: { targetId: 92, slot: 'team1' } },
  88: { winner: { targetId: 92, slot: 'team2' } },

  // Quarterfinals to Semifinals
  89: { winner: { targetId: 93, slot: 'team1' } },
  90: { winner: { targetId: 93, slot: 'team2' } },
  91: { winner: { targetId: 94, slot: 'team1' } },
  92: { winner: { targetId: 94, slot: 'team2' } },

  // Semifinals to Final and 3rd Place Match
  93: {
    winner: { targetId: 104, slot: 'team1' },
    loser: { targetId: 103, slot: 'team1' }
  },
  94: {
    winner: { targetId: 104, slot: 'team2' },
    loser: { targetId: 103, slot: 'team2' }
  }
};

/**
 * Propagates the winner (and loser if applicable) to the next stage in the bracket.
 * @param {number} matchId - The completed match ID.
 * @param {object} winnerTeam - The team object that won.
 * @param {object} loserTeam - The team object that lost.
 * @param {array} matches - The full list of matches.
 * @returns {array} Updated list of matches.
 */
export function propagateKnockout(matchId, winnerTeam, loserTeam, matches) {
  const propagation = KNOCKOUT_MAP[matchId];
  if (!propagation) {
    return matches; // Not a knockout or final match with propagation
  }

  // Handle winner propagation
  if (propagation.winner) {
    const { targetId, slot } = propagation.winner;
    const targetMatch = matches.find(m => m.id === targetId);
    if (targetMatch) {
      targetMatch[slot] = {
        name_en: winnerTeam.name_en,
        name_ar: winnerTeam.name_ar,
        code: winnerTeam.code,
        flag: winnerTeam.flag
      };
    }
  }

  // Handle loser propagation (e.g., Semifinals to 3rd Place)
  if (propagation.loser && loserTeam) {
    const { targetId, slot } = propagation.loser;
    const targetMatch = matches.find(m => m.id === targetId);
    if (targetMatch) {
      targetMatch[slot] = {
        name_en: loserTeam.name_en,
        name_ar: loserTeam.name_ar,
        code: loserTeam.code,
        flag: loserTeam.flag
      };
    }
  }

  return matches;
}
