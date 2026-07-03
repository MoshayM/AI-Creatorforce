import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-local';

// Placeholder — full Google OAuth is wired in ChannelsModule via googleapis
@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google-local') {
  constructor() {
    super({ usernameField: 'code', passwordField: 'redirectUri' });
  }

  validate(code: string, redirectUri: string) {
    return { code, redirectUri };
  }
}
