import express from 'express';
import { StatusCodes } from 'http-status-codes';
import { requireCsrfToken } from '../../middleware/csrf';
import { typedHandler } from '../../types/api';
import { userRepo, invitationCodeRepo } from '../../repositories/registry';
import {
  RegistrationService,
  RegistrationValidationError,
  RegistrationDuplicateError
} from '../../services/RegistrationService';
import { HttpError } from '../../errors/HttpError';

export const registerRouter = express.Router();

const registrationService = new RegistrationService(
  userRepo,
  invitationCodeRepo
);

/*
 * GET /api/register/status
 * Returns whether an invitation code is required for registration.
 */
interface RegistrationStatusResponse {
  needsInvitationCode: boolean;
}

registerRouter.get(
  '/status',
  requireCsrfToken,
  async (
    _req: express.Request,
    res: express.Response<RegistrationStatusResponse>
  ) => {
    res.json(await registrationService.checkRegistrationStatus());
  }
);

/*
 * POST /api/register
 * Registers a new user.
 */
interface RegisterRequest {
  body: {
    fullName?: string;
    userName: string;
    email: string;
    password: string;
    invitationCode?: string;
  };
}

interface RegisterResponse {
  message: string;
}

registerRouter.post(
  '/',
  requireCsrfToken,
  typedHandler<RegisterRequest, RegisterResponse>(async (req, res) => {
    try {
      const { fullName, userName, email, password, invitationCode } = req.body;

      await registrationService.register({
        fullName,
        userName,
        email,
        password,
        invitationCode
      });

      res.json({ message: 'register_success' });
    } catch (err) {
      if (err instanceof RegistrationValidationError) {
        throw new HttpError(StatusCodes.BAD_REQUEST, err.message, err.errors);
      }
      if (err instanceof RegistrationDuplicateError) {
        throw new HttpError(StatusCodes.CONFLICT, err.message);
      }
      throw err;
    }
  })
);
