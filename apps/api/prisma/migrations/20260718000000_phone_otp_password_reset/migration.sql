-- Add phone number to users (supports phone OTP sign-in)
-- Guard: column may already exist if it was added outside Prisma migrations.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'phone'
  ) THEN
    ALTER TABLE "users" ADD COLUMN "phone" TEXT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'users' AND indexname = 'users_phone_key'
  ) THEN
    CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");
  END IF;
END $$;

-- OtpType enum
DO $$ BEGIN
  CREATE TYPE "OtpType" AS ENUM ('EMAIL', 'PHONE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- OTP codes table (used by email and phone OTP sign-in)
CREATE TABLE IF NOT EXISTS "otp_codes" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "type" "OtpType" NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_codes_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'otp_codes' AND indexname = 'otp_codes_identifier_usedAt_expiresAt_idx'
  ) THEN
    CREATE INDEX "otp_codes_identifier_usedAt_expiresAt_idx"
      ON "otp_codes"("identifier", "usedAt", "expiresAt");
  END IF;
END $$;

-- Password reset tokens table
CREATE TABLE IF NOT EXISTS "password_reset_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'password_reset_tokens' AND indexname = 'password_reset_tokens_tokenHash_key'
  ) THEN
    CREATE UNIQUE INDEX "password_reset_tokens_tokenHash_key"
      ON "password_reset_tokens"("tokenHash");
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'password_reset_tokens' AND indexname = 'password_reset_tokens_userId_idx'
  ) THEN
    CREATE INDEX "password_reset_tokens_userId_idx" ON "password_reset_tokens"("userId");
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'password_reset_tokens_userId_fkey'
  ) THEN
    ALTER TABLE "password_reset_tokens"
      ADD CONSTRAINT "password_reset_tokens_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
