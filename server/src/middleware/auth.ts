import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { StatusCodes } from 'http-status-codes';
import { userRepo } from '../repositories/registry';
import type { SessionUser } from '../types/api';
import type { User } from '../repositories/UserRepository';
import { HttpError } from '../errors/HttpError';
import { isSingleUserMode } from '../utils/env';
import { hashPassword } from '../utils/passwordHasher';
import logger from '../logger';

/**
 * Ensures the standalone user exists in the database for single user mode.
 * Creates the user if not found.
 */
async function ensureSingleUser(): Promise<User> {
  // Look up by username first, then by email as fallback
  const existing =
    (await userRepo.findByUserName('standalone')) ??
    (await userRepo.findByEmail('standalone@localhost'));

  if (existing) {
    // Ensure the user has admin role
    if (existing.user_role !== 'admin') {
      const updated = await userRepo.update(existing.id, {
        user_role: 'admin'
      });
      if (updated) return updated;
    }
    return existing;
  }

  // Hash a random UUID as password (not usable for login)
  const randomPassword = await hashPassword(crypto.randomUUID());

  const user = await userRepo.create({
    user_name: 'standalone',
    email: 'standalone@localhost',
    password: randomPassword,
    user_role: 'admin',
    full_name: 'Standalone User'
  });

  logger.info('Single user mode: created standalone user');
  return user;
}

export const requireAuth = async (
  req: Request,
  _res: Response,
  next: NextFunction
) => {
  // In single user mode, auto-authenticate if not already authenticated
  if (isSingleUserMode() && !req.session?.user) {
    try {
      const user = await ensureSingleUser();
      const sessionUser: SessionUser = {
        id: user.id,
        userName: user.user_name,
        userRole: user.user_role
      };

      // Persist the session so subsequent requests are fast
      req.session.user = sessionUser;
      req.user = sessionUser;

      req.session.save((err) => {
        if (err) {
          next(err);
          return;
        }
        next();
      });
      return;
    } catch (err) {
      next(err);
      return;
    }
  }

  if (!req.session?.user) {
    next(new HttpError(StatusCodes.UNAUTHORIZED, 'Authentication required'));
    return;
  }

  const sessionUser = req.user as SessionUser;
  const user = await userRepo.findById(sessionUser.id);

  if (!user) {
    delete req.session.user;
    delete req.user;
    next(new HttpError(StatusCodes.UNAUTHORIZED, 'User not found'));
    return;
  }

  next();
};
