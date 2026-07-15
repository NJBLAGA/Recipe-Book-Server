declare global {
  namespace Express {
    interface Request {
      user: {
        id: string;
        name: string;
        email: string;
        emailVerified: boolean;
        image: string | null;
        handle: string | null;
        firstName: string | null;
        lastName: string | null;
        bio: string | null;
        theme: string | null;
        createdAt: Date;
        updatedAt: Date;
      };
      session: {
        id: string;
        userId: string;
        token: string;
        expiresAt: Date;
        createdAt: Date;
        updatedAt: Date;
      };
      householdId: string;
      recipeBookId: string;
    }
  }
}

export {};
