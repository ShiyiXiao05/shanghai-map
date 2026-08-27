import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(here, '..', '.env') });
dotenv.config({ path: path.join(here, '.env') });
// Neon CLI（neon env pull）维护的变量落在这里
dotenv.config({ path: path.join(here, '.env.local') });
