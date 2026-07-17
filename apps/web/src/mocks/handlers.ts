import { http, HttpResponse } from 'msw';

const BASE = 'http://localhost:4007/api/v1';

// Stable mock data
const MOCK_TOKEN = 'mock-jwt-token-for-testing';

const OWNER_EMAIL = 'ethonanpasumvalki@gmail.com';
const OWNER_PASSWORD = 'password@123';

const MOCK_USER = { id: 'user-1', email: OWNER_EMAIL, name: 'Ethonan Pasumvalki', role: 'OWNER' };

type MockChannel = {
  id: string; youtubeChannelId: string; title: string; description: string;
  thumbnailUrl: null; customUrl: string; subscriberCount: number; videoCount: number;
  active: boolean; lastSyncedAt: string; createdAt: string;
};

const MOCK_CHANNELS: MockChannel[] = [];

// Names cycled through when the user adds more channels in mock mode
const EXTRA_CHANNEL_NAMES = [
  { title: 'Gaming Nexus', customUrl: '@gamingnexus', description: 'Gaming news and walkthroughs', subs: 4800, videos: 34 },
  { title: 'Cooking with AI', customUrl: '@cookingwithai', description: 'AI-powered recipe content', subs: 22100, videos: 112 },
  { title: 'Finance Unlocked', customUrl: '@financeunlocked', description: 'Personal finance deep-dives', subs: 9350, videos: 58 },
  { title: 'Travel Hacks', customUrl: '@travelhacks', description: 'Budget travel tips worldwide', subs: 31000, videos: 203 },
];

const MOCK_PROJECTS = [
  {
    id: 'proj-1',
    title: 'AI Tools Deep Dive',
    niche: 'Technology',
    status: 'ACTIVE',
    targetLang: 'en',
    channel: { title: 'TechReview Pro', thumbnailUrl: null },
    _count: { jobs: 5, videos: 2 },
    updatedAt: '2026-06-20T10:00:00.000Z',
  },
  {
    id: 'proj-2',
    title: 'Beginner Coding Series',
    niche: 'Education',
    status: 'DRAFT',
    targetLang: 'en',
    channel: { title: 'TechReview Pro', thumbnailUrl: null },
    _count: { jobs: 1, videos: 0 },
    updatedAt: '2026-06-18T10:00:00.000Z',
  },
];

const MOCK_PROJECT_DETAIL = {
  ...MOCK_PROJECTS[0],
  description: 'Comprehensive series on AI productivity tools',
  channelId: 'ch-1',
  channel: { id: 'ch-1', title: 'TechReview Pro', thumbnailUrl: null, youtubeChannelId: 'UCmock123' },
  jobs: [
    {
      id: 'job-1', type: 'TREND_ANALYSIS', status: 'COMPLETED',
      createdAt: '2026-06-20T10:00:00.000Z', completedAt: '2026-06-20T10:01:00.000Z',
      error: null,
      result: {
        trending: [
          { topic: 'AI Agents Automation 2026', score: 94, relatedKeywords: ['n8n', 'make.com', 'Claude API'], peakTime: 'weekdays' },
          { topic: 'Local LLMs vs Cloud AI', score: 87, relatedKeywords: ['Ollama', 'LM Studio', 'privacy AI'], peakTime: null },
          { topic: 'Vibe Coding with AI', score: 82, relatedKeywords: ['Cursor', 'Copilot', 'Claude Code'], peakTime: null },
        ],
        recommendations: ['Focus on beginner tutorials for AI agents', 'Comparison videos perform 2× better in tech'],
        analysisDate: '2026-06-20',
      },
    },
    {
      id: 'job-2', type: 'AUDIENCE_ANALYSIS', status: 'COMPLETED',
      createdAt: '2026-06-20T10:02:00.000Z', completedAt: '2026-06-20T10:03:00.000Z',
      error: null,
      result: {
        primaryDemographic: 'Software developers and tech enthusiasts aged 25–40',
        interests: ['AI', 'Programming', 'Productivity', 'SaaS', 'No-code'],
        bestUploadTime: 'Tue–Thu, 6–8 PM UTC',
        engagementRate: 4.2,
        topFormats: ['Tutorial', 'Comparison', 'Behind-the-scenes'],
      },
    },
    {
      id: 'job-3', type: 'RESEARCH', status: 'COMPLETED',
      createdAt: '2026-06-20T10:04:00.000Z', completedAt: '2026-06-20T10:05:30.000Z',
      error: null,
      result: {
        topic: 'AI Agents and Automation Tools in 2026',
        summary: 'AI agents have moved beyond chatbots — in 2026 they autonomously execute multi-step workflows, manage calendars, write and deploy code, and integrate with every major SaaS tool. Adoption is accelerating among SMBs, with platforms like n8n, Make, and the Claude API leading enterprise adoption.',
        keyPoints: [
          'Agent frameworks (LangChain, LlamaIndex, CrewAI) now support long-horizon planning with memory',
          'No-code agent builders (Zapier AI, n8n cloud) reduced setup time from days to under an hour',
          'Enterprises report 35–60% reduction in manual task hours after agent deployment',
          'Security and hallucination guardrails are the #1 adoption concern in regulated industries',
        ],
        sources: [
          { url: 'https://example.com/ai-agents-2026', title: 'State of AI Agents 2026', snippet: 'Comprehensive industry survey' },
        ],
        trendScore: 94,
      },
    },
    {
      id: 'job-4', type: 'SCRIPT', status: 'COMPLETED',
      createdAt: '2026-06-20T10:06:00.000Z', completedAt: '2026-06-20T10:08:00.000Z',
      error: null,
      result: {
        title: 'I Let AI Agents Run My Entire Week — Here\'s What Happened',
        hook: 'What if you didn\'t have to touch your inbox, calendar, or to-do list for an entire week? I built a system of AI agents to do it all — and the results genuinely shocked me.',
        totalWordCount: 2847,
        estimatedDuration: '18 minutes',
        sections: [
          { title: 'Why AI Agents Are Different From Chatbots', wordCount: 420 },
          { title: 'The 5 Agents I Built and Why', wordCount: 680 },
          { title: 'Day-by-Day Experiment Results', wordCount: 1100 },
          { title: 'What Went Wrong (Be Honest)', wordCount: 400 },
          { title: 'Should You Build This System?', wordCount: 247 },
        ],
        callToAction: 'Drop a 🤖 in the comments if you want me to build a full tutorial for any of these agents.',
      },
    },
    {
      id: 'job-5', type: 'FACT_CHECK', status: 'COMPLETED',
      createdAt: '2026-06-20T10:09:00.000Z', completedAt: '2026-06-20T10:10:00.000Z',
      error: null,
      result: {
        overallVerified: true,
        claims: [
          { claim: 'Enterprises report 35–60% reduction in manual task hours', verified: true, confidence: 0.82 },
          { claim: 'No-code agent builders reduce setup time to under an hour', verified: true, confidence: 0.91 },
          { claim: 'LangChain supports long-horizon planning with memory', verified: true, confidence: 0.95 },
        ],
        recommendation: 'All key claims are well-supported. Consider adding a source citation in the video description for the enterprise stat.',
      },
    },
    {
      id: 'job-6', type: 'COMPLIANCE', status: 'WAITING_APPROVAL',
      createdAt: '2026-06-20T10:11:00.000Z', completedAt: '2026-06-20T10:12:00.000Z',
      error: null,
      result: {
        passed: true,
        score: 91,
        flags: [
          { category: 'DISCLAIMER', severity: 'WARN', description: 'Add a brief disclaimer: AI agent results may vary by use case and setup.' },
        ],
        advertiserFriendly: true,
        copyrightRisk: 'LOW',
      },
    },
  ],
  videos: [],
  approvals: [{ id: 'appr-1', status: 'PENDING' }],
};

