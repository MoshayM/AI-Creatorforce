# CreatorForce AI

AI-powered YouTube Content Operating System. Channel-first, non-destructive, transparent-AI.

Monorepo: Next.js web app (`apps/web`, port 3007) · NestJS API (`apps/api`, port 4007) · Playwright E2E (`apps/e2e`) · shared packages (`packages/*`).

## Quickstart

```
pnpm install
pnpm db:migrate      # Prisma migrations
pnpm dev             # web :3007 + api :4007 via turbo
```

On Windows, `creatorforce-AI.bat` clears ports, loads `.env`, and launches both servers.

Other scripts: `pnpm build` · `pnpm lint` · `pnpm typecheck` · `pnpm test` · `pnpm db:studio`.

Requires Node >= 20, pnpm >= 9. Operating contract for contributors (human or AI): [claude.md](claude.md) and [docs4/49_CLAUDE_RULES.md](docs4/49_CLAUDE_RULES.md).

## Engineering Specifications

Source-of-truth documentation lives in [`docs4/`](docs4/).

- **00** — [Master PRD](docs4/00_Master_PRD.md)
- **01** — [Product Vision](docs4/01_Product_Vision.md)
- **02** — [System Architecture](docs4/02_System_Architecture.md)
- **03** — [Database Architecture](docs4/03_Database_Architecture.md)
- **04** — [Channel Workspace](docs4/04_Channel_Workspace.md)
- **05** — [AI Workflow](docs4/05_AI_Workflow.md)
- **06** — [Edit Studio](docs4/06_Edit_Studio.md)
- **07** — [Shorts Studio](docs4/07_Shorts_Studio.md)
- **08** — [Playlists and Library](docs4/08_Playlists_and_Library.md)
- **09** — [Asset Management](docs4/09_Asset_Management.md)
- **10** — [AI Credits](docs4/10_AI_Credits.md)
- **11** — [AI Models](docs4/11_AI_Models.md)
- **12** — [Background Jobs](docs4/12_Background_Jobs.md)
- **13** — [Performance](docs4/13_Performance.md)
- **14** — [Security](docs4/14_Security.md)
- **15** — [Authentication](docs4/15_Authentication.md)
- **16** — [API Architecture](docs4/16_API_Architecture.md)
- **17** — [Frontend UI UX](docs4/17_Frontend_UI_UX.md)
- **18** — [Component Guidelines](docs4/18_Component_Guidelines.md)
- **19** — [Design System](docs4/19_Design_System.md)
- **20** — [Observability](docs4/20_Observability.md)
- **21** — [Testing Strategy](docs4/21_Testing_Strategy.md)
- **22** — [Playwright Testing](docs4/22_Playwright_Testing.md)
- **23** — [OWASP ZAP](docs4/23_OWASP_ZAP.md)
- **24** — [BurpSuite](docs4/24_BurpSuite.md)
- **25** — [Snyk](docs4/25_Snyk.md)
- **26** — [Dependabot](docs4/26_Dependabot.md)
- **27** — [Semgrep](docs4/27_Semgrep.md)
- **28** — [Prometheus Grafana](docs4/28_Prometheus_Grafana.md)
- **29** — [CI CD](docs4/29_CI_CD.md)
- **30** — [Deployment](docs4/30_Deployment.md)
- **31** — [Coding Standards](docs4/31_Coding_Standards.md)
- **32** — [Error Handling](docs4/32_Error_Handling.md)
- **33** — [AI Agent Architecture](docs4/33_AI_Agent_Architecture.md)
- **34** — [Background Workers](docs4/34_Background_Workers.md)
- **35** — [Queues](docs4/35_Queues.md)
- **36** — [Caching](docs4/36_Caching.md)
- **37** — [State Management](docs4/37_State_Management.md)
- **38** — [Logging](docs4/38_Logging.md)
- **39** — [Monitoring](docs4/39_Monitoring.md)
- **40** — [Backup Recovery](docs4/40_Backup_Recovery.md)
- **41** — [Disaster Recovery](docs4/41_Disaster_Recovery.md)
- **42** — [Accessibility](docs4/42_Accessibility.md)
- **43** — [Internationalization](docs4/43_Internationalization.md)
- **44** — [Performance Budget](docs4/44_Performance_Budget.md)
- **45** — [Release Process](docs4/45_Release_Process.md)
- **46** — [Roadmap](docs4/46_Roadmap.md)
- **47** — [Risk Register](docs4/47_Risk_Register.md)
- **48** — [Project Checklist](docs4/48_Project_Checklist.md)
- **49** — [CLAUDE RULES](docs4/49_CLAUDE_RULES.md)
- **50** — [IMPLEMENTATION PLAN](docs4/50_IMPLEMENTATION_PLAN.md)
