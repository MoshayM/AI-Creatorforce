import { Module } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { BudgetService } from './budget.service';
import { CreditInsightsService } from './credit-insights.service';

// Controllers for /wallet live in BillingModule (they need Stripe for
// recharge); this module owns the ledger engine only.
@Module({
  providers: [WalletService, BudgetService, CreditInsightsService],
  exports: [WalletService, BudgetService, CreditInsightsService],
})
export class WalletModule {}