const MOCK_APPROVALS = [
  {
    id: 'appr-1',
    status: 'PENDING',
    expiresAt: '2026-06-28T10:00:00.000Z',
    project: { title: 'AI Tools Deep Dive', channel: { title: 'TechReview Pro' } },
    job: {
      type: 'METADATA',
      result: {
        metadata: { title: 'Top 5 AI Tools That Replace Your Entire Workflow', description: 'Discover the 5 AI tools...', tags: ['AI', 'productivity', 'tools'] },
        awaitingApproval: true,
      },
    },
  },
];

const NICHE_TRENDS: Record<string, { trending: { topic: string; score: number; relatedKeywords: string[]; peakTime: string | null }[]; recommendations: string[] }> = {
  tech: {
    trending: [
      { topic: 'AI Agents Automation 2026', score: 94, relatedKeywords: ['n8n', 'make.com', 'Claude API', 'zapier AI'], peakTime: 'weekdays' },
      { topic: 'Local LLMs vs Cloud AI', score: 87, relatedKeywords: ['Ollama', 'LM Studio', 'privacy AI'], peakTime: null },
      { topic: 'Vibe Coding with AI', score: 82, relatedKeywords: ['Cursor', 'Copilot', 'Claude Code'], peakTime: null },
      { topic: 'AI Video Generation Tools', score: 78, relatedKeywords: ['Sora', 'Runway', 'Pika'], peakTime: 'weekends' },
      { topic: 'Prompt Engineering Mastery', score: 71, relatedKeywords: ['chain of thought', 'few-shot', 'system prompts'], peakTime: null },
    ],
    recommendations: ['Focus on beginner tutorials for AI agents', 'Comparison videos perform 2× better in tech'],
  },
  finance: {
    trending: [
      { topic: 'Index Fund Investing for Beginners 2026', score: 92, relatedKeywords: ['ETF', 'S&P 500', 'Vanguard', 'passive income'], peakTime: 'weekdays' },
      { topic: 'How to Build a $10k Emergency Fund Fast', score: 88, relatedKeywords: ['savings', 'budgeting', 'frugal living'], peakTime: null },
      { topic: 'Dividend Investing Strategy', score: 84, relatedKeywords: ['DRIP', 'dividend stocks', 'quarterly income'], peakTime: null },
      { topic: 'Side Hustles That Actually Pay Well', score: 79, relatedKeywords: ['freelancing', 'Upwork', 'passive income ideas'], peakTime: 'weekends' },
      { topic: 'Real Estate Investing with No Money Down', score: 73, relatedKeywords: ['BRRRR method', 'house hacking', 'rental property'], peakTime: null },
    ],
    recommendations: ['Money anxiety content sees 3× more shares', 'Case study videos outperform generic finance advice'],
  },
  cooking: {
    trending: [
      { topic: '5-Ingredient Meals Under 30 Minutes', score: 93, relatedKeywords: ['quick dinner', 'easy recipes', 'meal prep'], peakTime: 'weekends' },
      { topic: 'Air Fryer Everything — Full Guide', score: 89, relatedKeywords: ['air fryer recipes', 'crispy', 'healthy frying'], peakTime: null },
      { topic: 'Budget Meal Prep for the Week', score: 85, relatedKeywords: ['meal prep Sunday', '$50 grocery haul', 'batch cooking'], peakTime: 'weekdays' },
      { topic: 'High-Protein Breakfast Ideas', score: 80, relatedKeywords: ['protein breakfast', 'eggs', 'Greek yogurt', 'muscle gain'], peakTime: null },
      { topic: 'Viral TikTok Recipes Tested', score: 74, relatedKeywords: ['baked feta pasta', 'smash burger', 'Dubai chocolate'], peakTime: 'weekends' },
    ],
    recommendations: ['Recipe shorts drive channel growth 2× faster', 'Trending food hacks outperform classic recipes this quarter'],
  },
  fitness: {
    trending: [
      { topic: '30-Day Beginner Home Workout Plan', score: 95, relatedKeywords: ['no equipment', 'beginner fitness', 'home gym'], peakTime: 'weekdays' },
      { topic: 'Zone 2 Cardio — The Longevity Secret', score: 90, relatedKeywords: ['zone 2 training', 'Peter Attia', 'VO2 max', 'heart rate'], peakTime: null },
      { topic: 'How to Build Muscle After 40', score: 86, relatedKeywords: ['muscle gain', 'testosterone', 'protein intake', 'recovery'], peakTime: null },
      { topic: 'Best Supplements That Actually Work', score: 81, relatedKeywords: ['creatine', 'protein powder', 'pre-workout', 'supplements review'], peakTime: 'weekends' },
      { topic: 'Mobility Routine for Desk Workers', score: 75, relatedKeywords: ['hip flexors', 'posture fix', 'stretching', 'back pain'], peakTime: 'weekdays' },
    ],
    recommendations: ['Transformation before/after videos see the most engagement', 'Science-backed content builds trust faster in fitness'],
  },
  gaming: {
    trending: [
      { topic: 'Best Free-to-Play Games in 2026', score: 96, relatedKeywords: ['F2P', 'Fortnite', 'Warzone', 'free games PC'], peakTime: 'weekends' },
      { topic: 'Complete Beginner Guide to [Top Game]', score: 91, relatedKeywords: ['tutorial', 'tips for beginners', 'ranked guide'], peakTime: null },
      { topic: 'Gaming Setup Under $500', score: 87, relatedKeywords: ['budget gaming PC', 'gaming chair', 'monitor deal'], peakTime: null },
      { topic: 'Ranking Every Game I Played This Year', score: 82, relatedKeywords: ['game tier list', 'best games 2026', 'GOTY'], peakTime: 'weekends' },
      { topic: 'How Streamers Make Money on Twitch', score: 76, relatedKeywords: ['Twitch affiliate', 'streaming income', 'game monetization'], peakTime: null },
    ],
    recommendations: ['Gaming shorts (30–60s clips) drive subscribers faster', 'Controversy-style titles earn 40% higher CTR'],
  },
  travel: {
    trending: [
      { topic: 'Budget Travel Europe 2026 — Full Guide', score: 91, relatedKeywords: ['cheap flights', 'hostel Europe', 'Eurail', 'travel hacks'], peakTime: 'weekends' },
      { topic: 'Hidden Gems in Southeast Asia', score: 87, relatedKeywords: ['Vietnam off the beaten path', 'Laos travel', 'cheap Asia'], peakTime: null },
      { topic: 'Solo Travel Safety Tips (For Women)', score: 83, relatedKeywords: ['solo female travel', 'safe countries', 'travel insurance'], peakTime: null },
      { topic: 'Travel Hacking with Credit Card Points', score: 79, relatedKeywords: ['miles rewards', 'Chase Sapphire', 'free flights'], peakTime: 'weekdays' },
      { topic: 'Digital Nomad Life — Month 6 Update', score: 72, relatedKeywords: ['remote work travel', 'nomad visa', 'coworking abroad'], peakTime: null },
    ],
    recommendations: ['Destination guides outperform vlogs 2× in search', 'Packing & planning content converts viewers to subscribers'],
  },
  education: {
    trending: [
      { topic: 'Learn Python in 1 Hour for Beginners', score: 93, relatedKeywords: ['Python tutorial', 'coding for beginners', 'free course'], peakTime: 'weekdays' },
      { topic: 'How to Study Smarter, Not Harder', score: 89, relatedKeywords: ['Pomodoro', 'active recall', 'spaced repetition', 'Anki'], peakTime: null },
      { topic: 'Best Free Online Courses in 2026', score: 85, relatedKeywords: ['Coursera free', 'MIT OpenCourseWare', 'Khan Academy'], peakTime: null },
      { topic: 'Acing Any Exam With Minimal Time', score: 80, relatedKeywords: ['exam strategy', 'last minute study', 'cheat sheet legal'], peakTime: 'weekdays' },
      { topic: 'The Best Books to Read This Year', score: 74, relatedKeywords: ['book recommendations', 'reading list 2026', 'self-improvement books'], peakTime: 'weekends' },
    ],
    recommendations: ['Tutorial playlists retain subscribers 3× longer', 'Skill-building series outperform one-off videos in education'],
  },
  business: {
    trending: [
      { topic: 'How to Start a Business with $0 in 2026', score: 94, relatedKeywords: ['bootstrap startup', 'no money business', 'service business'], peakTime: 'weekdays' },
      { topic: 'Dropshipping — Is It Still Worth It?', score: 88, relatedKeywords: ['Shopify dropship', 'AliExpress 2026', 'ecommerce profit'], peakTime: null },
      { topic: 'LinkedIn Growth Strategy That Actually Works', score: 84, relatedKeywords: ['LinkedIn algorithm', 'B2B leads', 'personal brand'], peakTime: 'weekdays' },
      { topic: 'SaaS Business Model Explained Simply', score: 79, relatedKeywords: ['SaaS MRR', 'no-code SaaS', 'micro SaaS'], peakTime: null },
      { topic: 'How I Made My First $10k Online', score: 75, relatedKeywords: ['online income', 'freelancing', 'digital products'], peakTime: 'weekends' },
    ],
    recommendations: ['Income report videos earn the highest watch time in business', 'Case studies convert viewers to buyers 4× better than theory'],
  },
  beauty: {
    trending: [
      { topic: 'Skincare Routine for Glowing Skin 2026', score: 92, relatedKeywords: ['moisturizer', 'SPF', 'vitamin C serum', 'glass skin'], peakTime: 'weekends' },
      { topic: 'Drugstore Dupes for Luxury Makeup', score: 88, relatedKeywords: ['makeup dupe', 'e.l.f.', 'NYX', 'budget beauty'], peakTime: null },
      { topic: 'Natural Hair Care Routine', score: 84, relatedKeywords: ['curly hair', 'low porosity hair', 'natural hair growth'], peakTime: null },
      { topic: '10-Minute Everyday Makeup Look', score: 80, relatedKeywords: ['quick makeup', 'no-makeup makeup', 'everyday glam'], peakTime: 'weekdays' },
      { topic: 'Anti-Aging Secrets Dermatologists Use', score: 74, relatedKeywords: ['retinol', 'collagen', 'anti-aging routine', 'peptides'], peakTime: 'weekends' },
    ],
    recommendations: ['Get-ready-with-me format drives 2× more comments', 'Product review roundups see higher search traffic'],
  },
  christian: {
    trending: [
      { topic: 'Best Worship Songs of 2026 — Full Playlist', score: 95, relatedKeywords: ['worship music', 'praise songs', 'Hillsong', 'Elevation Worship', 'Bethel Music'], peakTime: 'weekends' },
      { topic: 'Morning Devotion — Start Your Day with God', score: 91, relatedKeywords: ['morning prayer', 'daily devotional', 'quiet time', 'Bible reading plan'], peakTime: 'weekdays' },
      { topic: 'Powerful Sermons That Will Change Your Life', score: 88, relatedKeywords: ['sermon of the week', 'motivational message', 'faith', 'Charles Stanley', 'TD Jakes'], peakTime: 'weekends' },
      { topic: '7-Day Bible Reading Challenge for Beginners', score: 84, relatedKeywords: ['Bible study', 'Scripture reading', 'New Testament', 'daily Bible verse'], peakTime: 'weekdays' },
      { topic: 'Christian Songs for Healing & Peace', score: 80, relatedKeywords: ['healing worship', 'peace of God', 'soaking music', 'instrumental worship', 'prayer music'], peakTime: null },
      { topic: 'How to Build a Daily Prayer Habit', score: 77, relatedKeywords: ['prayer routine', 'intercession', 'prayer journal', 'talking to God'], peakTime: 'weekdays' },
      { topic: 'Gospel Music Mix — 1 Hour Non-Stop Praise', score: 73, relatedKeywords: ['gospel mix', 'African gospel', 'black gospel', 'choir', 'non-stop worship'], peakTime: 'weekends' },
    ],
    recommendations: [
      'Sunday upload timing drives 3× more views for worship content',
      'Devotional series (7-day, 30-day) retain subscribers far longer than one-offs',
      'Lyric videos for worship songs consistently top search results',
    ],
  },
};

