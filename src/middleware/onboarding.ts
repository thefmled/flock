import { NextFunction, Response } from 'express';
import { env } from '../config/env';
import { AuthenticatedRequest } from '../types';
import { fail } from '../utils/response';

export function requireOnboardingToken(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  if (!env.ONBOARDING_TOKEN) {
    fail(res, 'Venue onboarding is disabled', 503, 'ONBOARDING_DISABLED');
    return;
  }

  const token = req.header('x-flock-onboarding-token');
  if (!token || token !== env.ONBOARDING_TOKEN) {
    fail(res, 'Invalid onboarding token', 401, 'UNAUTHORIZED');
    return;
  }

  next();
}
