import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../trpc";
import { db } from "@/lib/db";
import { accounts, transactions } from "@/lib/db/schema";
import { eq, and, sql, desc } from "drizzle-orm";
import crypto from "crypto";
import { isValidLuhn } from "@/lib/utils/validation";

function generateAccountNumber(): string {
  // Use cryptographically secure random number generator (CSPRNG)
  // Generates a 10-digit number from 1000000000 to 9999999999
  return crypto.randomInt(1000000000, 10000000000).toString();
}

export const accountRouter = router({
  createAccount: protectedProcedure
    .input(
      z.object({
        accountType: z.enum(["checking", "savings"]),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Check if user already has an account of this type
      const existingAccount = await db
        .select()
        .from(accounts)
        .where(and(eq(accounts.userId, ctx.user.id), eq(accounts.accountType, input.accountType)))
        .get();

      if (existingAccount) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `You already have a ${input.accountType} account`,
        });
      }

      let accountNumber;
      let accountCreated = false;
      let retries = 0;
      const MAX_RETRIES = 5;

      // Optimistic Loop: Try to insert directly, handle collision if it happens
      while (!accountCreated && retries < MAX_RETRIES) {
        try {
          accountNumber = generateAccountNumber();
          
          await db.insert(accounts).values({
            userId: ctx.user.id,
            accountNumber: accountNumber,
            accountType: input.accountType,
            balance: 0,
            status: "active",
          });
          
          accountCreated = true;
        } catch (error: any) {
          // Check if error is due to unique constraint violation on account_number
          // SQLite error code 2067 or message "UNIQUE constraint failed"
          if (error.code === 'SQLITE_CONSTRAINT_UNIQUE' || error.message?.includes('UNIQUE constraint failed')) {
            retries++;
            continue;
          }
          // If it's another error, rethrow it
          throw error;
        }
      }

      if (!accountCreated) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to generate a unique account number. Please try again.",
        });
      }

      // Fetch the created account
      const account = await db.select().from(accounts).where(eq(accounts.accountNumber, accountNumber!)).get();

      if (!account) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Account created but failed to retrieve details",
        });
      }

      return account;
    }),

  getAccounts: protectedProcedure.query(async ({ ctx }) => {
    const userAccounts = await db.select().from(accounts).where(eq(accounts.userId, ctx.user.id));

    return userAccounts;
  }),

  fundAccount: protectedProcedure
    .input(
      z.object({
        accountId: z.number(),
        amount: z.number().min(0.01, "Amount must be at least $0.01"),
        fundingSource: z
          .object({
            type: z.enum(["card", "bank"]),
            accountNumber: z.string(),
            routingNumber: z.string().optional(),
          })
          .refine(
            (data) => {
              if (data.type === "bank") {
                return !!data.routingNumber && /^\d{9}$/.test(data.routingNumber);
              }
              return true;
            },
            {
              message: "Routing number is required for bank transfers and must be 9 digits",
            }
          )
          .refine(
            (data) => {
              if (data.type === "card") {
                return isValidLuhn(data.accountNumber);
              }
              return true;
            },
            {
              message: "Invalid card number. Please check the card number and try again.",
            }
          ),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const amount = parseFloat(input.amount.toString());

      // Verify account belongs to user
      const account = await db
        .select()
        .from(accounts)
        .where(and(eq(accounts.id, input.accountId), eq(accounts.userId, ctx.user.id)))
        .get();

      if (!account) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Account not found",
        });
      }

      if (account.status !== "active") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Account is not active",
        });
      }

      // Create transaction
      await db.insert(transactions).values({
        accountId: input.accountId,
        type: "deposit",
        amount,
        description: `Funding from ${input.fundingSource.type}`,
        status: "completed",
        processedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      });

      // Update account balance atomically using SQL
      // This prevents race conditions by letting the database handle the addition
      await db
        .update(accounts)
        .set({
          balance: sql`${accounts.balance} + ${amount}`,
        })
        .where(eq(accounts.id, input.accountId));

      // Fetch the updated account
      const updatedAccount = await db
        .select()
        .from(accounts)
        .where(eq(accounts.id, input.accountId))
        .get();

      // Fetch the most recent transaction
      const transaction = await db
        .select()
        .from(transactions)
        .where(eq(transactions.accountId, input.accountId))
        .orderBy(sql`created_at DESC`) // Sort by created_at in desc to get the most recent
        .limit(1)
        .get();

      return {
        transaction,
        newBalance: updatedAccount?.balance ?? 0,
      };
    }),

  getTransactions: protectedProcedure
    .input(
      z.object({
        accountId: z.number(),
      })
    )
    .query(async ({ input, ctx }) => {
      // Verify account belongs to user
      const account = await db
        .select()
        .from(accounts)
        .where(and(eq(accounts.id, input.accountId), eq(accounts.userId, ctx.user.id)))
        .get();

      if (!account) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Account not found",
        });
      }

      const accountTransactions = await db
        .select()
        .from(transactions)
        .where(eq(transactions.accountId, input.accountId))
        .orderBy(desc(transactions.createdAt), desc(transactions.id));
  
      const enrichedTransactions = accountTransactions.map((transaction) => ({
        ...transaction,
        accountType: account.accountType,
      }));

      return enrichedTransactions;
    }),
});
