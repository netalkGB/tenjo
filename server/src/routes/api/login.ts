import express from 'express';
import { StatusCodes } from 'http-status-codes';
import { z } from 'zod';
import { requireCsrfToken } from '../../middleware/csrf';
import { HttpError } from '../../errors/HttpError';
import { userRepo } from '../../repositories/registry';
import { isDevelopment } from '../../utils/env';
import { verifyPassword } from '../../utils/passwordHasher';
import type { SessionUser } from '../../types/api';
import logger from '../../logger';

export const loginRouter = express.Router();

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1)
});

interface LoginResponse {
  message: string;
}

loginRouter.post(
  '/',
  requireCsrfToken,
  async (
    req: express.Request,
    res: express.Response<LoginResponse>,
    next: express.NextFunction
  ) => {
    try {
      const parseResult = loginSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new HttpError(StatusCodes.BAD_REQUEST, 'Invalid request body');
      }

      const { username, password } = parseResult.data;

      // Try finding by user_name first, then by email
      const user =
        (await userRepo.findByUserName(username)) ||
        (await userRepo.findByEmail(username));

      if (!user) {
        throw new HttpError(StatusCodes.UNAUTHORIZED, 'Invalid credentials');
      }

      // Check password: support both argon2 hashed and plain text (dev only)
      let isValid = false;
      if (user.password.startsWith('$argon2')) {
        isValid = await verifyPassword(user.password, password);
      } else if (isDevelopment()) {
        isValid = user.password === password;
      }

      if (!isValid) {
        throw new HttpError(StatusCodes.UNAUTHORIZED, 'Invalid credentials');
      }

      const sessionUser: SessionUser = {
        id: user.id,
        userName: user.user_name,
        userRole: user.user_role
      };

      // Regenerate session to prevent session fixation
      req.session.regenerate((err) => {
        if (err) {
          logger.error('Session regeneration failed', { error: err });
          next(
            new HttpError(
              StatusCodes.INTERNAL_SERVER_ERROR,
              'Session regeneration failed'
            )
          );
          return;
        }

        req.session.user = sessionUser;
        req.user = sessionUser;

        req.session.save((saveErr) => {
          if (saveErr) {
            logger.error('Session save failed', { error: saveErr });
            next(
              new HttpError(
                StatusCodes.INTERNAL_SERVER_ERROR,
                'Session save failed'
              )
            );
            return;
          }

          res.json({ message: 'Login successful' });
        });
      });
    } catch (error) {
      next(error);
    }
  }
);