const NICHE_ALIASES: Record<string, string> = {
  worship: 'christian', gospel: 'christian', devotion: 'christian', devotional: 'christian',
  sermon: 'christian', sermons: 'christian', prayer: 'christian', bible: 'christian',
  faith: 'christian', church: 'christian', songs: 'christian',
  money: 'finance', investing: 'finance', stocks: 'finance', crypto: 'finance',
  food: 'cooking', recipe: 'cooking', recipes: 'cooking', baking: 'cooking',
  gym: 'fitness', health: 'fitness', workout: 'fitness', exercise: 'fitness',
  games: 'gaming', game: 'gaming', twitch: 'gaming', esports: 'gaming',
  nomad: 'travel', adventure: 'travel', tourism: 'travel',
  learning: 'education', study: 'education', school: 'education',
  entrepreneur: 'business', startup: 'business', ecommerce: 'business',
  makeup: 'beauty', skincare: 'beauty', fashion: 'beauty', hair: 'beauty',
  ai: 'tech', coding: 'tech', programming: 'tech', software: 'tech',
};

function getTrendsForNiche(niche: string) {
  const key = niche.toLowerCase().trim();
  const exactMatch = NICHE_TRENDS[key];
  if (exactMatch) return exactMatch;
  const aliasMatch = NICHE_ALIASES[key];
  if (aliasMatch) return NICHE_TRENDS[aliasMatch];
  const partialKey = Object.keys(NICHE_TRENDS).find(
    (k) => key.includes(k) || k.includes(key)
  );
  if (partialKey) return NICHE_TRENDS[partialKey];
  // Default: return tech trends with niche-prefixed topics
  return {
    trending: NICHE_TRENDS['tech']!.trending.map((t) => ({
      ...t,
      topic: `${niche} — ${t.topic}`,
    })),
    recommendations: [
      `"${niche}" is an emerging niche — first-mover advantage is high`,
      'Educational how-to content performs best for new niches',
    ],
  };
}

