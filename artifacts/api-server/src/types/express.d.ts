import { User } from "@workspace/db";

declare global {
  namespace Express {
    interface Request {
      clerkUserId: string;
      user: User;
    }
  }
}
