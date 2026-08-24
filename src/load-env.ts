import { config } from 'dotenv';

const nodeEnv = process.env.NODE_ENV || 'development';

config({ path: `.env.${nodeEnv}.local` });
config({ path: `.env.${nodeEnv}` });
config({ path: '.env.local' });
config({ path: '.env' });