const MOCK_SUBSCRIPTION = {
  plan: 'FREE',
  status: 'ACTIVE',
  currentPeriodStart: '2026-06-01T00:00:00.000Z',
  currentPeriodEnd: '2026-06-30T23:59:59.000Z',
  cancelAtPeriodEnd: false,
};

// ─── Stateful channel store ───────────────────────────────────────────────────
const disconnectedChannelIds = new Set<string>();
const removedChannelIds = new Set<string>();
const dynamicChannels: MockChannel[] = [];
let dynSeq = 0; // incremented each time a new channel is added via "Add another"
let pendingReconnect = false; // true when auth-url was called to reconnect a disconnected channel
let sessionRestored = false; // true once sessionStorage channels have been loaded into dynamicChannels

const SESSION_KEY = 'cf_mock_dyn_channels';

// Persist a channel to sessionStorage so it survives page reloads (OAuth redirect clears JS state)
function saveChannelToSession(ch: MockChannel) {
  try {
    const stored: MockChannel[] = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? '[]');
    if (!stored.some((c) => c.id === ch.id)) {
      stored.push(ch);
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(stored));
    }
  } catch { /* sessionStorage unavailable (SSR, private browse) — silently ignore */ }
}

function removeChannelFromSession(id: string) {
  try {
    const stored: MockChannel[] = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? '[]');
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(stored.filter((c) => c.id !== id)));
  } catch { /* ignore */ }
}

