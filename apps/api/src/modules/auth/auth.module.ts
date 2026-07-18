import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService, ConfigModule } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { GoogleStrategy } from './google.strategy';
import { SessionsService } from './sessions.service';
import { OAuthService } from './oauth.service';
import { OtpService } from './otp.service';
import { PasswordResetService } from './password-reset.service';
import { ProviderRegistry } from './providers/provider.registry';
import { GoogleAdapter } from './providers/google.adapter';
import { AppleAdapter } from './providers/apple.adapter';
import { FacebookAdapter } from './providers/facebook.adapter';
import { TrialModule } from '../trial/trial.module';

@Module({
  imports: [
    TrialModule,
    ConfigModule,
    PassportModule,
    // @reason: registerAsync defers env reads until after ConfigModule loads .env —
    // JwtModule.register() runs at decorator time before dotenv, causing sign/verify secret mismatch.
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        secret: cfg.get<string>('JWT_SECRET') ?? 'dev-secret',
        signOptions: { expiresIn: `${cfg.get<string>('JWT_EXPIRY') ?? 900}s` },
      }),
    }),
  ],
  providers: [
    AuthService,
    JwtStrategy,
    GoogleStrategy,
    SessionsService,
    OAuthService,
    OtpService,
    PasswordResetService,
    ProviderRegistry,
    GoogleAdapter,
    AppleAdapter,
    FacebookAdapter,
  ],
  controllers: [AuthController],
  exports: [AuthService, JwtModule, SessionsService, OAuthService, OtpService, PasswordResetService],
})
export class AuthModule {}
