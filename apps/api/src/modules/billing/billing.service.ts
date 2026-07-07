import { Injectable, BadRequestException, Logger } from '@nestjs/common';
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
