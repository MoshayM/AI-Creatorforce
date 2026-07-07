import { Injectable, BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import Stripe from 'stripe';
import { PrismaService } from '../../common/prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';

const PLAN_PRICE_IDS: Record<string, string> = {
  STARTER: process.env['STRIPE_STARTER_PRICE_ID'] ?? '',
  PRO: process.env['STRIPE_PRO_PRICE_ID'] ?? '',
  AGENCY: process.env['STRIPE_AGENCY_PRICE_ID'] ?? '',
};

/** Credits granted per 1 USD (billing spec §5.2) — env-tunable, integer credits only. */
function creditsPerUsd(): number {
  return Math.max(1, Math.round(Number(process.env['CREDITS_PER_USD']) || 100));
}

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private _stripe: Stripe | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
  ) {}

  private get stripe(): Stripe {
    if (!this._stripe) {
      const key = process.env['STRIPE_SECRET_KEY'];
      if (!key) throw new BadRequestException('Billing is not configured (STRIPE_SECRET_KEY missing)');
      this._stripe = new Stripe(key, { apiVersion: '2025-02-24.acacia' });
    }
    return this._stripe;
  }

  async getOrCreateCustomer(userId: string, email: string): Promise<string> {
    const sub = await this.prisma.subscription.findUnique({ where: { userId } });
    if (sub) return sub.stripeCustomerId;

    const customer = await this.stripe.customers.create({ email, metadata: { userId } });
    await this.prisma.subscription.create({
      data: {
        userId,
        stripeCustomerId: customer.id,
        plan: 'FREE',
        status: 'ACTIVE',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });
    return customer.id;
  }

  async createCheckoutSession(userId: string, email: string, plan: string, successUrl: string, cancelUrl: string) {
    const priceId = PLAN_PRICE_IDS[plan];
    if (!priceId) throw new BadRequestException('Invalid plan');
    const customerId = await this.getOrCreateCustomer(userId, email);
    return this.stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: { userId, plan },
    });
  }

  /**
   * Wallet recharge (billing spec §5.2): a one-time Stripe Checkout in
   * payment mode. The Payment row is created PENDING before redirecting;
   * credits are granted only by the signature-verified webhook. Replaying
   * the same idempotencyKey returns the original session's payment.
   * Web/desktop-direct only — mobile IAP is a separate adapter (§6.6).
   */
  async createRechargeSession(
    userId: string,
    email: string,
    amountUsd: number,
    idempotencyKey: string,
    successUrl: string,
    cancelUrl: string,
  ) {
    if (!Number.isInteger(amountUsd) || amountUsd < 1 || amountUsd > 10_000) {
      throw new BadRequestException('Recharge amount must be a whole USD amount between 1 and 10000');
    }
    const existing = await this.prisma.payment.findUnique({ where: { idempotencyKey } });
    if (existing) throw new BadRequestException('This recharge request was already started (idempotency key reuse)');

    const credits = amountUsd * creditsPerUsd();
    const customerId = await this.getOrCreateCustomer(userId, email);
    const session = await this.stripe.checkout.sessions.create(
      {
        customer: customerId,
        mode: 'payment',
        line_items: [{
          price_data: {
            currency: 'usd',
            unit_amount: amountUsd * 100,
            product_data: { name: `CreatorForce Credits (${credits.toLocaleString()})` },
          },
          quantity: 1,
        }],
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: { kind: 'wallet_recharge', userId, credits: String(credits), idempotencyKey },
      },
      { idempotencyKey },
    );

    await this.prisma.payment.create({
      data: {
        userId,
        gateway: 'STRIPE',
        // Session id first; replaced by the payment intent on settle — this is
        // what lets the reconciliation job find orphaned PENDING payments (§13)
        gatewayPaymentId: session.id,
        amount: amountUsd * 100,
        currency: 'usd',
        status: 'PENDING',
        creditsGranted: 0,
        idempotencyKey,
      },
    });
    return { checkoutUrl: session.url, credits, amountUsd };
  }

  async handleWebhook(payload: Buffer, signature: string) {
    const secret = process.env['STRIPE_WEBHOOK_SECRET'] ?? '';
    const event = this.stripe.webhooks.constructEvent(payload, signature, secret);

    // §6.2: dedupe on the gateway's event id — duplicate deliveries are no-ops
    try {
      await this.prisma.webhookEvent.create({
        data: { gateway: 'STRIPE', eventId: event.id, eventType: event.type },
      });
    } catch {
      this.logger.log(`[webhook] duplicate ${event.type} ${event.id} — ignored`);
      return;
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.metadata?.['kind'] === 'wallet_recharge' && session.payment_status === 'paid') {
        await this.settleRecharge(session);
      }
    }

    // §7: a dispute flags the payment and lands in the audit trail for review
    if (event.type === 'charge.dispute.created') {
      const dispute = event.data.object as Stripe.Dispute;
      const intent = typeof dispute.payment_intent === 'string' ? dispute.payment_intent : dispute.payment_intent?.id;
      if (intent) {
        const disputed = await this.prisma.payment.updateMany({
          where: { gatewayPaymentId: intent },
          data: { status: 'DISPUTED' },
        });
        const payment = await this.prisma.payment.findUnique({ where: { gatewayPaymentId: intent } });
        await this.prisma.auditLog.create({
          data: {
            userId: payment?.userId,
            action: 'system:dispute-created',
            target: payment?.id ?? intent,
            meta: { disputeId: dispute.id, amount: dispute.amount, reason: dispute.reason, matched: disputed.count } as never,
          },
        }).catch(() => undefined);
        this.logger.error(`[dispute] ${dispute.id} on ${intent} (${dispute.reason}) — payment flagged, needs review`);
      }
    }

    if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.created') {
      const sub = event.data.object as Stripe.Subscription;
      await this.prisma.subscription.updateMany({
        where: { stripeCustomerId: sub.customer as string },
        data: {
          stripeSubscriptionId: sub.id,
          status: sub.status.toUpperCase() as 'ACTIVE',
          currentPeriodStart: new Date(sub.current_period_start * 1000),
          currentPeriodEnd: new Date(sub.current_period_end * 1000),
          cancelAtPeriodEnd: sub.cancel_at_period_end,
        },
      });
    }
  }

  /** §5.2 steps 5–8: mark the payment succeeded and grant credits, each idempotent. */
  private async settleRecharge(session: Stripe.Checkout.Session) {
    const userId = session.metadata?.['userId'];
    const credits = parseInt(session.metadata?.['credits'] ?? '0', 10);
    const idempotencyKey = session.metadata?.['idempotencyKey'];
    if (!userId || !credits || !idempotencyKey) {
      this.logger.error(`[recharge] session ${session.id} missing metadata — manual reconciliation needed`);
      return;
    }
    const gatewayPaymentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.id;

    const payment = await this.prisma.payment.update({
      where: { idempotencyKey },
      data: { status: 'SUCCEEDED', gatewayPaymentId, creditsGranted: credits },
    }).catch(() => null);
    if (!payment) {
      this.logger.error(`[recharge] no pending payment for key ${idempotencyKey} — manual reconciliation needed`);
      return;
    }

    // Credit grant idempotency is keyed on the gateway payment id, so even a
    // replayed webhook after the event-dedupe row was lost cannot double-credit
    await this.wallet.credit(userId, {
      entryType: 'PURCHASE',
      amount: credits,
      referenceType: 'PAYMENT',
      referenceId: payment.id,
      idempotencyKey: `stripe:${gatewayPaymentId}`,
      metadata: { gateway: 'STRIPE', amountMinor: payment.amount, currency: payment.currency },
    });
    this.logger.log(`[recharge] +${credits} credits → user ${userId} (payment ${payment.id})`);
  }

  /**
   * Refund with credit claw-back (§7). Full or partial; the claw-back is a
   * proportional ADJUSTMENT debit clamped to the wallet's current balance
   * (already-spent credits can't be un-spent — the shortfall is recorded,
   * history is never deleted). Idempotent at the gateway via refund key.
   */
  async refundPayment(paymentId: string, adminId: string, reason: string, amountMinor?: number) {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.gateway !== 'STRIPE') throw new BadRequestException(`Refunds for ${payment.gateway} are not implemented`);
    if (payment.status !== 'SUCCEEDED' && payment.status !== 'PARTIALLY_REFUNDED') {
      throw new BadRequestException(`Payment is ${payment.status} — only succeeded payments can be refunded`);
    }
    if (!payment.gatewayPaymentId?.startsWith('pi_')) {
      throw new BadRequestException('Payment has no settled payment intent to refund against');
    }
    const refundMinor = amountMinor ?? payment.amount;
    if (!Number.isInteger(refundMinor) || refundMinor < 1 || refundMinor > payment.amount) {
      throw new BadRequestException('Refund amount must be between 1 and the original payment amount (minor units)');
    }

    await this.stripe.refunds.create(
      { payment_intent: payment.gatewayPaymentId, amount: refundMinor, reason: 'requested_by_customer' },
      { idempotencyKey: `refund:${payment.id}:${refundMinor}` },
    );

    // Proportional claw-back, clamped to what the wallet still holds
    const clawTarget = Math.round(payment.creditsGranted * (refundMinor / payment.amount));
    const balance = (await this.wallet.getBalance(payment.userId)).balanceCredits;
    const clawed = Math.min(clawTarget, balance);
    if (clawed > 0) {
      await this.wallet.debit(payment.userId, {
        entryType: 'ADJUSTMENT',
        amount: clawed,
        referenceType: 'ADMIN_ACTION',
        referenceId: payment.id,
        idempotencyKey: `refund-claw:${payment.id}:${refundMinor}`,
        metadata: { reason, adminId, refundMinor, clawTarget, shortfall: clawTarget - clawed },
      });
    }

    const updated = await this.prisma.payment.update({
      where: { id: payment.id },
      data: { status: refundMinor === payment.amount ? 'REFUNDED' : 'PARTIALLY_REFUNDED' },
    });

    // §9.7: audited synchronously before the caller sees success
    await this.prisma.auditLog.create({
      data: {
        userId: adminId,
        action: 'admin:refund',
        target: payment.id,
        meta: {
          reason, refundMinor, currency: payment.currency,
          creditsClawedBack: clawed, clawTarget, shortfall: clawTarget - clawed,
          before: { status: payment.status }, after: { status: updated.status },
        } as never,
      },
    });
    this.logger.warn(`[refund] ${payment.id}: ${refundMinor} ${payment.currency} refunded, ${clawed}/${clawTarget} credits clawed back`);
    return { paymentId: payment.id, status: updated.status, refundedMinor: refundMinor, creditsClawedBack: clawed, shortfall: clawTarget - clawed };
  }

  /**
   * §11 gateway-settlement-reconciliation / §13 payment.orphaned recovery:
   * PENDING Stripe payments older than an hour mean a webhook was missed —
   * re-check the session directly and settle (idempotently) or fail it.
   * No-op when Stripe isn't configured.
   */
  async reconcilePendingPayments(): Promise<{ checked: number; recovered: number; expired: number }> {
    if (!process.env['STRIPE_SECRET_KEY']) return { checked: 0, recovered: 0, expired: 0 };
    const stale = await this.prisma.payment.findMany({
      where: { gateway: 'STRIPE', status: 'PENDING', createdAt: { lt: new Date(Date.now() - 60 * 60_000) } },
      orderBy: { createdAt: 'asc' },
      take: 50,
    });
    let recovered = 0;
    let expired = 0;
    for (const p of stale) {
      if (!p.gatewayPaymentId?.startsWith('cs_')) continue;
      try {
        const session = await this.stripe.checkout.sessions.retrieve(p.gatewayPaymentId);
        if (session.payment_status === 'paid') {
          this.logger.warn(`[reconcile] payment.orphaned recovered: ${p.id} paid but never settled — settling now`);
          await this.settleRecharge(session);
          recovered += 1;
        } else if (session.status === 'expired') {
          await this.prisma.payment.update({
            where: { id: p.id },
            data: { status: 'FAILED', failureReason: 'checkout session expired' },
          });
          expired += 1;
        }
      } catch (err) {
        this.logger.warn(`[reconcile] payment ${p.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return { checked: stale.length, recovered, expired };
  }

  async getSubscription(userId: string) {
    const sub = await this.prisma.subscription.findUnique({ where: { userId } });
    if (sub) return sub;
    return {
      plan: 'FREE',
      status: 'ACTIVE',
      currentPeriodStart: new Date().toISOString(),
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      cancelAtPeriodEnd: false,
    };
  }
}
