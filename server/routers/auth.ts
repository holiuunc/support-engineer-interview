import { z } from "zod";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { TRPCError } from "@trpc/server";
import { publicProcedure, router } from "../trpc";
import { db } from "@/lib/db";
import { users, sessions } from "@/lib/db/schema";
import { eq, or } from "drizzle-orm";
import { calculateAge } from "../../lib/utils"; // Moved to a utility file
// OPTIMIZATION: Use core + common language package to reduce memory footprint
import { zxcvbn, zxcvbnOptions } from "@zxcvbn-ts/core";
import { dictionary, adjacencyGraphs } from "@zxcvbn-ts/language-common";
import { encrypt, hashSSN } from "@/lib/crypto/encryption";

// Initialize zxcvbn options
const options = {
  graphs: adjacencyGraphs,
  dictionary: {
    ...dictionary,
  },
};
zxcvbnOptions.setOptions(options);

// Strong password validation schema following NIST SP 800-63B guidelines
const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(64, "Password must not exceed 64 characters")
  .refine((p) => /[a-z]/.test(p), "Password must contain at least one lowercase letter")
  .refine((p) => /[A-Z]/.test(p), "Password must contain at least one uppercase letter")
  .refine((p) => /[0-9]/.test(p), "Password must contain at least one number")
  .refine(
    (p) => /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(p),
    "Password must contain at least one special character"
  )
  .refine((p) => zxcvbn(p).score >= 3, "Password is too weak. Please use a stronger password");

export const authRouter = router({
  signup: publicProcedure
    .input(
      z.object({
        email: z.string().email().toLowerCase()
          .refine((email) => {
            const domain = email.split('@')[1];
            const blockedDomains = ['gnail.com', 'gmil.com', 'yaho.com', 'hotmial.com', 'outlok.com'];
            return !blockedDomains.includes(domain);
          }, "Invalid email domain. Did you mean gmail.com, yahoo.com, etc?"),
        password: passwordSchema,
        firstName: z.string().min(1),
        lastName: z.string().min(1),
        phoneNumber: z.string().regex(/^\+?\d{10,15}$/),
        dateOfBirth: z.string().refine((dob) => {
          return calculateAge(dob) >= 18;
        }, "You must be at least 18 years old to sign up."),
        ssn: z.string().regex(/^\d{9}$/),
        address: z.string().min(1),
        city: z.string().min(1),
        state: z.string().length(2).toUpperCase(),
        zipCode: z.string().regex(/^\d{5}$/),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const ssnHash = hashSSN(input.ssn);

      // Check for existing email OR existing SSN
      const existingUser = await db
        .select()
        .from(users)
        .where(or(eq(users.email, input.email), eq(users.ssnHash, ssnHash)))
        .get();

      if (existingUser) {
        if (existingUser.email === input.email) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "User with this email already exists",
          });
        } else {
           throw new TRPCError({
            code: "CONFLICT",
            message: "User with this SSN already exists",
          });
        }
      }

      const hashedPassword = await bcrypt.hash(input.password, 10);
      const encryptedSSN = encrypt(input.ssn);

      await db.insert(users).values({
        ...input,
        ssn: encryptedSSN,
        ssnHash: ssnHash, // Store the hash for uniqueness checks
        password: hashedPassword,
      });

      // Fetch the created user
      const user = await db.select().from(users).where(eq(users.email, input.email)).get();

      if (!user) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create user",
        });
      }

      // Create session
      const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET || "temporary-secret-for-interview", {
        expiresIn: "7d",
      });

      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);

      await db.insert(sessions).values({
        userId: user.id,
        token,
        expiresAt: expiresAt.toISOString(),
      });

      // Set cookie
      if ("setHeader" in ctx.res) {
        ctx.res.setHeader("Set-Cookie", `session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800`);
      } else {
        (ctx.res as Headers).set("Set-Cookie", `session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800`);
      }

      return { user: { ...user, password: undefined }, token };
    }),

  login: publicProcedure
    .input(
      z.object({
        email: z.string().email(),
        password: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const user = await db.select().from(users).where(eq(users.email, input.email)).get();

      if (!user) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Invalid credentials",
        });
      }

      const validPassword = await bcrypt.compare(input.password, user.password);

      if (!validPassword) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Invalid credentials",
        });
      }

      // Invalidate all existing sessions for this user (security best practice for banking)
      // This ensures only the most recent login session is valid
      await db.delete(sessions).where(eq(sessions.userId, user.id));

      const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET || "temporary-secret-for-interview", {
        expiresIn: "7d",
      });

      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);

      await db.insert(sessions).values({
        userId: user.id,
        token,
        expiresAt: expiresAt.toISOString(),
      });

      if ("setHeader" in ctx.res) {
        ctx.res.setHeader("Set-Cookie", `session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800`);
      } else {
        (ctx.res as Headers).set("Set-Cookie", `session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800`);
      }

      return { user: { ...user, password: undefined }, token };
    }),

  logout: publicProcedure.mutation(async ({ ctx }) => {
    let sessionDeleted = false;

    // Extract session token from cookie
    let token: string | undefined;
    if ("cookies" in ctx.req) {
      token = (ctx.req as any).cookies.session;
    } else {
      const cookieHeader = ctx.req.headers.get?.("cookie") || (ctx.req.headers as any).cookie;
      token = cookieHeader
        ?.split("; ")
        .find((c: string) => c.startsWith("session="))
        ?.split("=")[1];
    }

    // Delete session from database if token exists
    if (token) {
      // Verify session exists before deletion
      const existingSession = await db.select().from(sessions).where(eq(sessions.token, token)).get();
      if (existingSession) {
        await db.delete(sessions).where(eq(sessions.token, token));
        // Verify deletion succeeded
        const stillExists = await db.select().from(sessions).where(eq(sessions.token, token)).get();
        sessionDeleted = !stillExists;
      }
    }

    // Always clear the cookie for security (even if DB deletion failed)
    if ("setHeader" in ctx.res) {
      ctx.res.setHeader("Set-Cookie", `session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
    } else {
      (ctx.res as Headers).set("Set-Cookie", `session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
    }

    return {
      success: sessionDeleted || !token,
      message: sessionDeleted ? "Logged out successfully" : !token ? "No active session" : "Logout failed - session may still be active"
    };
  }),
});
