// k6 load baseline for AI CreatorForce (readiness report item 15).
//
// Read-only traffic against cheap endpoints — no AI spend, no writes, no auth
// brute-force (login is Redis rate-limited at 10/60s per IP, so hammering it
// only measures the 429 path).
//
// Run (against a production-like environment, NOT a shared dev box):
//   k6 run infra/load/k6-baseline.js -e BASE_URL=https://api.example.com
// Quick local smoke (10 VUs, 30s):
//   k6 run infra/load/k6-baseline.js -e BASE_URL=http://localhost:4007 -e SMOKE=1
//
// Pass criteria (thresholds below): p95 < 500ms, error rate < 1%.

import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:4007';
const SMOKE = !!__ENV.SMOKE;

export const options = {
  scenarios: {
    baseline: SMOKE
      ? { executor: 'constant-vus', vus: 10, duration: '30s' }
      : {
          executor: 'ramping-vus',
          startVUs: 0,
          stages: [
            { duration: '2m', target: 100 },
            { duration: '3m', target: 500 },
            { duration: '5m', target: 500 },
            { duration: '1m', target: 0 },
          ],
        },
  },
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
  },
};

export default function () {
  // Health is version-neutral: /health (not under /api/v1)
  const health = http.get(`${BASE_URL}/health`);
  check(health, { 'health 200': (r) => r.status === 200 });

  // Unauthenticated hit on a guarded route: exercises helmet + guard stack;
  // 401 is the expected (and cheap) answer.
  const guarded = http.get(`${BASE_URL}/api/v1/projects`);
  check(guarded, { 'guarded route rejects cleanly': (r) => r.status === 401 });

  sleep(1);
}
