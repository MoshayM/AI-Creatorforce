import { Controller, Get, Put, Body, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OwnerGuard } from '../../common/guards/owner.guard';
import { SettingsService } from './settings.service';

@ApiTags('settings')
@Controller('settings')
@UseGuards(JwtAuthGuard, OwnerGuard)
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get('api-keys')
  getApiKeys() {
    return this.settings.getApiKeys();
  }

  @Put('api-keys')
  updateApiKeys(@Body() body: Record<string, string>) {
    return this.settings.updateApiKeys(body);
  }
}
