-- Phase 5 §10 spend wiring: projects can bill agent-job spend to an org wallet
ALTER TABLE "projects" ADD COLUMN "billingOrgId" TEXT;
