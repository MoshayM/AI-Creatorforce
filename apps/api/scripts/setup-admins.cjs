/**
 * setup-admins.cjs
 * Ensures the designated OWNER and SUPER_ADMIN accounts have:
 *   - AGENCY subscription that never expires (currentPeriodEnd = 2099-12-31)
 *   - Wallet with 10 M purchased credits (bypasses trial checks)
 *   - TrialGrant status = CONVERTED (never counted as trial user)
 *
 * Run once after first deploy, or re-run safely — all ops are upserts.
 *   node apps/api/scripts/setup-admins.cjs
 */

'use strict';

const { PrismaClient } = require('@prisma/client');

const ADMINS = [
  { email: 'moshaymuthukumar@gmail.com', role: 'SUPER_ADMIN', stripeKey: 'admin_sa_moshaymuthukumar' },
  { email: 'ethonanpasumvalki@gmail.com', role: 'OWNER',       stripeKey: 'admin_owner_ethonanpasumvalki' },
];

const AGENCY_EXPIRY    = new Date('2099-12-31T23:59:59.000Z');
const ADMIN_CREDITS    = 10_000_000;

async function main() {
  const prisma = new PrismaClient();
  try {
    for (const admin of ADMINS) {
      console.log(`\n→ Setting up ${admin.role}: ${admin.email}`);

      // 1. Upsert user record
      const user = await prisma.user.upsert({
        where:  { email: admin.email },
        update: { role: admin.role },
        create: { email: admin.email, role: admin.role },
      });
      console.log(`  ✓ User ${user.id} (${user.role})`);

      // 2. Upsert AGENCY subscription — never expires
      const sub = await prisma.subscription.upsert({
        where:  { userId: user.id },
        update: {
          plan:               'AGENCY',
          status:             'ACTIVE',
          currentPeriodEnd:   AGENCY_EXPIRY,
          cancelAtPeriodEnd:  false,
        },
        create: {
          userId:              user.id,
          stripeCustomerId:    admin.stripeKey,
          plan:                'AGENCY',
          status:              'ACTIVE',
          currentPeriodStart:  new Date(),
          currentPeriodEnd:    AGENCY_EXPIRY,
          cancelAtPeriodEnd:   false,
        },
      });
      console.log(`  ✓ Subscription ${sub.id} — AGENCY until ${AGENCY_EXPIRY.toISOString().slice(0, 10)}`);

      // 3. Upsert wallet with abundant purchased credits
      const wallet = await prisma.wallet.upsert({
        where:  { userId: user.id },
        update: {
          purchasedCredits:  ADMIN_CREDITS,
          balanceCredits:    ADMIN_CREDITS,
          lifetimePurchased: ADMIN_CREDITS,
        },
        create: {
          userId:            user.id,
          purchasedCredits:  ADMIN_CREDITS,
          balanceCredits:    ADMIN_CREDITS,
          lifetimePurchased: ADMIN_CREDITS,
        },
      });
      console.log(`  ✓ Wallet ${wallet.id} — ${ADMIN_CREDITS.toLocaleString()} credits`);

      // 4. Mark trial as CONVERTED so isTrialUser() is always false
      const now = new Date();
      const trialGrant = await prisma.trialGrant.upsert({
        where:  { userId: user.id },
        update: { status: 'CONVERTED' },
        create: {
          userId:         user.id,
          creditsGranted: 0,
          status:         'CONVERTED',
          expiresAt:      now,
          grantedAt:      now,
        },
      });
      console.log(`  ✓ TrialGrant ${trialGrant.id} — CONVERTED`);
    }

    console.log('\n✅ Admin setup complete.\n');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('Setup failed:', err);
  process.exit(1);
});