// On first GET /channels after a page reload, hydrate dynamicChannels from sessionStorage
function restoreFromSession() {
  if (sessionRestored) return;
  sessionRestored = true;
  try {
    const stored: MockChannel[] = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? '[]');
    const existing = new Set(dynamicChannels.map((c) => c.id));
    for (const ch of stored) {
      if (!existing.has(ch.id)) dynamicChannels.push(ch);
      if (ch.id.startsWith('ch-dyn-') || ch.id.startsWith('ch-url-')) {
        // Restore dynSeq counter so new IDs don't collide
        const num = parseInt(ch.id.replace(/\D+/g, ''), 10);
        if (!isNaN(num) && num >= dynSeq) dynSeq = num + 1;
      }
    }
  } catch { /* ignore */ }
}

function getChannels() {
  restoreFromSession();
  // If a reconnect just completed, re-activate all disconnected channels
  if (pendingReconnect) {
    disconnectedChannelIds.clear();
    pendingReconnect = false;
  }
  return [...MOCK_CHANNELS, ...dynamicChannels]
    .filter((c) => !removedChannelIds.has(c.id))
    .map((c) => disconnectedChannelIds.has(c.id) ? { ...c, active: false } : c);
}

// ─── Stateful job store ───────────────────────────────────────────────────────
// Keyed by projectId → list of extra jobs enqueued in this browser session.
// Each enqueue call replaces the previous run of the same type (re-run semantics).
const sessionJobs = new Map<string, Record<string, unknown>[]>();
let jobSeq = 100;

function getSessionJobs(projectId: string): Record<string, unknown>[] {
  return sessionJobs.get(projectId) ?? [];
}

function storeJob(projectId: string, job: Record<string, unknown>): void {
  const existing = sessionJobs.get(projectId) ?? [];
  const filtered = existing.filter((j) => j['type'] !== job['type']);
  sessionJobs.set(projectId, [...filtered, job]);
}

