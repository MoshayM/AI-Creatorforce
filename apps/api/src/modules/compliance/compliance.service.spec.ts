import { BadRequestException } from '@nestjs/common';
import { ComplianceService } from './compliance.service';
import * as shared from '@cf/shared';
import type { ComplianceResult } from '@cf/shared';

// Mock the entire @cf/shared module; keep real schema helpers
jest.mock('@cf/shared', () => {
  const actual = jest.requireActual<typeof shared>('@cf/shared');
  return { ...actual, callAIStructured: jest.fn() };
});

const mockCallAI = shared.callAIStructured as jest.MockedFunction<typeof shared.callAIStructured>;

const CONTENT = {
  title: 'How to Build a REST API',
  script: 'Today we will learn about building REST APIs using Node.js and Express.',
  description: 'A beginner-friendly tutorial on REST API development.',
  tags: ['nodejs', 'api', 'tutorial'],
};

function makeResult(overrides: Partial<ComplianceResult> = {}): ComplianceResult {
  return {
    passed: true,
    score: 85,
    flags: [],
    reviewerAI: 'claude-sonnet-4-6',
    summary: 'Content is compliant and advertiser-friendly.',
    ...overrides,
  };
}

describe('ComplianceService', () => {
  let service: ComplianceService;

  beforeEach(() => {
    service = new ComplianceService();
    jest.clearAllMocks();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // check() — returns raw AI result without throwing
  // ──────────────────────────────────────────────────────────────────────────
  describe('check()', () => {
    it('returns the AI result when content is compliant', async () => {
      const result = makeResult();
      mockCallAI.mockResolvedValue(result);

      const output = await service.check(CONTENT);

      expect(output.passed).toBe(true);
      expect(output.score).toBe(85);
      expect(output.flags).toHaveLength(0);
    });

    it('returns failed result without throwing (check does not enforce)', async () => {
      const result = makeResult({ passed: false, score: 45 });
      mockCallAI.mockResolvedValue(result);

      await expect(service.check(CONTENT)).resolves.toMatchObject({ passed: false, score: 45 });
    });

    it('returns result with BLOCK flags without throwing (check does not enforce)', async () => {
      const result = makeResult({
        flags: [{ category: 'HATE_SPEECH', severity: 'BLOCK', description: 'Slurs detected' }],
      });
      mockCallAI.mockResolvedValue(result);

      const output = await service.check(CONTENT);
      expect(output.flags[0]?.severity).toBe('BLOCK');
    });

    it('propagates AI client errors', async () => {
      mockCallAI.mockRejectedValue(new Error('ANTHROPIC_API_KEY not set'));

      await expect(service.check(CONTENT)).rejects.toThrow('ANTHROPIC_API_KEY not set');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // enforce() — hard gate: throws on any failure path
  // Per claude.md: "Compliance is a hard gate, not a suggestion."
  // ──────────────────────────────────────────────────────────────────────────
  describe('enforce() — compliance is a hard gate', () => {
    it('returns result when content passes all checks', async () => {
      mockCallAI.mockResolvedValue(makeResult({ passed: true, score: 90 }));

      const result = await service.enforce(CONTENT);

      expect(result.passed).toBe(true);
      expect(result.score).toBeGreaterThanOrEqual(70);
    });

    it('throws BadRequestException when passed=false', async () => {
      mockCallAI.mockResolvedValue(makeResult({ passed: false, score: 60 }));

      await expect(service.enforce(CONTENT)).rejects.toThrow(BadRequestException);
    });

    it('throws when passed=false even if score would imply pass', async () => {
      // Defensive: AI might return passed=false with score=90 (e.g. schema mismatch); gate must catch it
      mockCallAI.mockResolvedValue(makeResult({ passed: false, score: 95 }));

      await expect(service.enforce(CONTENT)).rejects.toThrow(BadRequestException);
    });

    it('throws when score is below 70 threshold', async () => {
      mockCallAI.mockResolvedValue(makeResult({ passed: false, score: 69 }));

      await expect(service.enforce(CONTENT)).rejects.toThrow(BadRequestException);
    });

    it('throws when a BLOCK flag is present — even if passed=true and score>=70', async () => {
      // This is the primary bypass-prevention test.
      // A manipulated AI response could set passed=true with a high score but include BLOCK flags.
      mockCallAI.mockResolvedValue(makeResult({
        passed: true,
        score: 80,
        flags: [{ category: 'HATE_SPEECH', severity: 'BLOCK', description: 'Slurs' }],
      }));

      await expect(service.enforce(CONTENT)).rejects.toThrow(BadRequestException);
    });

    it('BLOCK flag cannot be bypassed by a perfect score of 100', async () => {
      mockCallAI.mockResolvedValue(makeResult({
        passed: true,
        score: 100,
        flags: [{ category: 'ADULT_CONTENT', severity: 'BLOCK', description: 'Explicit content' }],
      }));

      await expect(service.enforce(CONTENT)).rejects.toThrow(BadRequestException);
    });

    it('throws when multiple BLOCK flags are present', async () => {
      mockCallAI.mockResolvedValue(makeResult({
        passed: false,
        score: 20,
        flags: [
          { category: 'HATE_SPEECH', severity: 'BLOCK', description: 'Slurs' },
          { category: 'VIOLENCE', severity: 'BLOCK', description: 'Graphic violence' },
          { category: 'MISINFORMATION', severity: 'WARNING', description: 'Unverified claim' },
        ],
      }));

      await expect(service.enforce(CONTENT)).rejects.toThrow(BadRequestException);
    });

    it('does not throw for WARNING or CRITICAL flags on compliant content', async () => {
      // WARNING/CRITICAL flags are informational — they do not hard-block
      mockCallAI.mockResolvedValue(makeResult({
        passed: true,
        score: 72,
        flags: [
          { category: 'ADVERTISER_FRIENDLY', severity: 'WARNING', description: 'Mild language' },
          { category: 'PRIVACY', severity: 'CRITICAL', description: 'Mentions a public figure' },
        ],
      }));

      await expect(service.enforce(CONTENT)).resolves.toMatchObject({ passed: true });
    });

    it('does not throw for INFO flags on compliant content', async () => {
      mockCallAI.mockResolvedValue(makeResult({
        passed: true,
        score: 88,
        flags: [
          { category: 'COPYRIGHT', severity: 'INFO', description: 'Background music reference noted' },
        ],
      }));

      await expect(service.enforce(CONTENT)).resolves.toMatchObject({ passed: true });
    });

    it('propagates AI call failures — no silent bypass path', async () => {
      mockCallAI.mockRejectedValue(new Error('Network timeout'));

      // Must throw; must NOT silently pass content when AI is unreachable
      await expect(service.enforce(CONTENT)).rejects.toThrow('Network timeout');
    });

    it('error message includes score and blocked categories', async () => {
      expect.assertions(3);
      mockCallAI.mockResolvedValue(makeResult({
        passed: false,
        score: 30,
        flags: [
          { category: 'HATE_SPEECH', severity: 'BLOCK', description: 'Slurs' },
          { category: 'VIOLENCE', severity: 'BLOCK', description: 'Graphic' },
        ],
      }));

      try {
        await service.enforce(CONTENT);
      } catch (err) {
        expect(err).toBeInstanceOf(BadRequestException);
        const message = (err as BadRequestException).message;
        expect(message).toContain('30');
        expect(message).toContain('HATE_SPEECH');
      }
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // mustPassCompliance() — pure gate function from @cf/shared
  // ──────────────────────────────────────────────────────────────────────────
  describe('mustPassCompliance() (shared gate function)', () => {
    const { mustPassCompliance, isComplianceBlocked } = jest.requireActual<typeof shared>('@cf/shared');

    it('does not throw on a passing result', () => {
      expect(() => mustPassCompliance(makeResult())).not.toThrow();
    });

    it('throws when passed=false', () => {
      expect(() => mustPassCompliance(makeResult({ passed: false, score: 50 }))).toThrow();
    });

    it('throws when a BLOCK flag is present even if passed=true', () => {
      expect(() =>
        mustPassCompliance(makeResult({
          passed: true,
          score: 80,
          flags: [{ category: 'HATE_SPEECH', severity: 'BLOCK', description: 'X' }],
        })),
      ).toThrow();
    });

    it('isComplianceBlocked returns false when no BLOCK flags', () => {
      expect(isComplianceBlocked(makeResult())).toBe(false);
    });

    it('isComplianceBlocked returns true when any BLOCK flag present', () => {
      expect(
        isComplianceBlocked(makeResult({
          flags: [{ category: 'VIOLENCE', severity: 'BLOCK', description: 'X' }],
        })),
      ).toBe(true);
    });

    it('isComplianceBlocked returns false for WARNING/CRITICAL/INFO flags', () => {
      expect(
        isComplianceBlocked(makeResult({
          flags: [
            { category: 'ADVERTISER_FRIENDLY', severity: 'WARNING', description: 'X' },
            { category: 'PRIVACY', severity: 'CRITICAL', description: 'X' },
            { category: 'COPYRIGHT', severity: 'INFO', description: 'X' },
          ],
        })),
      ).toBe(false);
    });
  });
});
