import app from './app';
import { restoreTimers } from './lib/timer-scheduler';

const PORT = process.env.PORT ?? 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  restoreTimers().catch(console.error);
});
