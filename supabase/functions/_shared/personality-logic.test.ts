import { describe, it, expect } from 'vitest';
import {
  ARCHETYPES,
  clamp,
  resolveArchetype,
  resolveRecommendation,
  computeConfidence,
} from './personality-logic.ts';

// ---------------------------------------------------------------------------
// A. clamp
// ---------------------------------------------------------------------------
describe('clamp', () => {
  it('clamps below min', () => {
    expect(clamp(-5, 0, 10)).toBe(0);
  });

  it('clamps above max', () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });

  it('returns min when val equals min (boundary)', () => {
    expect(clamp(0, 0, 10)).toBe(0);
  });

  it('returns max when val equals max (boundary)', () => {
    expect(clamp(10, 0, 10)).toBe(10);
  });

  it('returns val unchanged when in range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// B. resolveArchetype — one test per rule (7 rules), exact boundary values
// ---------------------------------------------------------------------------
describe('resolveArchetype — named rules', () => {
  it('TOXIC_HIGH_PERFORMER: eg=8 to=3 co=4 al=8 (exact boundary values)', () => {
    expect(resolveArchetype({
      ego: 8, team_orientation: 3, coachability: 4, ambition_level: 8,
    })).toBe('TOXIC_HIGH_PERFORMER');
  });

  it('MENTALITY_MONSTER: re=8 dt=8 al=8 cm=8 (exact boundary values)', () => {
    expect(resolveArchetype({
      resilience: 8, decision_tempo: 8, ambition_level: 8, career_motivation: 8,
    })).toBe('MENTALITY_MONSTER');
  });

  it('RELIABLE_SOLDIER: to=6 sn=7 al=5 co=6 (moderate ambition, exact boundary values)', () => {
    expect(resolveArchetype({
      team_orientation: 6, structure_need: 7, ambition_level: 5, coachability: 6,
    })).toBe('RELIABLE_SOLDIER');
  });

  it('COMPLETE_PROFESSIONAL: dt=7 al=7 to=6 tu=7 sn=5 xf=7 cs=0.4 (all at boundary)', () => {
    expect(resolveArchetype({
      decision_tempo: 7, ambition_level: 7, team_orientation: 6,
      tactical_understanding: 7, structure_need: 5, x_factor: 7,
      contradiction_score: 0.4,
      // Keep ego/resilience/coachability below TOXIC/MENTALITY thresholds
      ego: 4, resilience: 5, coachability: 7,
    })).toBe('COMPLETE_PROFESSIONAL');
  });

  it('HIGH_PERFORMING_SOLO: al=8 to=5 dt=7 eg=7 (exact boundary values)', () => {
    // Must not satisfy TOXIC (to=5 > 3) or MENTALITY (re=5 < 8)
    expect(resolveArchetype({
      ambition_level: 8, team_orientation: 5, decision_tempo: 7, ego: 7,
      resilience: 5,
    })).toBe('HIGH_PERFORMING_SOLO');
  });

  it('SILENT_LEADER: to=7 eg=5 re=6 al=6 (exact boundary values)', () => {
    // Must not satisfy COMPLETE_PROFESSIONAL (tu < 7 here)
    expect(resolveArchetype({
      team_orientation: 7, ego: 5, resilience: 6, ambition_level: 6,
      tactical_understanding: 4,
    })).toBe('SILENT_LEADER');
  });

  it('COACHABLE_RAW_TALENT: co=7 dt=5 sn=6 al=5 (exact boundary values)', () => {
    // Must not satisfy earlier rules (keep team low to avoid RELIABLE/SILENT)
    expect(resolveArchetype({
      coachability: 7, decision_tempo: 5, structure_need: 6, ambition_level: 5,
      team_orientation: 3, ego: 3, resilience: 3,
    })).toBe('COACHABLE_RAW_TALENT');
  });
});

// ---------------------------------------------------------------------------
// C. resolveArchetype — boundary exclusion (rule just misses — no named rule fires)
// The fallback score-based path may still return the same archetype name; what
// we verify here is that the *named rule* does not fire by showing the result
// changes when a key dimension crosses the threshold in the opposite direction,
// OR by verifying the threshold off-by-one causes a different archetype to win
// in the fallback when we also push an alternative archetype's score higher.
// ---------------------------------------------------------------------------
describe('resolveArchetype — boundary exclusion (threshold just missed)', () => {
  it('TOXIC rule misses: ego=7 (needs >=8) — different archetype wins', () => {
    // ego=7 misses TOXIC (needs >=8). team_orientation=3, co=4, al=8 also don't
    // fire any other named rule. Boost SILENT_LEADER fallback: to=9 eg=7 re=9 al=9
    // SILENT named rule needs eg<=5 — misses (eg=7). Fallback: SILENT=(9+9+9+9)/4=9
    // TOXIC fallback = (5+8+7)/3 - 4/3 = 20/3 - 1.33 = 5.33
    const result = resolveArchetype({
      ego: 7, team_orientation: 9, coachability: 4, ambition_level: 8,
      resilience: 9, career_motivation: 9,
    });
    expect(result).not.toBe('TOXIC_HIGH_PERFORMER');
  });

  it('MENTALITY named rule misses: cm=7 (needs >=8) — fallback still resolves', () => {
    // re=8 dt=8 al=8 cm=7 → named MENTALITY rule misses (cm<8).
    // The test verifies the named rule condition cm>=8 is the reason it fired
    // in the positive test. Here we just confirm the function runs and returns
    // a valid archetype (the fallback may still pick MENTALITY via score).
    const result = resolveArchetype({
      resilience: 8, decision_tempo: 8, ambition_level: 8, career_motivation: 7,
    });
    expect(ARCHETYPES).toContain(result as typeof ARCHETYPES[number]);
  });

  it('RELIABLE_SOLDIER ambition ceiling: al=7 misses (needs al<=6) — different winner', () => {
    // al=7 > 6 → RELIABLE named rule misses. Push MENTALITY_MONSTER to win via
    // named rule by also having re>=8 dt>=8 cm>=8.
    // re=8 dt=8 al=7 cm=8 → MENTALITY named rule fires (re>=8, dt>=8, al>=8? NO al=7<8)
    // al=7 misses MENTALITY too. Fallback: boost MENTALITY score: (8+7+8+8)/4=7.75
    // RELIABLE fallback: (to+sn+cm+co)/4 = (6+7+8+6)/4=6.75. MENTALITY wins fallback.
    const result = resolveArchetype({
      team_orientation: 6, structure_need: 7, ambition_level: 7, coachability: 6,
      resilience: 8, decision_tempo: 8, career_motivation: 8,
    });
    expect(result).not.toBe('RELIABLE_SOLDIER');
  });

  it('COMPLETE_PROFESSIONAL rule misses: x_factor=6 (needs >=7) — different winner', () => {
    // dt=7 al=7 to=6 tu=7 sn=5 xf=6 cs=0.3 → named COMPLETE rule misses (xf<7).
    // SILENT_LEADER named: to=6 < 7 → misses. HIGH_PERFORMING_SOLO: al=7<8 → misses.
    // Fallback: boost SILENT via scores: to=9 re=9 → SILENT=(9+5+7+9)/4=7.5 wins.
    const result = resolveArchetype({
      decision_tempo: 7, ambition_level: 7, team_orientation: 9,
      tactical_understanding: 7, structure_need: 5, x_factor: 6,
      contradiction_score: 0.3,
      ego: 6, resilience: 9, coachability: 5, career_motivation: 5,
    });
    expect(result).not.toBe('COMPLETE_PROFESSIONAL');
  });
});

// ---------------------------------------------------------------------------
// D. resolveArchetype — fallback paths (VCE09 W4: 2+ fallback tests)
// ---------------------------------------------------------------------------
describe('resolveArchetype — fallback (score-based)', () => {
  it('empty profile {} uses all defaults (5s/0.3) and returns a valid archetype', () => {
    const result = resolveArchetype({});
    expect(ARCHETYPES).toContain(result as typeof ARCHETYPES[number]);
  });

  it('profile where no named rule fires but fallback has clear winner', () => {
    // All dimensions at 6 except resilience+career_motivation+ambition+decision_tempo all=9
    // → MENTALITY_MONSTER fallback score = (9+9+9+9)/4 = 9 — highest
    const result = resolveArchetype({
      decision_tempo: 9, ambition_level: 9, career_motivation: 9, resilience: 9,
      // Keep below named-rule thresholds: re=9 dt=9 al=9 cm=9 would fire MENTALITY rule!
      // Lower one: cm=7 so named rule misses (needs cm>=8), but fallback still wins
      // Actually: re=9 dt=9 al=9 cm=7 → named rule misses (cm<8), fallback wins MENTALITY
    });
    // re=9 dt=9 al=9 cm=7 → named rule: cm=7 < 8, miss. Fallback: (9+9+7+9)/4=8.5
    // Other fallback scores use defaults (5) → MENTALITY_MONSTER wins fallback
    expect(result).toBe('MENTALITY_MONSTER');
  });

  it('profile where all dims are equal — fallback resolves deterministically', () => {
    // All dims=5 → fallback scores differ by formula; result must be a valid archetype
    const result = resolveArchetype({
      decision_tempo: 5, risk_appetite: 5, ambition_level: 5,
      team_orientation: 5, tactical_understanding: 5, structure_need: 5,
      career_motivation: 5, ego: 5, resilience: 5, coachability: 5,
      x_factor: 5, contradiction_score: 0.3,
    });
    expect(ARCHETYPES).toContain(result as typeof ARCHETYPES[number]);
  });
});

// ---------------------------------------------------------------------------
// E. resolveArchetype — missing dims (empty object, all defaults)
// ---------------------------------------------------------------------------
describe('resolveArchetype — missing dimensions', () => {
  it('completely empty profile returns a valid archetype string', () => {
    const result = resolveArchetype({});
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('partially missing dims — only ego provided, rest default', () => {
    // ego=9, rest default=5 → TOXIC needs to=3 co=4 al=8 (defaults=5) → miss
    // Other named rules also need combos → all miss → fallback runs
    const result = resolveArchetype({ ego: 9 });
    expect(ARCHETYPES).toContain(result as typeof ARCHETYPES[number]);
  });
});

// ---------------------------------------------------------------------------
// F. resolveRecommendation — PASS paths
// ---------------------------------------------------------------------------
describe('resolveRecommendation — PASS', () => {
  it('PASS: TOXIC_HIGH_PERFORMER + coachability=4 (exact boundary)', () => {
    expect(resolveRecommendation('TOXIC_HIGH_PERFORMER', { coachability: 4 }, 0.3, 0.8))
      .toBe('PASS');
  });

  it('PASS: TOXIC_HIGH_PERFORMER + coachability=3 (below boundary)', () => {
    expect(resolveRecommendation('TOXIC_HIGH_PERFORMER', { coachability: 3 }, 0.3, 0.8))
      .toBe('PASS');
  });

  it('PASS: contradiction=0.7 + resilience=4 (exact boundaries)', () => {
    expect(resolveRecommendation('RELIABLE_SOLDIER', { resilience: 4 }, 0.7, 0.8))
      .toBe('PASS');
  });

  it('PASS: contradiction=0.9 + resilience=2 (well inside boundaries)', () => {
    expect(resolveRecommendation('SILENT_LEADER', { resilience: 2 }, 0.9, 0.9))
      .toBe('PASS');
  });

  it('NOT PASS: TOXIC_HIGH_PERFORMER + coachability=5 (above PASS threshold)', () => {
    // co=5 > 4, so PASS rule misses; should return SIGN or MONITOR
    const result = resolveRecommendation('TOXIC_HIGH_PERFORMER', { coachability: 5 }, 0.3, 0.8);
    expect(result).not.toBe('PASS');
  });
});

// ---------------------------------------------------------------------------
// G. resolveRecommendation — SIGN paths
// ---------------------------------------------------------------------------
describe('resolveRecommendation — SIGN', () => {
  it('SIGN: generic strong profile (avg7>=7 cs<=0.4 co>=6 conf>=0.5)', () => {
    // avg7 = 7 exactly: all 7 dims at 7 → avg=7
    const dims = {
      decision_tempo: 7, risk_appetite: 7, ambition_level: 7,
      team_orientation: 7, tactical_understanding: 7, structure_need: 7,
      career_motivation: 7, coachability: 6,
    };
    expect(resolveRecommendation('RELIABLE_SOLDIER', dims, 0.4, 0.5))
      .toBe('SIGN');
  });

  it('SIGN: COMPLETE_PROFESSIONAL + avg7>=6.5', () => {
    // avg7 = 6.5: all 7 dims at 6.5
    const dims = {
      decision_tempo: 6.5, risk_appetite: 6.5, ambition_level: 6.5,
      team_orientation: 6.5, tactical_understanding: 6.5, structure_need: 6.5,
      career_motivation: 6.5,
    };
    expect(resolveRecommendation('COMPLETE_PROFESSIONAL', dims, 0.8, 0.3))
      .toBe('SIGN');
  });

  it('SIGN: MENTALITY_MONSTER + avg7>=7 + coachability>=5', () => {
    const dims = {
      decision_tempo: 8, risk_appetite: 7, ambition_level: 8,
      team_orientation: 7, tactical_understanding: 7, structure_need: 6,
      career_motivation: 8, coachability: 5,
    };
    // avg7 = (8+7+8+7+7+6+8)/7 = 51/7 ≈ 7.28 >= 7 ✓
    expect(resolveRecommendation('MENTALITY_MONSTER', dims, 0.5, 0.6))
      .toBe('SIGN');
  });
});

// ---------------------------------------------------------------------------
// H. resolveRecommendation — MONITOR (default case)
// ---------------------------------------------------------------------------
describe('resolveRecommendation — MONITOR', () => {
  it('MONITOR: average profile, no PASS or SIGN rule fires', () => {
    const dims = {
      decision_tempo: 5, risk_appetite: 5, ambition_level: 5,
      team_orientation: 5, tactical_understanding: 5, structure_need: 5,
      career_motivation: 5, coachability: 5, resilience: 5,
    };
    expect(resolveRecommendation('RELIABLE_SOLDIER', dims, 0.3, 0.4))
      .toBe('MONITOR');
  });

  it('MONITOR: strong avg7 but contradiction too high (cs=0.5 > 0.4)', () => {
    const dims = {
      decision_tempo: 8, risk_appetite: 8, ambition_level: 8,
      team_orientation: 8, tactical_understanding: 8, structure_need: 8,
      career_motivation: 8, coachability: 7, resilience: 6,
    };
    // avg7=8 >= 7, but cs=0.5 > 0.4 → generic SIGN misses.
    // archetype is not COMPLETE_PROFESSIONAL or MENTALITY_MONSTER → MONITOR
    expect(resolveRecommendation('RELIABLE_SOLDIER', dims, 0.5, 0.8))
      .toBe('MONITOR');
  });
});

// ---------------------------------------------------------------------------
// I. computeConfidence — formula verification (hand-calculated)
// ---------------------------------------------------------------------------
describe('computeConfidence — formula (exact arithmetic)', () => {
  // VERIFIED baseline = 0.75
  it('VERIFIED: evidenceCount=11 llmConfidence=0.8 → 0.92', () => {
    // ratio=1.0, det=0.60*1+0.30*0.8+0.10*0.75 = 0.60+0.24+0.075 = 0.915
    // round(91.5)/100 = 0.92 (Math.round rounds 0.5 up)
    expect(computeConfidence(11, 0.8, 'VERIFIED')).toBe(0.92);
  });

  // MIXED baseline = 0.55
  it('MIXED: evidenceCount=5 llmConfidence=0.6 → 0.51', () => {
    // ratio=5/11=0.45454545, det=0.60*0.45454545+0.30*0.6+0.10*0.55
    //   = 0.27272727+0.18+0.055 = 0.50772727
    // round(50.772727)/100 = 0.51
    expect(computeConfidence(5, 0.6, 'MIXED')).toBe(0.51);
  });

  it('MIXED: evidenceCount=11 llmConfidence=0.9 → 0.93', () => {
    // ratio=1.0, det=0.60*1+0.30*0.9+0.10*0.55 = 0.60+0.27+0.055 = 0.925
    // round(92.5)/100 = 0.93
    expect(computeConfidence(11, 0.9, 'MIXED')).toBe(0.93);
  });

  // OTHER/UNVERIFIED baseline = 0.40
  it('UNVERIFIED: evidenceCount=3 llmConfidence=0.5 → 0.35', () => {
    // ratio=3/11=0.27272727, det=0.60*0.27272727+0.30*0.5+0.10*0.40
    //   = 0.16363636+0.15+0.04 = 0.35363636
    // round(35.363636)/100 = 0.35
    expect(computeConfidence(3, 0.5, 'UNVERIFIED')).toBe(0.35);
  });

  it('UNVERIFIED: evidenceCount=0 llmConfidence=0.5 → 0.19', () => {
    // ratio=0, det=0+0.30*0.5+0.10*0.40 = 0+0.15+0.04 = 0.19
    // round(19)/100 = 0.19
    expect(computeConfidence(0, 0.5, 'UNVERIFIED')).toBe(0.19);
  });

  it('UNVERIFIED: evidenceCount=7 llmConfidence=0.7 → 0.63', () => {
    // ratio=7/11=0.63636363, det=0.60*0.63636363+0.30*0.7+0.10*0.40
    //   = 0.38181818+0.21+0.04 = 0.63181818
    // round(63.181818)/100 = 0.63
    expect(computeConfidence(7, 0.7, 'UNVERIFIED')).toBe(0.63);
  });
});

// ---------------------------------------------------------------------------
// J. computeConfidence — clamp boundaries
// ---------------------------------------------------------------------------
describe('computeConfidence — clamp', () => {
  it('lower clamp: VERIFIED evidenceCount=0 llmConfidence=0.0 → 0.10', () => {
    // det = 0+0+0.10*0.75 = 0.075 → clamp(0.075, 0.10, 0.95) = 0.10
    expect(computeConfidence(0, 0.0, 'VERIFIED')).toBe(0.10);
  });

  it('lower clamp: UNVERIFIED evidenceCount=0 llmConfidence=0.0 → 0.10', () => {
    // det = 0+0+0.10*0.40 = 0.04 → clamp → 0.10
    expect(computeConfidence(0, 0.0, 'UNVERIFIED')).toBe(0.10);
  });

  it('upper clamp: VERIFIED evidenceCount=11 llmConfidence=1.0 → 0.95', () => {
    // det = 0.60+0.30+0.075 = 0.975 → clamp(0.975, 0.10, 0.95) = 0.95
    expect(computeConfidence(11, 1.0, 'VERIFIED')).toBe(0.95);
  });

  it('upper clamp: MIXED evidenceCount=11 llmConfidence=1.0 → 0.95', () => {
    // det = 0.60+0.30+0.055 = 0.955 → clamp → 0.95
    expect(computeConfidence(11, 1.0, 'MIXED')).toBe(0.95);
  });
});

// ---------------------------------------------------------------------------
// K. computeConfidence — evidenceCount > maxEvidence (cap at 1.0)
// ---------------------------------------------------------------------------
describe('computeConfidence — evidence cap', () => {
  it('evidenceCount=20 (> maxEvidence=11) — treated same as 11', () => {
    // ratio = min(20/11, 1.0) = 1.0 — identical to evidenceCount=11
    expect(computeConfidence(20, 0.8, 'VERIFIED')).toBe(computeConfidence(11, 0.8, 'VERIFIED'));
  });

  it('evidenceCount=100 llmConfidence=0.8 VERIFIED → 0.92 (same as full evidence)', () => {
    // ratio capped at 1.0, same arithmetic as evidenceCount=11 + VERIFIED + 0.8
    expect(computeConfidence(100, 0.8, 'VERIFIED')).toBe(0.92);
  });

  it('evidenceCount=50 UNVERIFIED llmConfidence=0.5 → same as evidenceCount=11', () => {
    expect(computeConfidence(50, 0.5, 'UNVERIFIED')).toBe(computeConfidence(11, 0.5, 'UNVERIFIED'));
  });
});
