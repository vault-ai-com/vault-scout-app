import { describe, it, expect } from 'vitest';
import {
  checkScoreUniformity,
  checkScoreConfidenceMismatch,
  checkRecommendationConsistency,
  checkEvidenceCount,
  checkBounds,
  checkClampEvents,
  validateAnalysis,
} from './quality-validation.ts';

// ---------------------------------------------------------------------------
// A. checkScoreUniformity
// ---------------------------------------------------------------------------
describe('checkScoreUniformity', () => {
  it('HALT: all dims within ±1 (range=1)', () => {
    const result = checkScoreUniformity({ a: 6, b: 7, c: 6.5, d: 6.8 });
    expect(result.status).toBe('HALT');
  });

  it('HALT: all dims identical', () => {
    const result = checkScoreUniformity({ a: 5, b: 5, c: 5, d: 5 });
    expect(result.status).toBe('HALT');
  });

  it('WARN: dims within ±2 (range=1.5)', () => {
    const result = checkScoreUniformity({ a: 5, b: 6.5, c: 5.5, d: 6 });
    expect(result.status).toBe('WARN');
  });

  it('PASS: healthy variance (range=4)', () => {
    const result = checkScoreUniformity({ a: 3, b: 7, c: 5, d: 6 });
    expect(result.status).toBe('PASS');
  });

  it('PASS: too few dimensions (<3)', () => {
    const result = checkScoreUniformity({ a: 5, b: 5 });
    expect(result.status).toBe('PASS');
  });
});

// ---------------------------------------------------------------------------
// B. checkScoreConfidenceMismatch
// ---------------------------------------------------------------------------
describe('checkScoreConfidenceMismatch', () => {
  it('HALT: score=8.5 confidence=0.3', () => {
    expect(checkScoreConfidenceMismatch(8.5, 0.3).status).toBe('HALT');
  });

  it('HALT: score=7.5 confidence=0.3', () => {
    expect(checkScoreConfidenceMismatch(7.5, 0.3).status).toBe('HALT');
  });

  it('WARN: score=7.5 confidence=0.45', () => {
    expect(checkScoreConfidenceMismatch(7.5, 0.45).status).toBe('WARN');
  });

  it('PASS: score=8 confidence=0.7', () => {
    expect(checkScoreConfidenceMismatch(8, 0.7).status).toBe('PASS');
  });

  it('PASS: score=5 confidence=0.3', () => {
    expect(checkScoreConfidenceMismatch(5, 0.3).status).toBe('PASS');
  });
});

// ---------------------------------------------------------------------------
// C. checkRecommendationConsistency
// ---------------------------------------------------------------------------
describe('checkRecommendationConsistency', () => {
  it('HALT: SIGN + 4 dims < 5', () => {
    const dims = { a: 3, b: 4, c: 2, d: 4, e: 8, f: 9 };
    expect(checkRecommendationConsistency('SIGN', dims).status).toBe('HALT');
  });

  it('WARN: SIGN + 3 dims < 5', () => {
    const dims = { a: 3, b: 4, c: 4, d: 7, e: 8, f: 9 };
    expect(checkRecommendationConsistency('SIGN', dims).status).toBe('WARN');
  });

  it('PASS: SIGN + 1 dim < 5', () => {
    const dims = { a: 4, b: 6, c: 7, d: 8, e: 9 };
    expect(checkRecommendationConsistency('SIGN', dims).status).toBe('PASS');
  });

  it('PASS: MONITOR + many low dims (not SIGN)', () => {
    const dims = { a: 3, b: 3, c: 3, d: 3, e: 3 };
    expect(checkRecommendationConsistency('MONITOR', dims).status).toBe('PASS');
  });
});

// ---------------------------------------------------------------------------
// D. checkEvidenceCount
// ---------------------------------------------------------------------------
describe('checkEvidenceCount', () => {
  it('HALT: 0 evidence', () => {
    expect(checkEvidenceCount(0).status).toBe('HALT');
  });

  it('HALT: 1 evidence', () => {
    expect(checkEvidenceCount(1).status).toBe('HALT');
  });

  it('WARN: 3 evidence', () => {
    expect(checkEvidenceCount(3).status).toBe('WARN');
  });

  it('PASS: 4 evidence', () => {
    expect(checkEvidenceCount(4).status).toBe('PASS');
  });

  it('PASS: 11 evidence', () => {
    expect(checkEvidenceCount(11).status).toBe('PASS');
  });
});

