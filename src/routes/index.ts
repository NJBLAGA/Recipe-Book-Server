import { Router } from 'express';
import householdRouter from './households';
import userRouter from './users';
import recipeBookRouter from './recipe-book';
import ingredientRouter from './ingredients';
import pantryRouter from './pantry';
import shoppingListRouter from './shopping-list';
import cookSessionsRouter from './cook-sessions';
import pushRouter from './push';
import notificationsRouter from './notifications';
import sharesRouter from './shares';
import followsRouter from './follows';
import communityRouter from './community';

const router = Router();

router.use('/households', householdRouter);
router.use('/users', userRouter);
router.use('/recipe-book', recipeBookRouter);
router.use('/ingredients', ingredientRouter);
router.use('/pantry', pantryRouter);
router.use('/shopping-list', shoppingListRouter);
router.use('/cook-sessions', cookSessionsRouter);
router.use('/push', pushRouter);
router.use('/notifications', notificationsRouter);
router.use('/shares', sharesRouter);
router.use('/follows', followsRouter);
router.use('/community', communityRouter);

export default router;
