import { IntentCacheService } from './intent-cache.service';
import type { CopilotDecision } from '@cf/shared';

describe('IntentCacheService.isCacheable', () => {
  let service: IntentCacheService;

  beforeAll(() => {
    // lazyConnect: constructor does not open a Redis connection
    service = new IntentCacheService();
  });

  afterAll(async () => {
    await service.onModuleDestroy();
  });

  const decision = (command: CopilotDecision['command']): CopilotDecision => ({
    reply: 'ok',
    language: 'en-US',
    command,
  });

  it('never caches pure conversational replies (command null)', () => {
    expect(service.isCacheable('hello there', decision(null))).toBe(false);
  });

  it('caches id-less commands', () => {
    expect(service.isCacheable("what's pending for my review?", decision({ action: 'list_approvals' }))).toBe(true);
    expect(service.isCacheable('show my projects', decision({ action: 'list_projects' }))).toBe(true);
  });

  it('rejects commands whose ids do not appear in the phrase', () => {
    expect(
      service.isCacheable(
        'approve it',
        decision({ action: 'approve_content', approvalId: 'cmr9bskc10023ewyw36wjfit1' }),
      ),
    ).toBe(false);
  });

  it('caches commands whose ids are spoken verbatim', () => {
    expect(
      service.isCacheable(
        'show the status of clip cmr9bk4l30002ewywev38tmbx',
        decision({ action: 'clip_status', shortClipId: 'cmr9bk4l30002ewywev38tmbx' }),
      ),
    ).toBe(true);
  });

  it('ignores short non-id string params', () => {
    expect(
      service.isCacheable(
        'make my videos narrate in hindi',
        decision({ action: 'set_voice_language', projectId: 'cmqzan84m0001ewrgogmblyfo', language: 'hi', applyToVoiceover: true }),
      ),
    ).toBe(false); // projectId is an id not in the phrase → not cacheable
  });
});