function mockResultFor(type: string, payload?: Record<string, unknown>): Record<string, unknown> {
  const topic = (payload?.['topic'] as string | undefined) ?? 'Your Topic';
  switch (type) {
    case 'TREND_ANALYSIS':
      return {
        trending: [
          { topic: 'AI Agents Automation 2026', score: 94, relatedKeywords: ['n8n', 'make.com', 'Claude API'], peakTime: 'weekdays' },
          { topic: 'Local LLMs vs Cloud AI', score: 87, relatedKeywords: ['Ollama', 'LM Studio', 'privacy AI'], peakTime: null },
          { topic: 'Vibe Coding with AI', score: 82, relatedKeywords: ['Cursor', 'Copilot', 'Claude Code'], peakTime: null },
        ],
        recommendations: ['Focus on beginner tutorials for AI agents', 'Comparison videos perform 2× better in tech'],
        analysisDate: '2026-06-27',
      };
    case 'AUDIENCE_ANALYSIS':
      return {
        primaryDemographic: 'Software developers and tech enthusiasts aged 25–40',
        interests: ['AI', 'Programming', 'Productivity', 'SaaS', 'No-code'],
        bestUploadTime: 'Tue–Thu 6–8 PM UTC',
        engagementRate: 4.2,
        topFormats: ['Tutorial', 'Comparison', 'Behind-the-scenes'],
      };
    case 'RESEARCH':
      return {
        topic,
        summary: `In-depth research on "${topic}" reveals strong audience interest driven by rapid industry developments in 2026. Content creators who publish authoritative guides in this space see 2–3× higher subscriber conversion rates than those covering adjacent topics.`,
        keyPoints: [
          `"${topic}" search volume is up 140% year-over-year`,
          'Long-form (15–25 min) content dominates watch-time in this niche',
          'Beginner-friendly tutorials attract the widest demographic',
          'Data-backed claims increase viewer trust and comment engagement',
        ],
        sources: [
          { url: 'https://example.com/source-1', title: 'Industry Report 2026', snippet: 'Market overview' },
        ],
        trendScore: 91,
      };
    case 'SCRIPT':
      return {
        title: `The Complete Guide to ${topic} — Everything You Need to Know`,
        hook: `In the next 15 minutes, you'll learn exactly what most people get completely wrong about ${topic} — and how to do it right.`,
        totalWordCount: 2640,
        estimatedDuration: '17 minutes',
        sections: [
          { title: 'Introduction & Hook', wordCount: 180 },
          { title: 'Why This Matters in 2026', wordCount: 520 },
          { title: 'Step-by-Step Breakdown', wordCount: 1100 },
          { title: 'Common Mistakes to Avoid', wordCount: 560 },
          { title: 'Conclusion & Call to Action', wordCount: 280 },
        ],
        callToAction: 'If this helped you, smash that subscribe button and drop a comment with your biggest takeaway!',
      };
    case 'FACT_CHECK':
      return {
        overallVerified: true,
        claims: [
          { claim: 'Search volume up 140% year-over-year', verified: true, confidence: 0.88 },
          { claim: 'Long-form content dominates watch-time', verified: true, confidence: 0.93 },
          { claim: 'Beginner tutorials attract widest demographic', verified: true, confidence: 0.91 },
        ],
        recommendation: 'All key claims are well-supported. Consider adding source citations in the video description.',
      };
    case 'COMPLIANCE':
      return {
        passed: true,
        score: 93,
        flags: [
          { category: 'DISCLAIMER', severity: 'WARN', description: 'Consider adding a results-may-vary disclaimer for any income or growth claims.' },
        ],
        advertiserFriendly: true,
        copyrightRisk: 'LOW',
      };
    case 'METADATA':
      return {
        title: `The Complete Guide to ${topic} (2026)`,
        description: `Everything you need to know about ${topic} — from beginner basics to advanced strategies used by top creators. Updated for 2026 with the latest trends, tools, and tactics.\n\n⏱️ Chapters:\n00:00 Introduction\n02:30 Why This Matters\n06:00 Step-by-Step Breakdown\n13:00 Common Mistakes\n16:00 Conclusion\n\n🔗 Resources mentioned in this video: [link in comments]`,
        tags: [topic.toLowerCase().replace(/\s+/g, '-'), 'tutorial', '2026', 'beginners-guide', 'how-to', 'productivity', 'ai-tools', 'youtube'],
        category: 'Education',
        language: 'en',
      };
    case 'SEO_OPTIMIZATION':
      return {
        primaryKeywords: [topic, `${topic} 2026`, `how to ${topic}`, `best ${topic} guide`],
        secondaryKeywords: ['tutorial', 'step by step', 'for beginners', 'complete guide', '2026'],
        estimatedMonthlySearches: '12,000–18,000',
        competitionLevel: 'MEDIUM',
        suggestedTitle: `${topic} Complete Guide 2026 (Step-by-Step Tutorial)`,
        rankingStrategy: 'Target the long-tail variant "how to [topic] for beginners" for faster ranking with lower competition.',
      };
    case 'THUMBNAIL':
      return {
        concept: `Bold split-frame design: left half shows a frustrated "before" face, right half shows a confident creator with results on screen behind them. High contrast red/white colour scheme for maximum shelf impact.`,
        textOverlay: topic.length > 20 ? topic.slice(0, 18) + '…' : topic,
        colorScheme: ['#FF0000', '#FFFFFF', '#1A1A1A'],
        subjectPosition: 'right-third',
        emotionalHook: 'Curiosity + aspiration',
        abVariant: 'Try a blue/yellow variant targeting aspirational emotion as a B-test.',
      };
    case 'PUBLISH':
      return {
        published: true,
        youtubeVideoId: 'mock-yt-id-' + jobSeq,
        publishedAt: new Date().toISOString(),
        visibility: 'PUBLIC',
        estimatedReach: '2,400–8,000 impressions in first 48h',
      };
    default:
      return { status: 'completed', message: `${type} completed successfully` };
  }
}

