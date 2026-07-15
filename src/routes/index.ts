import { Router } from 'express';
import householdRouter from './households';
import userRouter from './users';

const router = Router();

router.use('/households', householdRouter);
router.use('/users', userRouter);

export default router;
