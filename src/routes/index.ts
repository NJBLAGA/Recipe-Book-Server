import { Router } from 'express';
import householdRouter from './households';

const router = Router();

router.use('/households', householdRouter);

export default router;
