declare global {
  namespace Express {
    interface Request {
      auth?: {
        userId: string;
        userName: string;
        sessionId: string;
      };
    }
  }
}

export {};
