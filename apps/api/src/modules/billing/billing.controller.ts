import { Controller, Get, Post, Body, Headers, RawBodyRequest, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, type JwtPayload } from '../../common/decorators/current-user.decorator';
import { BillingService } from './billing.service';

class CheckoutDto {
  @IsString() plan!: string;
  @IsString() successUrl!: string;
  @IsString() cancelUrl!: string;
}

@ApiTags('billing')
@Controller('billing')
export class BillingController {
  constructor(private readonly svc: BillingService) {}

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('subscription')
  getSubscription(@CurrentUser() user: JwtPayload) {
    return this.svc.getSubscription(user.sub);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('checkout')
  checkout(@Body() dto: CheckoutDto, @CurrentUser() user: JwtPayload) {
    return this.svc.createCheckoutSession(
      user.sub, user.email, dto.plan, dto.successUrl, dto.cancelUrl,
    );
  }

  @Post('webhook')
  webhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') sig: string,
  ) {
    return this.svc.handleWebhook(req.rawBody, sig);
  }
}
