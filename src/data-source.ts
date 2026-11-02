import 'reflect-metadata';
import { config } from 'dotenv';
import { join } from 'path';
import { DataSource } from 'typeorm';

/** Usado só pela CLI do TypeORM (npm run migration:*). Lê o mesmo .env do app. */
const nodeEnv = process.env.NODE_ENV || 'development';
config({ path: `.env.${nodeEnv}` });
config({ path: '.env' });

export default new DataSource({
  type: 'postgres',
  ...(process.env.DATABASE_URL
    ? {
        url: process.env.DATABASE_URL,
        ssl:
          process.env.NODE_ENV === 'production'
            ? {
                rejectUnauthorized:
                  process.env.DB_SSL_REJECT_UNAUTHORIZED === 'true',
              }
            : false,
      }
    : {
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT ?? 5432),
        username: process.env.DB_USERNAME,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_DATABASE,
      }),
  entities: [join(__dirname, '**', '*.entity.{ts,js}')],
  migrations: [join(__dirname, 'migrations', '*.{ts,js}')],
});
