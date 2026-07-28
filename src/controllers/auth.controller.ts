import type { Request, Response } from 'express';

import {
  activateAccount,
  completeRegistration,
  changePassword,
  login,
  logout,
  refreshSession,
  requestActivationCode,
  requestRegistrationCode,
  requestPasswordReset,
  resetPassword,
} from '../services/auth.service.js';

function value(req: Request, name: string) {
  return String(req.body?.[name] ?? req.query[name] ?? '');
}

export async function handleRequestActivation(
  req: Request,
  res: Response,
) {
  return res.json(
    await requestActivationCode(value(req, 'email')),
  );
}

export async function handleActivateAccount(
  req: Request,
  res: Response,
) {
  return res.json(
    await activateAccount(
      value(req, 'email'),
      value(req, 'codigo'),
      value(req, 'password'),
    ),
  );
}

export async function handleRequestRegistration(
  req: Request,
  res: Response,
) {
  return res.json(
    await requestRegistrationCode(
      value(req, 'nombre'),
      value(req, 'email'),
    ),
  );
}

export async function handleCompleteRegistration(
  req: Request,
  res: Response,
) {
  return res.json(
    await completeRegistration(
      value(req, 'email'),
      value(req, 'codigo'),
      value(req, 'password'),
    ),
  );
}

export async function handleLogin(req: Request, res: Response) {
  return res.json(
    await login(value(req, 'email'), value(req, 'password')),
  );
}

export async function handleRequestPasswordReset(
  req: Request,
  res: Response,
) {
  return res.json(
    await requestPasswordReset(value(req, 'email')),
  );
}

export async function handleResetPassword(
  req: Request,
  res: Response,
) {
  return res.json(
    await resetPassword(
      value(req, 'email'),
      value(req, 'codigo'),
      value(req, 'password'),
    ),
  );
}

export async function handleRefresh(req: Request, res: Response) {
  return res.json(
    await refreshSession(value(req, 'refreshToken')),
  );
}

export async function handleLogout(req: Request, res: Response) {
  return res.json(await logout(req.auth!.sessionId));
}

export async function handleChangePassword(
  req: Request,
  res: Response,
) {
  return res.json(
    await changePassword(
      req.auth!.userId,
      value(req, 'passwordActual'),
      value(req, 'passwordNueva'),
    ),
  );
}
