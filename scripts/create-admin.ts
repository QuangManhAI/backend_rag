/**
 * Admin bootstrap CLI (prompt_security S7).
 *
 * Creates the **first** admin account. The script is intentionally idempotent: running it again
 * for an existing email promotes the account to `admin` instead of creating a duplicate.
 *
 * Usage:
 *   npm run create:admin -- --email admin@example.com --password 'a strong password'
 *   npm run create:admin -- --email admin@example.com --password 'pw' --display-name 'Root'
 *
 * If `--password` is omitted the script reads it from `ADMIN_PASSWORD`; when both are missing it
 * prompts on stdin (the password is never echoed).
 */
import 'dotenv/config';
import * as readline from 'readline';
import * as mongoose from 'mongoose';
import * as argon2 from 'argon2';
import {
  validatePassword,
  PASSWORD_MIN_LENGTH,
} from '../src/auth/common-passwords';
import { User, UserSchema } from '../src/auth/schemas/user.schema';

interface Args {
  email: string;
  password?: string;
  displayName: string;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const email = get('--email') ?? process.env.ADMIN_EMAIL;
  const password = get('--password') ?? process.env.ADMIN_PASSWORD;
  const displayName =
    get('--display-name') ?? process.env.ADMIN_DISPLAY_NAME ?? 'Administrator';
  if (!email) {
    throw new Error(
      'missing --email (or ADMIN_EMAIL). Usage: npm run create:admin -- --email <email> [--password <pw>]',
    );
  }
  return { email: email.trim().toLowerCase(), password, displayName };
}

async function promptPassword(): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });
  return new Promise((resolve, reject) => {
    // `readline` does not support hidden input, so the echo is muted by hand.
    const onData = (char: string): void => {
      if (char === '\n' || char === '\r') {
        process.stdin.removeListener('data', onData);
      } else {
        process.stdout.write('');
      }
    };
    process.stdout.write('Password: ');
    process.stdin.on('data', onData);
    rl.question('', (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
    rl.on('error', reject);
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI is not set (check .env)');

  const password = args.password ?? (await promptPassword());
  if (password.length < PASSWORD_MIN_LENGTH) {
    throw new Error(
      `password must be at least ${PASSWORD_MIN_LENGTH} characters`,
    );
  }
  validatePassword(password, args.email);

  mongoose.set('strictQuery', true);
  const conn = await mongoose.createConnection(uri).asPromise();
  try {
    const users = conn.model(User.name, UserSchema);
    const existing = await users.findOne({ email: args.email }).lean();
    const hash = await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    });

    if (existing) {
      // Promoting an existing account also bumps `token_version`, so every token issued before
      // the promotion stops working (prompt_security S3).
      await users.updateOne(
        { _id: existing._id },
        {
          $set: {
            roles: ['user', 'admin'],
            is_active: true,
            password_hash: hash,
            disabled_at: null,
            disabled_by: null,
            disabled_reason: null,
          },
          $inc: { token_version: 1 },
        },
      );
      console.log(
        `[OK] ${args.email} now has the roles [user, admin] and a fresh password.`,
      );
      return;
    }

    await users.create({
      email: args.email,
      password_hash: hash,
      display_name: args.displayName,
      roles: ['user', 'admin'],
      is_active: true,
      token_version: 0,
    });
    console.log(
      `[OK] Admin ${args.email} created with the roles [user, admin].`,
    );
  } finally {
    await conn.close();
  }
}

main().catch((err: unknown) => {
  console.error(`[ERROR] ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
