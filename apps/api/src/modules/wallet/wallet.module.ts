import { Module } from '@nestjs/common';
import { WalletService } from './wallet.service';

// Controllers for /wallet live in BillingModule (they need Stripe for
// recharge); this module owns the ledger engine only.
@Module({
  providers: [WalletService],
  exports: [WalletService],
})
export class WalletModule {}