export const handlers = [
  // ── Auth ──────────────────────────────────────────────────────────────────
  http.post(`${BASE}/auth/login`, async ({ request }) => {
    const body = await request.json() as { email: string; password: string };
    if (body.email === OWNER_EMAIL && body.password === OWNER_PASSWORD) {
      return HttpResponse.json({ accessToken: MOCK_TOKEN, user: MOCK_USER });
    }
    return HttpResponse.json({ message: 'Invalid email or password' }, { status: 401 });
  }),

  http.post(`${BASE}/auth/register`, async ({ request }) => {
    const body = await request.json() as { email: string; password: string; name?: string };
    if (body.email === OWNER_EMAIL) {
      return HttpResponse.json({ message: 'Email already registered' }, { status: 409 });
    }
    if (body.email && body.password) {
      return HttpResponse.json({ accessToken: MOCK_TOKEN, user: { ...MOCK_USER, email: body.email, name: body.name ?? 'New User' } });
    }
    return HttpResponse.json({ message: 'Email and password are required' }, { status: 400 });
  }),

  http.get(`${BASE}/auth/me`, () => HttpResponse.json(MOCK_USER)),

  // ── Channels ──────────────────────────────────────────────────────────────
  http.get(`${BASE}/channels/status`, () => {
    const active = getChannels().find((c) => c.active);
    if (!active) return HttpResponse.json({ connected: false });
    return HttpResponse.json({
      connected: true,
      channelId: active.youtubeChannelId,
      channelName: active.title,
      handle: active.customUrl,
      thumbnail: active.thumbnailUrl,
      subscriberCount: active.subscriberCount,
      connectedAt: active.createdAt,
      lastSyncAt: active.lastSyncedAt,
    });
  }),

  http.get(`${BASE}/channels`, () => HttpResponse.json(getChannels())),

  http.get(`${BASE}/channels/auth-url`, () => {
    if (disconnectedChannelIds.size > 0) {
      // Reconnecting an existing channel — next GET /channels will re-activate it
      pendingReconnect = true;
    } else {
      // Adding a brand-new YouTube channel from a different Google account
      const info = EXTRA_CHANNEL_NAMES[dynSeq % EXTRA_CHANNEL_NAMES.length]!;
      dynSeq++;
      const dynCh = {
        id: `ch-dyn-${dynSeq}`,
        youtubeChannelId: `UCdyn${dynSeq}`,
        title: info.title,
        customUrl: info.customUrl,
        description: info.description,
        thumbnailUrl: null,
        subscriberCount: info.subs,
        videoCount: info.videos,
        active: true,
        lastSyncedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };
      dynamicChannels.push(dynCh);
      saveChannelToSession(dynCh);
    }
    return HttpResponse.json({ url: 'http://localhost:3007/channel-access?connected=true' });
  }),

  // Simulate OAuth error callback — used in E2E tests by navigating to
  // /settings?error=no_channel etc. No handler needed; error is a query param handled by the page.

  // POST /channels/connect-by-url — read-only channel connection without OAuth
  http.post(`${BASE}/channels/connect-by-url`, async ({ request }) => {
    const body = await request.json() as { channelUrl?: string };
    const raw = (body.channelUrl ?? '').trim();
    if (!raw) {
      return HttpResponse.json({ message: 'channelUrl is required' }, { status: 400 });
    }
    // Derive a display name from the URL / handle
    const handleMatch = raw.match(/(?:youtube\.com\/@?|^@?)([\w.-]+)/i);
    const handleSlug = handleMatch?.[1] ?? raw.replace(/[^a-z0-9]/gi, '');
    const displayName = handleSlug.charAt(0).toUpperCase() + handleSlug.slice(1).replace(/([A-Z])/g, ' $1').trim();
    const customUrl = `@${handleSlug.toLowerCase()}`;
    dynSeq++;
    const now = new Date().toISOString();
    const newCh: MockChannel = {
      id: `ch-url-${dynSeq}`,
      youtubeChannelId: `UCurl${dynSeq}`,
      title: displayName,
      customUrl,
      description: 'Connected via URL (read-only)',
      thumbnailUrl: null,
      subscriberCount: 0,
      videoCount: 0,
      active: true,
      lastSyncedAt: now,
      createdAt: now,
    };
    dynamicChannels.push(newCh);
    saveChannelToSession(newCh);
    return HttpResponse.json({ ...newCh, readOnly: true }, { status: 201 });
  }),

  // POST /channels/:id/remove — hard delete (permanently removes from list)
  http.post(`${BASE}/channels/:id/remove`, ({ params }) => {
    const id = params['id'] as string;
    removedChannelIds.add(id);
    disconnectedChannelIds.delete(id);
    removeChannelFromSession(id);
    return HttpResponse.json({ success: true });
  }),

  // DELETE /channels/:id — soft disconnect (sets active: false, keeps for reconnect)
  http.delete(`${BASE}/channels/:id`, ({ params }) => {
    const id = params['id'] as string;
    disconnectedChannelIds.add(id);
    return HttpResponse.json({ success: true });
  }),

  // ── Projects ──────────────────────────────────────────────────────────────
  http.get(`${BASE}/projects`, () => HttpResponse.json({ data: MOCK_PROJECTS, nextCursor: null })),

  http.post(`${BASE}/projects`, async ({ request }) => {
    const body = await request.json() as { title: string; channelId: string };
    return HttpResponse.json({
      id: 'proj-new',
      title: body.title,
      channelId: body.channelId,
      status: 'DRAFT',
      niche: null,
      targetLang: 'en',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }, { status: 201 });
  }),

  http.get(`${BASE}/projects/:id`, ({ params }) => {
    const id = params['id'] as string;
    const extra = getSessionJobs(id);

    if (id === 'proj-1') {
      // Extra jobs (from clicking Run) override base jobs of the same type
      const extraTypes = new Set(extra.map((j) => j['type']));
      const merged = [
        ...MOCK_PROJECT_DETAIL.jobs.filter((j) => !extraTypes.has(j.type)),
        ...extra,
      ];
      return HttpResponse.json({ ...MOCK_PROJECT_DETAIL, jobs: merged });
    }
    if (id === 'proj-2') {
      return HttpResponse.json({ ...MOCK_PROJECT_DETAIL, ...MOCK_PROJECTS[1], jobs: extra, approvals: [] });
    }
    // Any other project (e.g. proj-new created in this session) — return a live project with only session jobs
    return HttpResponse.json({
      id,
      title: 'New Project',
      niche: null,
      status: 'DRAFT',
      channelId: 'ch-1',
      channel: { id: 'ch-1', title: 'TechReview Pro', thumbnailUrl: null, youtubeChannelId: 'UCmock123' },
      jobs: extra,
      videos: [],
      approvals: [],
      _count: { jobs: extra.length, videos: 0 },
      updatedAt: new Date().toISOString(),
    });
  }),

  http.put(`${BASE}/projects/:id`, async ({ params, request }) => {
    const body = await request.json() as Record<string, unknown>;
    return HttpResponse.json({ id: params['id'], ...body });
  }),

  http.delete(`${BASE}/projects/:id`, () => HttpResponse.json({ success: true })),

  // ── Jobs ──────────────────────────────────────────────────────────────────
  http.post(`${BASE}/jobs`, async ({ request }) => {
    const body = await request.json() as { projectId: string; type: string; payload?: Record<string, unknown> };
    const now = new Date().toISOString();
    const id = `job-${++jobSeq}`;
    const newJob: Record<string, unknown> = {
      id,
      projectId: body.projectId,
      type: body.type,
      status: 'COMPLETED',
      payload: body.payload ?? {},
      result: mockResultFor(body.type, body.payload),
      error: null,
      attempts: 1,
      startedAt: now,
      completedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    storeJob(body.projectId, newJob);
    return HttpResponse.json(newJob, { status: 201 });
  }),

  http.get(`${BASE}/jobs/project/:projectId`, ({ params }) => {
    const pid = params['projectId'] as string;
    const extra = getSessionJobs(pid);
    if (pid === 'proj-1') {
      const extraTypes = new Set(extra.map((j) => j['type']));
      return HttpResponse.json([
        ...MOCK_PROJECT_DETAIL.jobs.filter((j) => !extraTypes.has(j.type)),
        ...extra,
      ]);
    }
    return HttpResponse.json(extra);
  }),

  http.get(`${BASE}/jobs/:id`, ({ params }) => {
    const jid = params['id'] as string;
    for (const jobs of sessionJobs.values()) {
      const found = jobs.find((j) => j['id'] === jid);
      if (found) return HttpResponse.json(found);
    }
    return HttpResponse.json({ id: jid, status: 'QUEUED', type: 'TREND_ANALYSIS', result: null, error: null });
  }),

  http.delete(`${BASE}/jobs/:id`, () => HttpResponse.json({ success: true })),

  // ── Approvals ─────────────────────────────────────────────────────────────
  http.get(`${BASE}/approvals/pending`, () => HttpResponse.json({ data: MOCK_APPROVALS, nextCursor: null })),

  http.post(`${BASE}/approvals/:id/approve`, () =>
    HttpResponse.json({ id: 'appr-1', status: 'APPROVED' }),
  ),

  http.post(`${BASE}/approvals/:id/reject`, () =>
    HttpResponse.json({ id: 'appr-1', status: 'REJECTED' }),
  ),

  // ── Trends ────────────────────────────────────────────────────────────────
  http.post(`${BASE}/trends/analyze`, async ({ request }) => {
    const body = await request.json() as { niche?: string };
    const result = getTrendsForNiche(body.niche ?? '');
    return HttpResponse.json({ ...result, analysisDate: new Date().toISOString().slice(0, 10) });
  }),

  // ── Billing ───────────────────────────────────────────────────────────────
  http.get(`${BASE}/billing/subscription`, () => HttpResponse.json(MOCK_SUBSCRIPTION)),

  http.post(`${BASE}/billing/checkout`, () =>
    HttpResponse.json({ url: 'https://checkout.stripe.com/mock-session' }),
  ),

  // ── Content ───────────────────────────────────────────────────────────────
  http.post(`${BASE}/content/research`, () =>
    HttpResponse.json({
      topic: 'AI Tools',
      summary: 'AI tools are transforming productivity in 2026.',
      keyPoints: ['Automation saves 10h/week', 'No-code AI is mainstream', 'Local LLMs are catching up'],
      sources: [{ url: 'https://example.com/ai-tools', title: 'AI Tools 2026', snippet: 'Overview' }],
      trendScore: 88,
      audienceInterestSignals: ['best ai tools 2026', 'ai productivity'],
    }),
  ),
];
