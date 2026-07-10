import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";

const router = Router();

router.get("/me", requireAuth, (req: any, res) => {
  res.json({
    id: req.user.id,
    clerkId: req.user.clerkId,
    role: req.user.role,
    email: req.user.email,
    name: req.user.name,
  });
});

export default router;
