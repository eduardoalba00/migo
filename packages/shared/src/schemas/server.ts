import { z } from "zod/v4";

export const createServerSchema = z.object({
  name: z
    .string()
    .min(1, "Server name is required")
    .max(100, "Server name must be at most 100 characters"),
});

export const updateServerSchema = z.object({
  name: z
    .string()
    .min(1, "Server name is required")
    .max(100, "Server name must be at most 100 characters")
    .optional(),
  iconUrl: z.string().nullable().optional(),
});

export const createCategorySchema = z.object({
  name: z
    .string()
    .min(1, "Category name is required")
    .max(100, "Category name must be at most 100 characters"),
});

export const createChannelSchema = z.object({
  name: z
    .string()
    .min(1, "Channel name is required")
    .max(100, "Channel name must be at most 100 characters"),
  type: z.enum(["text", "voice"]).default("text"),
  categoryId: z.string().optional(),
  topic: z.string().max(1024, "Topic must be at most 1024 characters").optional(),
});

export const updateChannelSchema = z.object({
  name: z
    .string()
    .min(1, "Channel name is required")
    .max(100, "Channel name must be at most 100 characters")
    .optional(),
  topic: z.string().max(1024, "Topic must be at most 1024 characters").nullable().optional(),
  categoryId: z.string().nullable().optional(),
});

export const createInviteSchema = z.object({
  maxUses: z.number().int().min(0).optional(),
  expiresInHours: z.number().int().min(1).max(168).optional(),
});

export const joinServerSchema = z.object({
  code: z.string().min(1, "Invite code is required"),
});

export type CreateServerInput = z.infer<typeof createServerSchema>;
export type UpdateServerInput = z.infer<typeof updateServerSchema>;
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type CreateChannelInput = z.infer<typeof createChannelSchema>;
export type UpdateChannelInput = z.infer<typeof updateChannelSchema>;
export type CreateInviteInput = z.infer<typeof createInviteSchema>;
export type JoinServerInput = z.infer<typeof joinServerSchema>;
