import { Injectable, BadRequestException } from '@nestjs/common';
import Stripe from 'stripe';
import { PrismaService } from '../../common/prisma/prisma.service';

const PLAN_PRICE_IDS: Record<string, string> = {
  STARTER: process.env['STRIPE_STARTER_PRICE_ID'] ?? '',
  PRO: process.env['STRIPE_PRO_PRICE_ID'] ?? '',
  AGENCY: process.env['STRIPE_AGENCY_PRICE_ID'] ?? '',
};

@Injectable()
export class BillingService {
  private _stripe: Stripe | null = null;

  constructor(private readonly prisma: PrismaService) {}

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

  async handleWebhook(payload: Buffer, signature: string) {
    const secret = process.env['STRIPE_WEBHOOK_SECRET'] ?? '';
    const event = this.stripe.webhooks.constructEvent(payload, signature, secret);

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
