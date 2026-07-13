import { Injectable, ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import { mediaResource, signingSecret, verifySignedMedia } from './signed-url.util';

/**
 * Allows a media file request through on EITHER a valid signed-URL pair
 * (`?exp=&sig=` covering the exact resource, docs4/09) OR a normal JWT.
 * Extends the raw passport guard (not JwtAuthGuard) on purpose: the file
 * routes are marked @Public() to neutralise the controller-level JWT guard,
 * so the fallback here must NOT honour @Public itself.
 */
@Injectable()
export class SignedMediaOrJwtGuard extends AuthGuard('jwt') {
  override canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<Request>();
    const exp = req.query['exp'];
    const sig = req.query['sig'];
    if (typeof exp === 'string' && typeof sig === 'string') {
      const resource = mediaResource(req.params as Record<string, string>);
      if (resource && verifySignedMedia(resource, Number(exp), sig, signingSecret())) {
        (req as Request & { signedMediaAccess?: boolean }).signedMediaAccess = true;
        return true;
      }
    }
    return super.canActivate(context);
  }
}
