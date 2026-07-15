import { Router } from 'express';
import householdRouter from './households';
import userRouter from './users';
import recipeBookRouter from './recipe-book';
import ingredientRouter from './ingredients';

const router = Router();

router.use('/households', householdRouter);
router.use('/users', userRouter);
router.use('/recipe-book', recipeBookRouter);
router.use('/ingredients', ingredientRouter);

export default router;