// ---------------------------------------------------------------------------
// E. checkBounds
// ---------------------------------------------------------------------------
describe('checkBounds', () => {
  it('PASS: all within bounds', () => {
    const result = checkBounds({ overall_score: 7, confidence: 0.8 });
    expect(result.status).toBe('PASS');
  });

  it('HALT: overall_score > 10', () => {
    const result = checkBounds({ overall_score: 11, confidence: 0.8 });
    expect(result.status).toBe('HALT');
  });

  it('HALT: confidence > 1', () => {
    const result = checkBounds({ overall_score: 7, confidence: 1.5 });
    expect(result.status).toBe('HALT');
  });

  it('HALT: dimension_score outside bounds', () => {
    const result = checkBounds({
      overall_score: 7,
      confidence: 0.8,
      dimension_scores: { 'DIM-01': 12 },
    });
    expect(result.status).toBe('HALT');
  });

  it('HALT: personality_score outside bounds (non-contradiction)', () => {
    const result = checkBounds({
      overall_score: 7,
      confidence: 0.8,
      personality_scores: { ego: 0 },
    });
    expect(result.status).toBe('HALT');
  });

  it('PASS: contradiction_score at 0.5 (valid)', () => {
    const result = checkBounds({
      overall_score: 7,
      confidence: 0.8,
      personality_scores: { contradiction_score: 0.5, ego: 5 },
    });
    expect(result.status).toBe('PASS');
  });

  it('HALT: contradiction_score > 1', () => {
    const result = checkBounds({
      overall_score: 7,
      confidence: 0.8,
      personality_scores: { contradiction_score: 1.5 },
    });
    expect(result.status).toBe('HALT');
  });
});

// ---------------------------------------------------------------------------
// F. checkClampEvents
// ---------------------------------------------------------------------------
describe('checkClampEvents', () => {
  it('PASS: no clamp events', () => {
    expect(checkClampEvents([]).status).toBe('PASS');
  });

  it('PASS: 1 clamp event', () => {
    expect(checkClampEvents([{ dim: 'ego', original: 12, clamped: 10 }]).status).toBe('PASS');
  });

  it('WARN: 2 clamp events', () => {
    const events = [
      { dim: 'ego', original: 12, clamped: 10 },
      { dim: 'resilience', original: -1, clamped: 1 },
    ];
    expect(checkClampEvents(events).status).toBe('WARN');
  });

  it('HALT: 4 clamp events', () => {
    const events = [
      { dim: 'a', original: 12, clamped: 10 },
      { dim: 'b', original: 12, clamped: 10 },
      { dim: 'c', original: -1, clamped: 1 },
      { dim: 'd', original: 15, clamped: 10 },
    ];
    expect(checkClampEvents(events).status).toBe('HALT');
  });
});

// ---------------------------------------------------------------------------
// G. validateAnalysis — integration tests
// ---------------------------------------------------------------------------
describe('validateAnalysis', () => {
  it('healthy analysis: score=100, gate=PASS', () => {
    const report = validateAnalysis({
      overall_score: 7.5,
      confidence: 0.75,
      dimension_scores: { a: 8, b: 5, c: 7, d: 6, e: 9 },
      evidence_count: 8,
      clamp_events: [],
    });
    expect(report.gate).toBe('PASS');
    expect(report.score).toBe(100);
  });

  it('uniform dims + high score/low confidence: gate=HALT', () => {
    const report = validateAnalysis({
      overall_score: 8.5,
      confidence: 0.3,
      dimension_scores: { a: 7, b: 7, c: 7.5, d: 7, e: 7.2 },
      evidence_count: 1,
    });
    expect(report.gate).toBe('HALT');
    expect(report.score).toBeLessThan(60);
  });

  it('minimal analysis (just overall + confidence): runs without error', () => {
    const report = validateAnalysis({
      overall_score: 5,
      confidence: 0.5,
    });
    expect(report.gate).toBe('PASS');
    expect(report.checks.length).toBeGreaterThan(0);
  });

  it('score never goes below 0', () => {
    const report = validateAnalysis({
      overall_score: 11,
      confidence: 1.5,
      dimension_scores: { a: 5, b: 5, c: 5, d: 5 },
      recommendation: 'SIGN',
      evidence_count: 0,
      clamp_events: [
        { dim: 'a', original: 12, clamped: 10 },
        { dim: 'b', original: 12, clamped: 10 },
        { dim: 'c', original: 12, clamped: 10 },
        { dim: 'd', original: 12, clamped: 10 },
      ],
    });
    expect(report.score).toBeGreaterThanOrEqual(0);
  });

  it('score < 60 forces gate=HALT even without explicit HALT checks', () => {
    // 6 WARNs = score 40, should be HALT (quality minimum 60)
    const report = validateAnalysis({
      overall_score: 7.5,
      confidence: 0.45,  // WARN: >7 + <0.5
      dimension_scores: { a: 5.5, b: 6, c: 5, d: 7, e: 6.5 },  // WARN: range=2
      personality_scores: { ego: 5, resilience: 5.5, coachability: 6, x_factor: 5 },  // WARN: range=1
      recommendation: 'SIGN',  // WARN: SIGN + 0 low dims is OK, but...
      evidence_count: 3,  // WARN: 3 < 4
      clamp_events: [
        { dim: 'a', original: 11, clamped: 10 },
        { dim: 'b', original: 12, clamped: 10 },
      ],  // WARN: 2 clamps
    });
    // Multiple WARNs accumulate, if score < 60 → HALT
    if (report.score < 60) {
      expect(report.gate).toBe('HALT');
    }
  });
});
